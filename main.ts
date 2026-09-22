import {
  App,
  Editor,
  FuzzyMatch,
  FuzzySuggestModal,
  MarkdownView,
  Modal,
  Notice,
  parseLinktext,
  Plugin,
  PluginSettingTab,
  ReferenceCache,
  Setting,
  TFile,
  prepareFuzzySearch,
  requestUrl,
} from "obsidian";

interface JevDecision {
  choice?: string;
  selected?: string;
  value?: string;
  confidence?: number;
  probability?: number;
}

interface JevResponse {
  answers?: Record<string, JevDecision>;
  results?: Record<string, JevDecision>;
  questions?: Record<string, JevDecision>;
  recommended_target_note?: JevDecision;
}

interface MergeOpenTargetSettings {
  mergePosition: "append" | "prepend";
  separator: string;
  updateLinksAfterMerge: boolean;
  trashSourceAfterMerge: boolean;
  confirmBeforeMerge: boolean;
  recentFilePaths: string[];
  enableJevRecommend: boolean;
  typesafeApiKey: string;
  jevMinConfidence: number;
}

const DEFAULT_SETTINGS: MergeOpenTargetSettings = {
  mergePosition: "append",
  separator: "\n\n",
  updateLinksAfterMerge: true,
  trashSourceAfterMerge: true,
  confirmBeforeMerge: true,
  recentFilePaths: [],
  enableJevRecommend: false,
  typesafeApiKey: "",
  jevMinConfidence: 0.6,
};

