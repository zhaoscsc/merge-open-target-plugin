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
  updateLinksAfterMerge: true,
  trashSourceAfterMerge: true,
  confirmBeforeMerge: true,
  recentFilePaths: [],
  enableJevRecommend: false,
  typesafeApiKey: "",
  jevMinConfidence: 0.6
};
var MergeOpenTargetPlugin = class extends import_obsidian.Plugin {
  settings;
  aliasCache = /* @__PURE__ */ new Map();
  async onload() {
    await this.loadSettings();
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof import_obsidian.TFile) {
          this.refreshAliasCacheForFile(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") {
          return;
        }
        if (oldPath && oldPath !== file.path) {
          this.aliasCache.delete(oldPath);
        }
        this.refreshAliasCacheForFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof import_obsidian.TFile) {
          this.aliasCache.delete(file.path);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") {
          return;
        }
        const updatedRecentPaths = [
          file.path,
          ...this.settings.recentFilePaths.filter((path) => path !== file.path)
        ].slice(0, 100);
        if (!isSamePathList(updatedRecentPaths, this.settings.recentFilePaths)) {
          this.settings.recentFilePaths = updatedRecentPaths;
          await this.saveSettings();
        }
      })
    );
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
          void this.openFileMergeTargetModal(activeFile);
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
        void this.openSelectionMergeTargetModal(activeFile, editor);
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
  async openFileMergeTargetModal(sourceFile) {
    new FileMergeTargetModal(this.app, sourceFile, this).open();
  }
  async openSelectionMergeTargetModal(sourceFile, editor) {
    new SelectionMergeTargetModal(this.app, sourceFile, editor, this).open();
  }
  refreshAliasCacheForFile(file) {
    if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") {
      return;
    }
    this.aliasCache.set(file.path, readAliasesFromMetadata(file, this.app));
  }
  async mergeIntoTarget(sourceFile, targetFile) {
    if (sourceFile.path === targetFile.path) {
      new import_obsidian.Notice("\u6E90\u7B14\u8BB0\u548C\u76EE\u6807\u7B14\u8BB0\u4E0D\u80FD\u662F\u540C\u4E00\u7BC7\u3002");
      return;
    }
    const shouldUpdateLinks = this.settings.updateLinksAfterMerge;
    const referrerFiles = shouldUpdateLinks ? getMarkdownReferrersToFile(this.app, sourceFile.path).filter(
      (file) => file.path !== sourceFile.path && file.path !== targetFile.path
    ) : [];
    const sourceRawContent = await this.app.vault.cachedRead(sourceFile);
    const processedSourceRawContent = shouldUpdateLinks ? rewriteLinksInFileContent(
      this.app,
      sourceRawContent,
      sourceFile,
      sourceFile,
      targetFile
    ) : sourceRawContent;
    const sourceContent = stripFrontmatter(processedSourceRawContent);
    const targetOriginalContent = await this.app.vault.cachedRead(targetFile);
    const targetContent = shouldUpdateLinks ? rewriteLinksInFileContent(
      this.app,
      targetOriginalContent,
      targetFile,
      sourceFile,
      targetFile
    ) : targetOriginalContent;
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
  async queryJevRecommend(sourceSnippet, candidateFiles) {
    if (!this.settings.enableJevRecommend || !this.settings.typesafeApiKey?.trim()) {
      return null;
    }
    if (!candidateFiles || candidateFiles.length === 0) {
      return null;
    }
    try {
      const topCandidates = candidateFiles.slice(0, 30);
      const criteria = {};
      const keyToFileMap = {};
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
      const response = await (0, import_obsidian.requestUrl)({
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
      const data = response.json;
      const decision = data?.answers?.recommended_target_note || data?.results?.recommended_target_note || data?.questions?.recommended_target_note || data?.recommended_target_note;
      const choice = decision?.choice || decision?.selected || decision?.value;
      const confidence = typeof decision?.confidence === "number" ? decision.confidence : decision?.probability ?? 1;
      const minConfidence = this.settings.jevMinConfidence ?? 0.6;
      console.log("[MergeOpenTarget] Jev decision:", { choice, confidence, minConfidence, target: keyToFileMap[choice]?.path });
      if (choice && keyToFileMap[choice] && confidence >= minConfidence) {
        return {
          file: keyToFileMap[choice],
          confidence
        };
      }
      return null;
    } catch (err) {
      console.warn("TypeSafe Jev recommendation request failed silently:", err);
      return null;
    }
  }
};
var FileMergeTargetModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, sourceFile, plugin) {
    super(app);
    this.sourceFile = sourceFile;
    this.plugin = plugin;
    this.cachedItems = sortCandidateFiles(
      this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path),
      this.plugin.settings.recentFilePaths,
      this.sourceFile
    );
    this.setPlaceholder("\u9009\u62E9\u8981\u5408\u5E76\u8FDB\u5165\u7684\u76EE\u6807\u7B14\u8BB0...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "\u9009\u62E9" },
      { command: "Enter", purpose: "\u5408\u5E76\u5E76\u6253\u5F00\u76EE\u6807\u7B14\u8BB0" },
      { command: "Esc", purpose: "\u53D6\u6D88" }
    ]);
  }
  cachedItems;
  aiRecommendation = null;
  onOpen() {
    super.onOpen();
    if (this.plugin.settings.enableJevRecommend && this.plugin.settings.typesafeApiKey?.trim()) {
      void this.fetchJevRecommendation();
    }
  }
  async fetchJevRecommendation() {
    try {
      const content = await this.app.vault.cachedRead(this.sourceFile);
      const cleanContent = stripFrontmatter(content).trim();
      const snippet = `Title: ${this.sourceFile.basename}

Content snippet:
${cleanContent.slice(0, 600)}`;
      const queryTerms = extractKeyTerms(`${this.sourceFile.basename} ${cleanContent.slice(0, 400)}`);
      const allVaultFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path !== this.sourceFile.path);
      const bm25Candidates = getBM25TopCandidates(allVaultFiles, queryTerms, this.plugin, this.sourceFile, 20);
      const seen = /* @__PURE__ */ new Set();
      const combinedCandidates = [];
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
  getItems() {
    return this.cachedItems;
  }
  getSuggestions(query) {
    return getFileSuggestions(
      this.getItems(),
      query,
      this.plugin.app,
      this.plugin.aliasCache,
      this.plugin.settings.recentFilePaths,
      this.aiRecommendation?.file
    );
  }
  getItemText(file) {
    return getFileSearchText(this.plugin, file);
  }
  renderSuggestion(match, el) {
    const targetFile = match?.item || match;
    renderFileSuggestion(targetFile, el, this.plugin, this.sourceFile, this.aiRecommendation);
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
    this.cachedItems = sortCandidateFiles(
      this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourceFile.path),
      this.plugin.settings.recentFilePaths,
      this.sourceFile
    );
    this.setPlaceholder("\u9009\u62E9\u8981\u63A5\u6536\u9009\u4E2D\u5185\u5BB9\u7684\u76EE\u6807\u7B14\u8BB0...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "\u9009\u62E9" },
      { command: "Enter", purpose: "\u5408\u5E76\u9009\u4E2D\u5185\u5BB9\u5E76\u6253\u5F00\u76EE\u6807\u7B14\u8BB0" },
      { command: "Esc", purpose: "\u53D6\u6D88" }
    ]);
  }
  selectedText;
  cachedItems;
  aiRecommendation = null;
  onOpen() {
    super.onOpen();
    if (this.plugin.settings.enableJevRecommend && this.plugin.settings.typesafeApiKey?.trim()) {
      void this.fetchJevRecommendation();
    }
  }
  async fetchJevRecommendation() {
    try {
      const snippet = `Source Note: ${this.sourceFile.basename}

Selected content to merge:
${this.selectedText.trim().slice(0, 600)}`;
      const queryTerms = extractKeyTerms(`${this.sourceFile.basename} ${this.selectedText.trim().slice(0, 400)}`);
      const allVaultFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path !== this.sourceFile.path);
      const bm25Candidates = getBM25TopCandidates(allVaultFiles, queryTerms, this.plugin, this.sourceFile, 20);
      const seen = /* @__PURE__ */ new Set();
      const combinedCandidates = [];
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
  getItems() {
    return this.cachedItems;
  }
  getSuggestions(query) {
    return getFileSuggestions(
      this.getItems(),
      query,
      this.plugin.app,
      this.plugin.aliasCache,
      this.plugin.settings.recentFilePaths,
      this.aiRecommendation?.file
    );
  }
  getItemText(file) {
    return getFileSearchText(this.plugin, file);
  }
  renderSuggestion(match, el) {
    const targetFile = match?.item || match;
    renderFileSuggestion(targetFile, el, this.plugin, this.sourceFile, this.aiRecommendation);
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
    new import_obsidian.Setting(containerEl).setName("\u6574\u7BC7\u5408\u5E76\u540E\u540C\u6B65\u66F4\u65B0\u6307\u5411\u6E90\u7B14\u8BB0\u7684\u94FE\u63A5").setDesc(
      "\u4EC5\u5BF9\u201C\u6574\u7BC7\u5408\u5E76\u201D\u751F\u6548\u3002\u5F00\u542F\u540E\uFF0C\u4F1A\u628A\u6240\u6709\u5DF2\u89E3\u6790\u5230\u6E90\u7B14\u8BB0\u7684\u53CC\u94FE\u4E0E embed \u94FE\u63A5\u6539\u5199\u4E3A\u6307\u5411\u76EE\u6807\u7B14\u8BB0\u3002"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.updateLinksAfterMerge).onChange(async (value) => {
        this.plugin.settings.updateLinksAfterMerge = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5408\u5E76\u524D\u786E\u8BA4").setDesc("\u5F00\u542F\u540E\uFF0C\u6267\u884C\u5408\u5E76\u524D\u4F1A\u518D\u5F39\u4E00\u6B21\u786E\u8BA4\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.confirmBeforeMerge).onChange(async (value) => {
        this.plugin.settings.confirmBeforeMerge = value;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "TypeSafe AI (Jev) \u667A\u80FD\u63A8\u8350" });
    new import_obsidian.Setting(containerEl).setName("\u542F\u7528 Jev \u8BED\u4E49\u63A8\u8350\u76EE\u6807\u7B14\u8BB0").setDesc("\u8C03\u7528 TypeSafe AI \u7684 Jev (System One) \u6A21\u578B\uFF0C\u57FA\u4E8E\u5F53\u524D\u7B14\u8BB0\u5185\u5BB9\u6216\u9009\u533A\u667A\u80FD\u9884\u6D4B\u6700\u9002\u5408\u5408\u5E76\u7684\u76EE\u6807\u7B14\u8BB0\u5E76\u7F6E\u9876\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableJevRecommend).onChange(async (value) => {
        this.plugin.settings.enableJevRecommend = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (this.plugin.settings.enableJevRecommend) {
      new import_obsidian.Setting(containerEl).setName("TypeSafe API Key").setDesc("\u5728 https://console.typesafe.ai/ \u83B7\u53D6\u7684 API Key\u3002").addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("ts-...").setValue(this.plugin.settings.typesafeApiKey).onChange(async (value) => {
          this.plugin.settings.typesafeApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian.Setting(containerEl).setName("\u6700\u4F4E\u7F6E\u4FE1\u5EA6\u9608\u503C").setDesc("\u4EC5\u5F53 Jev \u51B3\u7B56\u7F6E\u4FE1\u5EA6\u9AD8\u4E8E\u6B64\u9608\u503C\u65F6\u624D\u8FDB\u884C\u7F6E\u9876\uFF080.1 ~ 1.0\uFF0C\u9ED8\u8BA4 0.6\uFF09\u3002").addSlider(
        (slider) => slider.setLimits(0.1, 1, 0.05).setValue(this.plugin.settings.jevMinConfidence ?? 0.6).setDynamicTooltip().onChange(async (value) => {
          this.plugin.settings.jevMinConfidence = value;
          await this.plugin.saveSettings();
        })
      );
    }
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
function getMarkdownReferrersToFile(app, targetPath) {
  const resolvedLinks = app.metadataCache.resolvedLinks ?? {};
  return Object.entries(resolvedLinks).filter(([, links]) => (links?.[targetPath] ?? 0) > 0).map(([sourcePath]) => app.vault.getAbstractFileByPath(sourcePath)).filter((file) => file instanceof import_obsidian.TFile && file.extension === "md");
}
async function rewriteLinksInFiles(app, files, sourceFile, targetFile) {
  for (const file of files) {
    const originalContent = await app.vault.cachedRead(file);
    const updatedContent = rewriteLinksInFileContent(
      app,
      originalContent,
      file,
      sourceFile,
      targetFile
    );
    if (updatedContent !== originalContent) {
      await app.vault.modify(file, updatedContent);
    }
  }
}
function rewriteLinksInFileContent(app, content, referrerFile, sourceFile, targetFile) {
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
    frontmatterEndOffset
  ).concat(
    collectLinkReplacements(
      app,
      fileCache.embeds ?? [],
      true,
      referrerFile.path,
      sourceFile,
      targetFile,
      content,
      frontmatterEndOffset
    )
  ).sort((a, b) => b.start - a.start);
  if (replacements.length === 0) {
    return content;
  }
  let nextContent = content;
  for (const replacement of replacements) {
    nextContent = `${nextContent.slice(0, replacement.start)}${replacement.text}${nextContent.slice(replacement.end)}`;
  }
  return nextContent;
}
function collectLinkReplacements(app, references, isEmbed, referrerPath, sourceFile, targetFile, content, frontmatterEndOffset) {
  return references.flatMap((reference) => {
    const startOffset = reference.position?.start?.offset;
    const endOffset = reference.position?.end?.offset;
    if (typeof startOffset !== "number" || typeof endOffset !== "number" || startOffset >= endOffset) {
      return [];
    }
    if (frontmatterEndOffset > 0 && startOffset < frontmatterEndOffset) {
      return [];
    }
    const parsed = (0, import_obsidian.parseLinktext)(reference.link);
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
      isEmbed
    );
    if (!currentText || currentText === nextText) {
      return [];
    }
    return [
      {
        start: startOffset,
        end: endOffset,
        text: nextText
      }
    ];
  });
}
function buildReplacementReference(app, targetFile, referrerPath, subpath, displayText, isEmbed) {
  const replacement = app.fileManager.generateMarkdownLink(
    targetFile,
    referrerPath,
    subpath || void 0,
    displayText
  );
  if (isEmbed && !replacement.startsWith("!")) {
    return `!${replacement}`;
  }
  return replacement;
}
function getFrontmatterEndOffset(content) {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/);
  return match ? match[0].length : 0;
}
function renderFileSuggestion(file, el, plugin, sourceFile, aiRecommendation) {
  try {
    if (!file || !el) return;
    el.empty();
    el.addClass("mod-complex");
    const contentEl = el.createDiv({ cls: "suggestion-content" });
    const titleRowEl = contentEl.createDiv({ cls: "suggestion-title" });
    titleRowEl.createSpan({
      cls: "suggestion-title",
      text: file.basename || file.name || "Untitled"
    });
    const isAi = aiRecommendation && (aiRecommendation.file && file.path === aiRecommendation.file.path || file.path === aiRecommendation.path);
    const recentList = Array.isArray(plugin?.settings?.recentFilePaths) ? plugin.settings.recentFilePaths : [];
    if (isAi) {
      const confVal = typeof aiRecommendation.confidence === "number" ? aiRecommendation.confidence : 1;
      const pct = Math.round(confVal <= 1 ? confVal * 100 : confVal);
      const flair = titleRowEl.createSpan({
        cls: "suggestion-flair",
        text: `AI\u63A8\u8350 ${pct}%`
      });
      flair.style.backgroundColor = "var(--interactive-accent)";
      flair.style.color = "var(--text-on-accent)";
      flair.style.fontWeight = "bold";
    } else if (sourceFile && file.basename && file.basename === sourceFile.basename) {
      titleRowEl.createSpan({
        cls: "suggestion-flair",
        text: "\u540C\u540D"
      });
    } else if (sourceFile && sourceFile.basename && file.basename && sourceFile.basename.length >= 2 && file.basename.length >= 2 && (file.basename.toLowerCase().includes(sourceFile.basename.toLowerCase()) || sourceFile.basename.toLowerCase().includes(file.basename.toLowerCase()))) {
      titleRowEl.createSpan({
        cls: "suggestion-flair",
        text: "\u76F8\u4F3C"
      });
    } else if (file.path && recentList.includes(file.path)) {
      titleRowEl.createSpan({
        cls: "suggestion-flair",
        text: "\u6700\u8FD1"
      });
    }
    const aliases = getAliases(file, plugin?.app, plugin?.aliasCache);
    if (aliases && aliases.length > 0) {
      contentEl.createDiv({
        cls: "suggestion-note",
        text: `aliases: ${aliases.join(" / ")}`
      });
    }
    if (file.path) {
      contentEl.createDiv({
        cls: "suggestion-note",
        text: file.path
      });
    }
  } catch (err) {
    console.error("[MergeOpenTarget] renderFileSuggestion error:", err, file);
  }
}
function getFileSearchText(plugin, file) {
  const aliases = getAliases(file, plugin.app, plugin.aliasCache);
  return [...aliases, file.basename, file.path].join(" ");
}
function getFileSuggestions(files, query, app, aliasCache, recentFilePaths, aiRecommendedFile) {
  const normalizedQuery = (query || "").trim().toLocaleLowerCase();
  const safeRecent = Array.isArray(recentFilePaths) ? recentFilePaths : [];
  const recentRank = new Map(safeRecent.map((path, index) => [path, index]));
  if (!normalizedQuery) {
    return files.slice(0, 100).map((file) => ({
      item: file,
      match: {
        score: 0,
        matches: []
      }
    }));
  }
  const search = (0, import_obsidian.prepareFuzzySearch)(normalizedQuery);
  return files.map((file) => {
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
    const aliasPrefix = aliases.some(
      (alias) => (alias || "").toLocaleLowerCase().startsWith(normalizedQuery)
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
      recent
    };
  }).filter((entry) => entry !== null).sort((a, b) => {
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
  }).slice(0, 100).map(({ item, match }) => ({ item, match }));
}
function getSearchCorpus(file, aliases) {
  return [...aliases, file.basename, file.path].join(" \n ");
}
function getAliases(file, app, aliasCache) {
  const cachedAliases = aliasCache?.get(file.path);
  if (cachedAliases) {
    return cachedAliases;
  }
  const aliases = readAliasesFromMetadata(file, app);
  aliasCache?.set(file.path, aliases);
  return aliases;
}
function readAliasesFromMetadata(file, app) {
  const cache = app?.metadataCache.getFileCache(file);
  const rawAliases = cache?.frontmatter?.aliases;
  if (typeof rawAliases === "string") {
    return [rawAliases];
  }
  if (Array.isArray(rawAliases)) {
    return rawAliases.filter((alias) => typeof alias === "string");
  }
  return [];
}
function sortCandidateFiles(files, recentFilePaths, sourceFile, aiRecommendedFile) {
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
      const isSimilar = (name1, name2) => {
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
        const diff = Math.abs(a.basename.length - sourceFile.basename.length) - Math.abs(b.basename.length - sourceFile.basename.length);
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
function isSamePathList(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((path, index) => path === b[index]);
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
var COMMON_STOP_WORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "up",
  "about",
  "into",
  "over",
  "after",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "\u7684",
  "\u4E86",
  "\u5728",
  "\u662F",
  "\u6211",
  "\u6709",
  "\u548C",
  "\u5C31",
  "\u4E0D",
  "\u4EBA",
  "\u90FD",
  "\u4E00",
  "\u4E00\u4E2A",
  "\u4E0A",
  "\u4E5F",
  "\u5F88",
  "\u5230",
  "\u8BF4",
  "\u8981",
  "\u53BB",
  "\u4F60",
  "\u4F1A",
  "\u7740",
  "\u6CA1\u6709",
  "\u770B",
  "\u597D",
  "\u81EA\u5DF1",
  "\u8FD9"
]);
function extractKeyTerms(text) {
  if (!text) return [];
  const clean = text.toLowerCase().replace(/[#*`_\[\]()~>|\-\n\r\t]/g, " ");
  const rawTokens = clean.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z0-9]{2,}/g) || [];
  const freqMap = /* @__PURE__ */ new Map();
  for (const token of rawTokens) {
    if (COMMON_STOP_WORDS.has(token)) continue;
    freqMap.set(token, (freqMap.get(token) || 0) + 1);
  }
  return Array.from(freqMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([term]) => term);
}
function getBM25TopCandidates(allFiles, queryTerms, plugin, sourceFile, maxCount = 20) {
  if (!queryTerms || queryTerms.length === 0) return [];
  const N = allFiles.length;
  if (N === 0) return [];
  const docFreq = /* @__PURE__ */ new Map();
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
  const idf = /* @__PURE__ */ new Map();
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
        termScore *= 3;
      }
      score += termScore;
    }
    return { file, score };
  });
  return scored.filter((entry) => entry.score > 0 && entry.file.path !== sourceFile.path).sort((a, b2) => b2.score - a.score).slice(0, maxCount).map((entry) => entry.file);
}
