import {
  App,
  Editor,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";

interface MergeOpenTargetSettings {
  mergePosition: "append" | "prepend";
  separator: string;
  trashSourceAfterMerge: boolean;
  confirmBeforeMerge: boolean;
  recentFilePaths: string[];
}

const DEFAULT_SETTINGS: MergeOpenTargetSettings = {
  mergePosition: "append",
  separator: "\n\n",
  trashSourceAfterMerge: true,
  confirmBeforeMerge: true,
  recentFilePaths: [],
};

export default class MergeOpenTargetPlugin extends Plugin {
  settings!: MergeOpenTargetSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }

        const updatedRecentPaths = [
          file.path,
          ...this.settings.recentFilePaths.filter((path) => path !== file.path),
        ].slice(0, 100);

        if (!isSamePathList(updatedRecentPaths, this.settings.recentFilePaths)) {
          this.settings.recentFilePaths = updatedRecentPaths;
          await this.saveSettings();
        }
      }),
    );

    this.addCommand({
      id: "merge-current-file-into-another-and-open-target",
      name: "Merge current file into another note and open target",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const available = activeFile instanceof TFile && activeFile.extension === "md";
        if (!available) {
          return false;
        }

        if (!checking) {
          new FileMergeTargetModal(this.app, activeFile, this).open();
        }
        return true;
      },
    });

    this.addCommand({
      id: "merge-selected-text-into-another-and-open-target",
      name: "Merge selected text into another note and open target",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const activeFile = this.app.workspace.getActiveFile();

        if (!(view instanceof MarkdownView) || !(activeFile instanceof TFile)) {
          new Notice("请先聚焦到一篇 Markdown 笔记的编辑器。");
          return;
        }

        const editor = view.editor;
        if (!editor.somethingSelected() || editor.getSelection().trim().length === 0) {
          new Notice("请先选中要合并的内容。");
          return;
        }

        new SelectionMergeTargetModal(this.app, activeFile, editor, this).open();
      },
    });

    this.addSettingTab(new MergeOpenTargetSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async mergeIntoTarget(sourceFile: TFile, targetFile: TFile): Promise<void> {
    if (sourceFile.path === targetFile.path) {
      new Notice("源笔记和目标笔记不能是同一篇。");
      return;
    }

    const sourceContent = stripFrontmatter(await this.app.vault.cachedRead(sourceFile));
    const targetContent = await this.app.vault.cachedRead(targetFile);
    const mergedContent = this.buildMergedContent(sourceContent, targetContent);

    await this.app.vault.modify(targetFile, mergedContent);

    if (this.settings.trashSourceAfterMerge) {
      await this.app.fileManager.trashFile(sourceFile);
    }

    await this.app.workspace.getLeaf(true).openFile(targetFile, {
      active: true,
      state: { mode: "source" },
    });

    new Notice(`已合并到「${targetFile.basename}」并打开目标笔记。`);
  }

  async mergeSelectedTextIntoTarget(
    sourceFile: TFile,
    selectedText: string,
    targetFile: TFile,
    editor: Editor,
  ): Promise<void> {
    if (sourceFile.path === targetFile.path) {
      new Notice("源笔记和目标笔记不能是同一篇。");
      return;
    }

    const contentToMerge = selectedText.trim();
    if (!contentToMerge) {
      new Notice("没有可合并的选中内容。");
      return;
    }

    const targetContent = await this.app.vault.cachedRead(targetFile);
    const mergedContent = this.buildMergedContent(contentToMerge, targetContent);

    await this.app.vault.modify(targetFile, mergedContent);
    editor.replaceSelection("");

    await this.app.workspace.getLeaf(true).openFile(targetFile, {
      active: true,
      state: { mode: "source" },
    });

    new Notice(`已将选中内容合并到「${targetFile.basename}」并打开目标笔记。`);
  }

  private buildMergedContent(sourceContent: string, targetContent: string): string {
    const separator = this.settings.separator;
    if (this.settings.mergePosition === "prepend") {
      return joinContent(sourceContent, targetContent, separator);
    }

    return joinContent(targetContent, sourceContent, separator);
  }
}

class FileMergeTargetModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly sourceFile: TFile,
    private readonly plugin: MergeOpenTargetPlugin,
  ) {
    super(app);
    this.setPlaceholder("选择要合并进入的目标笔记...");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "Enter", purpose: "合并并打开目标笔记" },
      { command: "Esc", purpose: "取消" },
    ]);
  }

  getItems(): TFile[] {
    return sortCandidateFiles(
      this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path),
      this.plugin.settings.recentFilePaths,
    );
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  renderSuggestion(match: { item: TFile }, el: HTMLElement): void {
    renderFileSuggestion(match.item, el, this.plugin.settings.recentFilePaths);
  }

  async onChooseItem(targetFile: TFile): Promise<void> {
    if (this.plugin.settings.confirmBeforeMerge) {
      const confirmed = window.confirm(
        `把「${this.sourceFile.basename}」合并到「${targetFile.basename}」后，将自动打开目标笔记。是否继续？`,
      );
      if (!confirmed) {
        return;
      }
    }

    try {
      await this.plugin.mergeIntoTarget(this.sourceFile, targetFile);
    } catch (error) {
      console.error("Merge failed", error);
      new Notice(`合并失败：${getErrorMessage(error)}`);
    }
  }
}

