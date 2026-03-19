"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MergeOpenTargetPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  mergePosition: "append",
  separator: "\n\n",
  trashSourceAfterMerge: true,
  confirmBeforeMerge: true
};
var MergeOpenTargetPlugin = class extends import_obsidian.Plugin {
  settings;
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "merge-current-file-into-another-and-open-target",
      name: "Merge current file into another note and open target",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const available = activeFile instanceof import_obsidian.TFile && activeFile.extension === "md";
        if (!available) {
          return false;
        }
        if (!checking) {
          new FileMergeTargetModal(this.app, activeFile, this).open();
        }
        return true;
      }
    });
    this.addCommand({
      id: "merge-selected-text-into-another-and-open-target",
      name: "Merge selected text into another note and open target",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        const activeFile = this.app.workspace.getActiveFile();
        if (!(view instanceof import_obsidian.MarkdownView) || !(activeFile instanceof import_obsidian.TFile)) {
          new import_obsidian.Notice("\u8BF7\u5148\u805A\u7126\u5230\u4E00\u7BC7 Markdown \u7B14\u8BB0\u7684\u7F16\u8F91\u5668\u3002");
          return;
        }
        const editor = view.editor;
        if (!editor.somethingSelected() || editor.getSelection().trim().length === 0) {
          new import_obsidian.Notice("\u8BF7\u5148\u9009\u4E2D\u8981\u5408\u5E76\u7684\u5185\u5BB9\u3002");
          return;
        }
        new SelectionMergeTargetModal(this.app, activeFile, editor, this).open();
      }
    });
    this.addSettingTab(new MergeOpenTargetSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async mergeIntoTarget(sourceFile, targetFile) {
    if (sourceFile.path === targetFile.path) {
      new import_obsidian.Notice("\u6E90\u7B14\u8BB0\u548C\u76EE\u6807\u7B14\u8BB0\u4E0D\u80FD\u662F\u540C\u4E00\u7BC7\u3002");
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
      state: { mode: "source" }
    });
    new import_obsidian.Notice(`\u5DF2\u5408\u5E76\u5230\u300C${targetFile.basename}\u300D\u5E76\u6253\u5F00\u76EE\u6807\u7B14\u8BB0\u3002`);
  }
  async mergeSelectedTextIntoTarget(sourceFile, selectedText, targetFile, editor) {
    if (sourceFile.path === targetFile.path) {
      new import_obsidian.Notice("\u6E90\u7B14\u8BB0\u548C\u76EE\u6807\u7B14\u8BB0\u4E0D\u80FD\u662F\u540C\u4E00\u7BC7\u3002");
      return;
    }
    const contentToMerge = selectedText.trim();
    if (!contentToMerge) {
      new import_obsidian.Notice("\u6CA1\u6709\u53EF\u5408\u5E76\u7684\u9009\u4E2D\u5185\u5BB9\u3002");
      return;
    }
    const targetContent = await this.app.vault.cachedRead(targetFile);
    const mergedContent = this.buildMergedContent(contentToMerge, targetContent);
    await this.app.vault.modify(targetFile, mergedContent);
    editor.replaceSelection("");
    await this.app.workspace.getLeaf(true).openFile(targetFile, {
      active: true,
      state: { mode: "source" }
    });
    new import_obsidian.Notice(`\u5DF2\u5C06\u9009\u4E2D\u5185\u5BB9\u5408\u5E76\u5230\u300C${targetFile.basename}\u300D\u5E76\u6253\u5F00\u76EE\u6807\u7B14\u8BB0\u3002`);
  }
  buildMergedContent(sourceContent, targetContent) {
    const separator = this.settings.separator;
    if (this.settings.mergePosition === "prepend") {
      return joinContent(sourceContent, targetContent, separator);
    }
    return joinContent(targetContent, sourceContent, separator);
  }
};
var FileMergeTargetModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, sourceFile, plugin) {
    super(app);
    this.sourceFile = sourceFile;
    this.plugin = plugin;
    this.setPlaceholder("\u9009\u62E9\u8981\u5408\u5E76\u8FDB\u5165\u7684\u76EE\u6807\u7B14\u8BB0...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "\u9009\u62E9" },
      { command: "Enter", purpose: "\u5408\u5E76\u5E76\u6253\u5F00\u76EE\u6807\u7B14\u8BB0" },
      { command: "Esc", purpose: "\u53D6\u6D88" }
    ]);
  }
  getItems() {
    return this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path).sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
  }
  getItemText(file) {
    return file.path;
  }
  async onChooseItem(targetFile) {
    if (this.plugin.settings.confirmBeforeMerge) {
      const confirmed = window.confirm(
        `\u628A\u300C${this.sourceFile.basename}\u300D\u5408\u5E76\u5230\u300C${targetFile.basename}\u300D\u540E\uFF0C\u5C06\u81EA\u52A8\u6253\u5F00\u76EE\u6807\u7B14\u8BB0\u3002\u662F\u5426\u7EE7\u7EED\uFF1F`
      );
      if (!confirmed) {
        return;
      }
    }
    try {
      await this.plugin.mergeIntoTarget(this.sourceFile, targetFile);
    } catch (error) {
      console.error("Merge failed", error);
      new import_obsidian.Notice(`\u5408\u5E76\u5931\u8D25\uFF1A${getErrorMessage(error)}`);
    }
  }
};
var SelectionMergeTargetModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, sourceFile, editor, plugin) {
    super(app);
    this.sourceFile = sourceFile;
    this.editor = editor;
    this.plugin = plugin;
    this.selectedText = editor.getSelection();
    this.setPlaceholder("\u9009\u62E9\u8981\u63A5\u6536\u9009\u4E2D\u5185\u5BB9\u7684\u76EE\u6807\u7B14\u8BB0...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "\u9009\u62E9" },
      { command: "Enter", purpose: "\u5408\u5E76\u9009\u4E2D\u5185\u5BB9\u5E76\u6253\u5F00\u76EE\u6807\u7B14\u8BB0" },
      { command: "Esc", purpose: "\u53D6\u6D88" }
    ]);
  }
  selectedText;
  getItems() {
    return this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path).sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
  }
  getItemText(file) {
    return file.path;
  }
  async onChooseItem(targetFile) {
    if (this.plugin.settings.confirmBeforeMerge) {
      const confirmed = window.confirm(
        `\u628A\u5F53\u524D\u9009\u4E2D\u7684\u5185\u5BB9\u5408\u5E76\u5230\u300C${targetFile.basename}\u300D\u540E\uFF0C\u5C06\u81EA\u52A8\u6253\u5F00\u76EE\u6807\u7B14\u8BB0\uFF0C\u5E76\u4ECE\u5F53\u524D\u7B14\u8BB0\u79FB\u9664\u9009\u4E2D\u5185\u5BB9\u3002\u662F\u5426\u7EE7\u7EED\uFF1F`
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
        this.editor
      );
    } catch (error) {
      console.error("Selection merge failed", error);
      new import_obsidian.Notice(`\u5408\u5E76\u5931\u8D25\uFF1A${getErrorMessage(error)}`);
    }
  }
};
var MergeOpenTargetSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("\u5408\u5E76\u4F4D\u7F6E").setDesc("\u628A\u5F53\u524D\u7B14\u8BB0\u5185\u5BB9\u8FFD\u52A0\u5230\u76EE\u6807\u7B14\u8BB0\u672B\u5C3E\uFF0C\u6216\u63D2\u5165\u5230\u76EE\u6807\u7B14\u8BB0\u5F00\u5934\u3002").addDropdown(
      (dropdown) => dropdown.addOption("append", "\u8FFD\u52A0\u5230\u672B\u5C3E").addOption("prepend", "\u63D2\u5165\u5230\u5F00\u5934").setValue(this.plugin.settings.mergePosition).onChange(async (value) => {
        this.plugin.settings.mergePosition = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5206\u9694\u7B26").setDesc("\u5408\u5E76\u4E24\u7BC7\u7B14\u8BB0\u5185\u5BB9\u65F6\u63D2\u5165\u7684\u6587\u672C\uFF0C\u9ED8\u8BA4\u662F\u4E24\u4E2A\u6362\u884C\u3002").addTextArea(
      (textArea) => textArea.setPlaceholder("\\n\\n").setValue(escapeControlChars(this.plugin.settings.separator)).onChange(async (value) => {
        this.plugin.settings.separator = unescapeControlChars(value);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5408\u5E76\u540E\u79FB\u5165\u5E9F\u7EB8\u7BD3").setDesc("\u5F00\u542F\u540E\uFF0C\u6E90\u7B14\u8BB0\u5728\u5408\u5E76\u5B8C\u6210\u540E\u4F1A\u6309 Obsidian \u7684\u5E9F\u7EB8\u7BD3\u8BBE\u7F6E\u79FB\u9664\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.trashSourceAfterMerge).onChange(async (value) => {
        this.plugin.settings.trashSourceAfterMerge = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5408\u5E76\u524D\u786E\u8BA4").setDesc("\u5F00\u542F\u540E\uFF0C\u6267\u884C\u5408\u5E76\u524D\u4F1A\u518D\u5F39\u4E00\u6B21\u786E\u8BA4\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.confirmBeforeMerge).onChange(async (value) => {
        this.plugin.settings.confirmBeforeMerge = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
function joinContent(first, second, separator) {
  if (!first.trim()) {
    return second;
  }
  if (!second.trim()) {
    return first;
  }
  return `${first}${separator}${second}`;
}
function stripFrontmatter(content) {
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
function escapeControlChars(value) {
  return value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
function unescapeControlChars(value) {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "	");
}
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