export default class MergeOpenTargetPlugin extends Plugin {
  settings!: MergeOpenTargetSettings;
  aliasCache = new Map<string, string[]>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile) {
          this.refreshAliasCacheForFile(file);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }

        if (oldPath && oldPath !== file.path) {
          this.aliasCache.delete(oldPath);
        }

        this.refreshAliasCacheForFile(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.aliasCache.delete(file.path);
        }
      }),
    );

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
          void this.openFileMergeTargetModal(activeFile);
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

        void this.openSelectionMergeTargetModal(activeFile, editor);
      },
    });

    this.addSettingTab(new MergeOpenTargetSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<MergeOpenTargetSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async openFileMergeTargetModal(sourceFile: TFile): Promise<void> {
    new FileMergeTargetModal(this.app, sourceFile, this).open();
  }

  async openSelectionMergeTargetModal(sourceFile: TFile, editor: Editor): Promise<void> {
    new SelectionMergeTargetModal(this.app, sourceFile, editor, this).open();
  }

  refreshAliasCacheForFile(file: TFile): void {
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    this.aliasCache.set(file.path, readAliasesFromMetadata(file, this.app));
  }

  async mergeIntoTarget(sourceFile: TFile, targetFile: TFile): Promise<void> {
    if (sourceFile.path === targetFile.path) {
      new Notice("源笔记和目标笔记不能是同一篇。");
      return;
    }

    const shouldUpdateLinks = this.settings.updateLinksAfterMerge;
    const referrerFiles = shouldUpdateLinks
      ? getMarkdownReferrersToFile(this.app, sourceFile.path).filter(
          (file) => file.path !== sourceFile.path && file.path !== targetFile.path,
        )
      : [];

    const sourceRawContent = await this.app.vault.cachedRead(sourceFile);
    const processedSourceRawContent = shouldUpdateLinks
      ? rewriteLinksInFileContent(
          this.app,
          sourceRawContent,
          sourceFile,
          sourceFile,
          targetFile,
        )
      : sourceRawContent;

    const sourceContent = stripFrontmatter(processedSourceRawContent);
    const targetOriginalContent = await this.app.vault.cachedRead(targetFile);
    const targetContent = shouldUpdateLinks
      ? rewriteLinksInFileContent(
          this.app,
          targetOriginalContent,
          targetFile,
          sourceFile,
          targetFile,
        )
      : targetOriginalContent;
    const mergedContent = this.buildMergedContent(sourceContent, targetContent);

    await this.app.vault.modify(targetFile, mergedContent);

    if (shouldUpdateLinks) {
      await rewriteLinksInFiles(this.app, referrerFiles, sourceFile, targetFile);
    }

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

  async queryJevRecommend(
    sourceSnippet: string,
    candidateFiles: TFile[]
  ): Promise<{ file: TFile; confidence: number } | null> {
    if (!this.settings.enableJevRecommend || !this.settings.typesafeApiKey?.trim()) {
      return null;
    }
    if (!candidateFiles || candidateFiles.length === 0) {
      return null;
    }
    try {
      const topCandidates = candidateFiles.slice(0, 30);
      const criteria: Record<string, string> = {};
      const keyToFileMap: Record<string, TFile> = {};
      topCandidates.forEach((file, index) => {
        const optionKey = `opt_${index}`;
        keyToFileMap[optionKey] = file;
        const aliases = getAliases(file, this.app, this.aliasCache);
        const aliasDesc = aliases.length > 0 ? ` (aliases: ${aliases.join(", ")})` : "";
        criteria[optionKey] = `Note title: "${file.basename}"${aliasDesc}, path: "${file.path}"`;
      });
      const payload = {
        model: "jev-latest",
        state: sourceSnippet,
        questions: {
          recommended_target_note: {
            type: "choice",
            instructions: "Which target note is the most relevant and best destination to merge this source content into?",
            criteria
          }
        }
      };
      const response = await requestUrl({
        url: "https://api.typesafe.ai/v1/systemone",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.settings.typesafeApiKey.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        throw: false
      });
      if (response.status < 200 || response.status >= 300) {
        console.warn("TypeSafe Jev API returned error status:", response.status, response.text);
        return null;
      }
      const data = (response.json || {}) as JevResponse;
      const decision: JevDecision | undefined =
        data.answers?.["recommended_target_note"] ||
        data.results?.["recommended_target_note"] ||
        data.questions?.["recommended_target_note"] ||
        data.recommended_target_note;

      const choice = decision?.choice || decision?.selected || decision?.value;
      const confidence = typeof decision?.confidence === "number" ? decision.confidence : (decision?.probability ?? 1);
      const minConfidence = this.settings.jevMinConfidence ?? 0.6;
      if (choice && choice in keyToFileMap && confidence >= minConfidence) {
        const matchedFile = keyToFileMap[choice];
        if (matchedFile) {
          return {
            file: matchedFile,
            confidence,
          };
        }
      }
      return null;
    } catch (err) {
      console.warn("TypeSafe Jev recommendation request failed silently:", err);
      return null;
    }
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    void super.onOpen();
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const confirmButton = buttonContainer.createEl("button", {
      text: "确认",
      cls: "mod-cta",
    });
    confirmButton.onclick = () => {
      this.close();
      this.onConfirm();
    };

    const cancelButton = buttonContainer.createEl("button", {
      text: "取消",
    });
    cancelButton.onclick = () => {
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class FileMergeTargetModal extends FuzzySuggestModal<TFile> {
  private cachedItems: TFile[];
  private aiRecommendation: { file: TFile; confidence: number } | null = null;

  constructor(
    app: App,
    private readonly sourceFile: TFile,
    private readonly plugin: MergeOpenTargetPlugin,
  ) {
    super(app);
    this.cachedItems = sortCandidateFiles(
      this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path),
      this.plugin.settings.recentFilePaths,
      this.sourceFile,
    );
    this.setPlaceholder("选择要合并进入的目标笔记...");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "Enter", purpose: "合并并打开目标笔记" },
      { command: "Esc", purpose: "取消" },
    ]);
  }

  onOpen(): void {
    void super.onOpen();
    if (this.plugin.settings.enableJevRecommend && this.plugin.settings.typesafeApiKey?.trim()) {
      void this.fetchJevRecommendation();
    }
  }

  async fetchJevRecommendation(): Promise<void> {
    try {
      const content = await this.app.vault.cachedRead(this.sourceFile);
      const cleanContent = stripFrontmatter(content).trim();
      const snippet = `Title: ${this.sourceFile.basename}\n\nContent snippet:\n${cleanContent.slice(0, 600)}`;
      
      const queryTerms = extractKeyTerms(`${this.sourceFile.basename} ${cleanContent.slice(0, 400)}`);
      const allVaultFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path !== this.sourceFile.path);
      const bm25Candidates = getBM25TopCandidates(allVaultFiles, queryTerms, this.plugin, this.sourceFile, 20);
      
      const seen = new Set<string>();
      const combinedCandidates: TFile[] = [];
      for (const f of [...bm25Candidates, ...this.cachedItems]) {
        if (!seen.has(f.path)) {
          seen.add(f.path);
          combinedCandidates.push(f);
        }
        if (combinedCandidates.length >= 30) break;
      }

      const result = await this.plugin.queryJevRecommend(snippet, combinedCandidates);
      if (result?.file) {
        this.aiRecommendation = result;
        const remaining = this.cachedItems.filter((f) => f.path !== result.file.path);
        this.cachedItems = [result.file, ...remaining];
        if (this.inputEl) {
          this.inputEl.dispatchEvent(new Event("input"));
        }
      }
    } catch (err) {
      console.warn("fetchJevRecommendation error:", err);
    }
  }

  getItems(): TFile[] {
    return this.cachedItems;
  }

  getSuggestions(query: string): FuzzyMatch<TFile>[] {
    return getFileSuggestions(
      this.getItems(),
      query,
      this.plugin.app,
      this.plugin.aliasCache,
      this.plugin.settings.recentFilePaths,
      this.aiRecommendation?.file,
    );
  }

  getItemText(file: TFile): string {
    return getFileSearchText(this.plugin, file);
  }

  renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    const targetFile = match.item;
    renderFileSuggestion(targetFile, el, this.plugin, this.sourceFile, this.aiRecommendation);
  }

  onChooseItem(targetFile: TFile): void {
    void this.handleChooseItem(targetFile);
  }

  private async handleChooseItem(targetFile: TFile): Promise<void> {
    if (this.plugin.settings.confirmBeforeMerge) {
      new ConfirmModal(
        this.app,
        `把「${this.sourceFile.basename}」合并到「${targetFile.basename}」后，将自动打开目标笔记。是否继续？`,
        () => {
          void this.executeMerge(targetFile);
        },
      ).open();
      return;
    }

    await this.executeMerge(targetFile);
  }

  private async executeMerge(targetFile: TFile): Promise<void> {
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
  private cachedItems: TFile[];
  private aiRecommendation: { file: TFile; confidence: number } | null = null;

  constructor(
    app: App,
    private readonly sourceFile: TFile,
    private readonly editor: Editor,
    private readonly plugin: MergeOpenTargetPlugin,
  ) {
    super(app);
    this.selectedText = editor.getSelection();
    this.cachedItems = sortCandidateFiles(
      this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path),
      this.plugin.settings.recentFilePaths,
      this.sourceFile,
    );
    this.setPlaceholder("选择要接收选中内容的目标笔记...");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "Enter", purpose: "合并选中内容并打开目标笔记" },
      { command: "Esc", purpose: "取消" },
    ]);
  }

  onOpen(): void {
    void super.onOpen();
    if (this.plugin.settings.enableJevRecommend && this.plugin.settings.typesafeApiKey?.trim()) {
      void this.fetchJevRecommendation();
    }
  }

  async fetchJevRecommendation(): Promise<void> {
    try {
      const snippet = `Source Note: ${this.sourceFile.basename}\n\nSelected content to merge:\n${this.selectedText.trim().slice(0, 600)}`;
      
      const queryTerms = extractKeyTerms(`${this.sourceFile.basename} ${this.selectedText.trim().slice(0, 400)}`);
      const allVaultFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path !== this.sourceFile.path);
      const bm25Candidates = getBM25TopCandidates(allVaultFiles, queryTerms, this.plugin, this.sourceFile, 20);
      
      const seen = new Set<string>();
      const combinedCandidates: TFile[] = [];
      for (const f of [...bm25Candidates, ...this.cachedItems]) {
        if (!seen.has(f.path)) {
          seen.add(f.path);
          combinedCandidates.push(f);
        }
        if (combinedCandidates.length >= 30) break;
      }

      const result = await this.plugin.queryJevRecommend(snippet, combinedCandidates);
      if (result?.file) {
        this.aiRecommendation = result;
        const remaining = this.cachedItems.filter((f) => f.path !== result.file.path);
        this.cachedItems = [result.file, ...remaining];
        if (this.inputEl) {
          this.inputEl.dispatchEvent(new Event("input"));
        }
      }
    } catch (err) {
      console.warn("fetchJevRecommendation error:", err);
    }
  }

  getItems(): TFile[] {
    return this.cachedItems;
  }

  getSuggestions(query: string): FuzzyMatch<TFile>[] {
    return getFileSuggestions(
      this.getItems(),
      query,
      this.plugin.app,
      this.plugin.aliasCache,
      this.plugin.settings.recentFilePaths,
      this.aiRecommendation?.file,
    );
  }

  getItemText(file: TFile): string {
    return getFileSearchText(this.plugin, file);
  }

  renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    const targetFile = match.item;
    renderFileSuggestion(targetFile, el, this.plugin, this.sourceFile, this.aiRecommendation);
  }

  onChooseItem(targetFile: TFile): void {
    void this.handleChooseItem(targetFile);
  }

  private async handleChooseItem(targetFile: TFile): Promise<void> {
    if (this.plugin.settings.confirmBeforeMerge) {
      new ConfirmModal(
        this.app,
        `把当前选中的内容合并到「${targetFile.basename}」后，将自动打开目标笔记，并从当前笔记移除选中内容。是否继续？`,
        () => {
          void this.executeMerge(targetFile);
        },
      ).open();
      return;
    }

    await this.executeMerge(targetFile);
  }

  private async executeMerge(targetFile: TFile): Promise<void> {
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

  getSettingDefinitions(): unknown[] {
    return [
      {
        id: "mergePosition",
        name: "合并位置",
        description: "把当前笔记内容追加到目标笔记末尾，或插入到目标笔记开头。",
      },
      {
        id: "separator",
        name: "分隔符",
        description: "合并两篇笔记内容时插入的文本，默认是两个换行。",
      },
      {
        id: "trashSourceAfterMerge",
        name: "合并后移入废纸篓",
        description: "开启后，源笔记在合并完成后会按 Obsidian 的废纸篓设置移除。",
      },
      {
        id: "updateLinksAfterMerge",
        name: "整篇合并后同步更新指向源笔记的链接",
        description: "仅对“整篇合并”生效。开启后，会把所有已解析到源笔记的双链与 embed 链接改写为指向目标笔记。",
      },
      {
        id: "confirmBeforeMerge",
        name: "合并前确认",
        description: "开启后，执行合并前会再弹一次确认。",
      },
      {
        id: "enableJevRecommend",
        name: "启用 Jev 语义推荐目标笔记",
        description: "调用 TypeSafe AI 的 Jev (System One) 模型，基于当前笔记内容或选区智能预测最适合合并的目标笔记并置顶。",
      },
      {
        id: "typesafeApiKey",
        name: "TypeSafe API Key",
        description: "在 https://console.typesafe.ai/ 获取的 API Key。",
      },
      {
        id: "jevMinConfidence",
        name: "最低置信度阈值",
        description: "只有当 Jev 决策置信度高于该阈值时才进行置顶推荐。",
      },
    ];
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
      .setName("整篇合并后同步更新指向源笔记的链接")
      .setDesc(
        "仅对“整篇合并”生效。开启后，会把所有已解析到源笔记的双链与 embed 链接改写为指向目标笔记。",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.updateLinksAfterMerge).onChange(async (value) => {
          this.plugin.settings.updateLinksAfterMerge = value;
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

    new Setting(containerEl).setName("TypeSafe AI (Jev) 智能推荐").setHeading();
    new Setting(containerEl)
      .setName("启用 Jev 语义推荐目标笔记")
      .setDesc("调用 TypeSafe AI 的 Jev (System One) 模型，基于当前笔记内容或选区智能预测最适合合并的目标笔记并置顶。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableJevRecommend).onChange(async (value) => {
          this.plugin.settings.enableJevRecommend = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.enableJevRecommend) {
      new Setting(containerEl)
        .setName("TypeSafe API Key")
        .setDesc("在 https://console.typesafe.ai/ 获取的 API Key。")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("ts-...")
            .setValue(this.plugin.settings.typesafeApiKey)
            .onChange(async (value) => {
              this.plugin.settings.typesafeApiKey = value.trim();
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("最低置信度阈值")
        .setDesc("仅当 Jev 决策置信度高于此阈值时才进行置顶（0.1 ~ 1.0，默认 0.6）。")
        .addSlider((slider) =>
          slider
            .setLimits(0.1, 1.0, 0.05)
            .setValue(this.plugin.settings.jevMinConfidence ?? 0.6)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.jevMinConfidence = value;
              await this.plugin.saveSettings();
            })
        );
    }
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

function getMarkdownReferrersToFile(app: App, targetPath: string): TFile[] {
  const resolvedLinks = app.metadataCache.resolvedLinks ?? {};

  return Object.entries(resolvedLinks)
    .filter(([, links]) => (links?.[targetPath] ?? 0) > 0)
    .map(([sourcePath]) => app.vault.getAbstractFileByPath(sourcePath))
    .filter((file): file is TFile => file instanceof TFile && file.extension === "md");
}

async function rewriteLinksInFiles(
  app: App,
  files: TFile[],
  sourceFile: TFile,
  targetFile: TFile,
): Promise<void> {
  for (const file of files) {
    const originalContent = await app.vault.cachedRead(file);
    const updatedContent = rewriteLinksInFileContent(
      app,
      originalContent,
      file,
      sourceFile,
      targetFile,
    );

    if (updatedContent !== originalContent) {
      await app.vault.modify(file, updatedContent);
    }
  }
}

function rewriteLinksInFileContent(
  app: App,
  content: string,
  referrerFile: TFile,
  sourceFile: TFile,
  targetFile: TFile,
): string {
  const fileCache = app.metadataCache.getFileCache(referrerFile);
  if (!fileCache) {
    return content;
  }

  const frontmatterEndOffset = getFrontmatterEndOffset(content);
  const replacements = collectLinkReplacements(
    app,
    fileCache.links ?? [],
    false,
    referrerFile.path,
    sourceFile,
    targetFile,
    content,
    frontmatterEndOffset,
  )
    .concat(
      collectLinkReplacements(
        app,
        fileCache.embeds ?? [],
        true,
        referrerFile.path,
        sourceFile,
        targetFile,
        content,
        frontmatterEndOffset,
      ),
    )
    .sort((a, b) => b.start - a.start);

  if (replacements.length === 0) {
    return content;
  }

  let nextContent = content;
  for (const replacement of replacements) {
    nextContent = `${nextContent.slice(0, replacement.start)}${replacement.text}${nextContent.slice(replacement.end)}`;
  }

  return nextContent;
}

function collectLinkReplacements(
  app: App,
  references: ReferenceCache[],
  isEmbed: boolean,
  referrerPath: string,
  sourceFile: TFile,
  targetFile: TFile,
  content: string,
  frontmatterEndOffset: number,
): Array<{ start: number; end: number; text: string }> {
  return references.flatMap((reference) => {
    const startOffset = reference.position?.start?.offset;
    const endOffset = reference.position?.end?.offset;

    if (
      typeof startOffset !== "number" ||
      typeof endOffset !== "number" ||
      startOffset >= endOffset
    ) {
      return [];
    }

    if (frontmatterEndOffset > 0 && startOffset < frontmatterEndOffset) {
      return [];
    }

    const parsed = parseLinktext(reference.link);
    const resolvedFile = app.metadataCache.getFirstLinkpathDest(parsed.path, referrerPath);
    if (!resolvedFile || resolvedFile.path !== sourceFile.path) {
      return [];
    }

    const currentText = content.slice(startOffset, endOffset);
    const nextText = buildReplacementReference(
      app,
      targetFile,
      referrerPath,
      parsed.subpath,
      reference.displayText,
      isEmbed,
    );

    if (!currentText || currentText === nextText) {
      return [];
    }

    return [
      {
        start: startOffset,
        end: endOffset,
        text: nextText,
      },
    ];
  });
}

function buildReplacementReference(
  app: App,
  targetFile: TFile,
  referrerPath: string,
  subpath: string,
  displayText: string | undefined,
  isEmbed: boolean,
): string {
  const replacement = app.fileManager.generateMarkdownLink(
    targetFile,
    referrerPath,
    subpath || undefined,
    displayText,
  );

  if (isEmbed && !replacement.startsWith("!")) {
    return `!${replacement}`;
  }

  return replacement;
}

function getFrontmatterEndOffset(content: string): number {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/);
  return match ? match[0].length : 0;
}

function renderFileSuggestion(
  file: TFile,
  el: HTMLElement,
  plugin: MergeOpenTargetPlugin,
  sourceFile?: TFile,
  aiRecommendation?: { file?: TFile; path?: string; confidence?: number } | null,
): void {
  try {
    if (!file || !el) return;
    el.empty();
    el.addClass("mod-complex");

    const contentEl = el.createDiv({ cls: "suggestion-content" });
    const titleRowEl = contentEl.createDiv({ cls: "suggestion-title" });
    titleRowEl.createSpan({
      cls: "suggestion-title",
      text: file.basename || file.name || "Untitled",
    });

    const isAi = aiRecommendation && (
      (aiRecommendation.file && file.path === aiRecommendation.file.path) ||
      file.path === aiRecommendation.path
    );
    const recentList = Array.isArray(plugin?.settings?.recentFilePaths) ? plugin.settings.recentFilePaths : [];

    if (isAi) {
      const confVal = typeof aiRecommendation.confidence === "number" ? aiRecommendation.confidence : 1;
      const pct = Math.round(confVal <= 1 ? confVal * 100 : confVal);
      titleRowEl.createSpan({
        cls: "suggestion-flair mod-ai",
        text: `AI推荐 ${pct}%`,
      });
    } else if (sourceFile && file.basename && file.basename === sourceFile.basename) {
      titleRowEl.createSpan({
        cls: "suggestion-flair",
        text: "同名",
      });
    } else if (
      sourceFile &&
      sourceFile.basename &&
      file.basename &&
      sourceFile.basename.length >= 2 &&
      file.basename.length >= 2 &&
      (file.basename.toLowerCase().includes(sourceFile.basename.toLowerCase()) ||
        sourceFile.basename.toLowerCase().includes(file.basename.toLowerCase()))
    ) {
      titleRowEl.createSpan({
        cls: "suggestion-flair",
        text: "相似",
      });
    } else if (file.path && recentList.includes(file.path)) {
      titleRowEl.createSpan({
        cls: "suggestion-flair",
        text: "最近",
      });
    }

    const aliases = getAliases(file, plugin?.app, plugin?.aliasCache);
    if (aliases && aliases.length > 0) {
      contentEl.createDiv({
        cls: "suggestion-note",
        text: `aliases: ${aliases.join(" / ")}`,
      });
    }

    if (file.path) {
      contentEl.createDiv({
        cls: "suggestion-note",
        text: file.path,
      });
    }
  } catch (err) {
    console.error("[MergeOpenTarget] renderFileSuggestion error:", err, file);
  }
}

function getFileSearchText(plugin: MergeOpenTargetPlugin, file: TFile): string {
  const aliases = getAliases(file, plugin.app, plugin.aliasCache);
  return [...aliases, file.basename, file.path].join(" ");
}

function getFileSuggestions(
  files: TFile[],
  query: string,
  app: App,
  aliasCache: Map<string, string[]>,
  recentFilePaths: string[],
  aiRecommendedFile?: TFile,
): FuzzyMatch<TFile>[] {
  const normalizedQuery = (query || "").trim().toLocaleLowerCase();
  const safeRecent = Array.isArray(recentFilePaths) ? recentFilePaths : [];
  const recentRank = new Map(safeRecent.map((path, index) => [path, index]));

  if (!normalizedQuery) {
    return files.slice(0, 100).map((file) => ({
      item: file,
      match: {
        score: 0,
        matches: [],
      },
    }));
  }

  const search = prepareFuzzySearch(normalizedQuery);

  return files
    .map((file) => {
      if (!file) return null;
      const aliases = getAliases(file, app, aliasCache);
      const searchText = getSearchCorpus(file, aliases);
      const match = search(searchText);

      if (!match) {
        return null;
      }

      const isAi = !!(aiRecommendedFile && file.path === aiRecommendedFile.path);
      const baseName = (file.basename || "").toLocaleLowerCase();
      const aliasExact = aliases.some((alias) => (alias || "").toLocaleLowerCase() === normalizedQuery);
      const aliasPrefix = aliases.some((alias) =>
        (alias || "").toLocaleLowerCase().startsWith(normalizedQuery),
      );
      const titleExact = baseName === normalizedQuery;
      const titlePrefix = baseName.startsWith(normalizedQuery);
      const recent = recentRank.get(file.path) ?? Number.POSITIVE_INFINITY;

      return {
        item: file,
        match,
        isAi,
        aliasExact,
        aliasPrefix,
        titleExact,
        titlePrefix,
        recent,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => {
      if (a.isAi !== b.isAi) {
        return a.isAi ? -1 : 1;
      }

      if (a.aliasExact !== b.aliasExact) {
        return a.aliasExact ? -1 : 1;
      }

      if (a.titleExact !== b.titleExact) {
        return a.titleExact ? -1 : 1;
      }

      if (a.aliasPrefix !== b.aliasPrefix) {
        return a.aliasPrefix ? -1 : 1;
      }

      if (a.titlePrefix !== b.titlePrefix) {
        return a.titlePrefix ? -1 : 1;
      }

      if (a.match.score !== b.match.score) {
        return b.match.score - a.match.score;
      }

      if (a.item.basename === b.item.basename && a.recent !== b.recent) {
        return a.recent - b.recent;
      }

      return (a.item.path || "").localeCompare(b.item.path || "", "zh-Hans-CN");
    })
    .slice(0, 100)
    .map(({ item, match }) => ({ item, match }));
}

function getSearchCorpus(file: TFile, aliases: string[]): string {
  return [...aliases, file.basename, file.path].join(" \n ");
}

function getAliases(file: TFile, app?: App, aliasCache?: Map<string, string[]>): string[] {
  const cachedAliases = aliasCache?.get(file.path);
  if (cachedAliases) {
    return cachedAliases;
  }

  const aliases = readAliasesFromMetadata(file, app);
  aliasCache?.set(file.path, aliases);
  return aliases;
}

function readAliasesFromMetadata(file: TFile, app?: App): string[] {
  const cache = app?.metadataCache.getFileCache(file);
  const rawAliases: unknown = cache?.frontmatter?.aliases;
  if (typeof rawAliases === "string") {
    return [rawAliases];
  }

  if (Array.isArray(rawAliases)) {
    return rawAliases.filter((alias): alias is string => typeof alias === "string");
  }

  return [];
}

function sortCandidateFiles(
  files: TFile[],
  recentFilePaths: string[],
  sourceFile?: TFile,
  aiRecommendedFile?: TFile,
): TFile[] {
  const safeRecent = Array.isArray(recentFilePaths) ? recentFilePaths : [];
  const recentRank = new Map(safeRecent.map((path, index) => [path, index]));

  return [...files].sort((a, b) => {
    if (aiRecommendedFile) {
      const aAi = a.path === aiRecommendedFile.path;
      const bAi = b.path === aiRecommendedFile.path;
      if (aAi && !bAi) return -1;
      if (!aAi && bAi) return 1;
    }
    if (sourceFile) {
      const aSame = a.basename === sourceFile.basename;
      const bSame = b.basename === sourceFile.basename;
      if (aSame && !bSame) return -1;
      if (!aSame && bSame) return 1;

      const isSimilar = (name1: string, name2: string) => {
        if (name1.length < 2 || name2.length < 2) return false;
        const n1 = name1.toLowerCase();
        const n2 = name2.toLowerCase();
        return n1.includes(n2) || n2.includes(n1);
      };

      const aSimilar = isSimilar(a.basename, sourceFile.basename);
      const bSimilar = isSimilar(b.basename, sourceFile.basename);
      if (aSimilar && !bSimilar) return -1;
      if (!aSimilar && bSimilar) return 1;

      if (aSimilar && bSimilar) {
        const diff =
          Math.abs(a.basename.length - sourceFile.basename.length) -
          Math.abs(b.basename.length - sourceFile.basename.length);
        if (diff !== 0) return diff > 0 ? 1 : -1;
      }
    }

    const modifiedTimeDiff = b.stat.mtime - a.stat.mtime;
    if (modifiedTimeDiff !== 0) {
      return modifiedTimeDiff;
    }

    const aRank = recentRank.get(a.path) ?? Number.POSITIVE_INFINITY;
    const bRank = recentRank.get(b.path) ?? Number.POSITIVE_INFINITY;
    if (a.basename === b.basename && aRank !== bRank) {
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

const COMMON_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "up", "about", "into", "over", "after", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "this", "that", "these", "those", "it", "its",
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这"
]);

function extractKeyTerms(text: string): string[] {
  if (!text) return [];
  const clean = text.toLowerCase().replace(/[#*`_()[\]~>|\n\r\t-]/g, " ");
  const rawTokens = clean.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z0-9]{2,}/g) || [];
  const freqMap = new Map<string, number>();
  for (const token of rawTokens) {
    if (COMMON_STOP_WORDS.has(token)) continue;
    freqMap.set(token, (freqMap.get(token) || 0) + 1);
  }
  return Array.from(freqMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([term]) => term);
}

function getBM25TopCandidates(
  allFiles: TFile[],
  queryTerms: string[],
  plugin: MergeOpenTargetPlugin,
  sourceFile: TFile,
  maxCount = 20
): TFile[] {
  if (!queryTerms || queryTerms.length === 0) return [];
  const N = allFiles.length;
  if (N === 0) return [];
  const docFreq = new Map<string, number>();
  const fileData = allFiles.map((file) => {
    const aliases = getAliases(file, plugin.app, plugin.aliasCache);
    const corpus = `${file.basename} ${aliases.join(" ")} ${file.path}`.toLowerCase();
    for (const term of queryTerms) {
      if (corpus.includes(term)) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }
    return { file, corpus };
  });
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const df = docFreq.get(term) || 0;
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  const k1 = 1.2;
  const b = 0.75;
  const avgdl = 15;
  const scored = fileData.map(({ file, corpus }) => {
    let score = 0;
    const dl = corpus.length;
    for (const term of queryTerms) {
      if (!corpus.includes(term)) continue;
      const tf = corpus.split(term).length - 1;
      const termIdf = idf.get(term) || 0;
      const num = tf * (k1 + 1);
      const denom = tf + k1 * (1 - b + b * (dl / avgdl));
      let termScore = termIdf * (num / denom);
      if (file.basename.toLowerCase().includes(term)) {
        termScore *= 3.0;
      }
      score += termScore;
    }
    return { file, score };
  });
  return scored
    .filter((entry) => entry.score > 0 && entry.file.path !== sourceFile.path)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .map((entry) => entry.file);
}