class SelectionMergeTargetModal extends FuzzySuggestModal<TFile> {
  private readonly selectedText: string;

  constructor(
    app: App,
    private readonly sourceFile: TFile,
    private readonly editor: Editor,
    private readonly plugin: MergeOpenTargetPlugin,
  ) {
    super(app);
    this.selectedText = editor.getSelection();
    this.setPlaceholder("选择要接收选中内容的目标笔记...");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "Enter", purpose: "合并选中内容并打开目标笔记" },
      { command: "Esc", purpose: "取消" },
    ]);
  }

  getItems(): TFile[] {
    return sortCandidateFiles(
      this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path),
      this.plugin.settings.recentFilePaths,
    );
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  renderSuggestion(match: { item: TFile }, el: HTMLElement): void {
    renderFileSuggestion(match.item, el, this.plugin.settings.recentFilePaths);
  }

  async onChooseItem(targetFile: TFile): Promise<void> {
    if (this.plugin.settings.confirmBeforeMerge) {
      const confirmed = window.confirm(
        `把当前选中的内容合并到「${targetFile.basename}」后，将自动打开目标笔记，并从当前笔记移除选中内容。是否继续？`,
      );
      if (!confirmed) {
        return;
      }
    }

    try {
      await this.plugin.mergeSelectedTextIntoTarget(
        this.sourceFile,
        this.selectedText,
        targetFile,
        this.editor,
      );
    } catch (error) {
      console.error("Selection merge failed", error);
      new Notice(`合并失败：${getErrorMessage(error)}`);
    }
  }
}

class MergeOpenTargetSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MergeOpenTargetPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("合并位置")
      .setDesc("把当前笔记内容追加到目标笔记末尾，或插入到目标笔记开头。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("append", "追加到末尾")
          .addOption("prepend", "插入到开头")
          .setValue(this.plugin.settings.mergePosition)
          .onChange(async (value) => {
            this.plugin.settings.mergePosition = value as "append" | "prepend";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("分隔符")
      .setDesc("合并两篇笔记内容时插入的文本，默认是两个换行。")
      .addTextArea((textArea) =>
        textArea
          .setPlaceholder("\\n\\n")
          .setValue(escapeControlChars(this.plugin.settings.separator))
          .onChange(async (value) => {
            this.plugin.settings.separator = unescapeControlChars(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("合并后移入废纸篓")
      .setDesc("开启后，源笔记在合并完成后会按 Obsidian 的废纸篓设置移除。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.trashSourceAfterMerge).onChange(async (value) => {
          this.plugin.settings.trashSourceAfterMerge = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("合并前确认")
      .setDesc("开启后，执行合并前会再弹一次确认。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.confirmBeforeMerge).onChange(async (value) => {
          this.plugin.settings.confirmBeforeMerge = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}

function joinContent(first: string, second: string, separator: string): string {
  if (!first.trim()) {
    return second;
  }
  if (!second.trim()) {
    return first;
  }
  return `${first}${separator}${second}`;
}

function renderFileSuggestion(file: TFile, el: HTMLElement, recentFilePaths: string[]): void {
  el.empty();
  el.addClass("mod-complex");

  const contentEl = el.createDiv({ cls: "suggestion-content" });
  const titleRowEl = contentEl.createDiv({ cls: "suggestion-title" });
  titleRowEl.createSpan({
    cls: "suggestion-title",
    text: file.basename,
  });

  if (recentFilePaths.includes(file.path)) {
    titleRowEl.createSpan({
      cls: "suggestion-flair",
      text: "最近",
    });
  }

  contentEl.createDiv({
    cls: "suggestion-note",
    text: file.path,
  });
}

function sortCandidateFiles(files: TFile[], recentFilePaths: string[]): TFile[] {
  const recentRank = new Map(recentFilePaths.map((path, index) => [path, index]));

  return [...files].sort((a, b) => {
    const baseNameCompare = a.basename.localeCompare(b.basename, "zh-Hans-CN");
    if (baseNameCompare !== 0) {
      return baseNameCompare;
    }

    const aRank = recentRank.get(a.path) ?? Number.POSITIVE_INFINITY;
    const bRank = recentRank.get(b.path) ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) {
      return aRank - bRank;
    }

    return a.path.localeCompare(b.path, "zh-Hans-CN");
  });
}

function isSamePathList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((path, index) => path === b[index]);
}

function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return content;
  }

  const endMarkerIndex = normalized.indexOf("\n---\n", 4);
  if (endMarkerIndex === -1) {
    return content;
  }

  const body = normalized.slice(endMarkerIndex + 5);
  return body.replace(/^\n+/, "");
}

function escapeControlChars(value: string): string {
  return value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function unescapeControlChars(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
