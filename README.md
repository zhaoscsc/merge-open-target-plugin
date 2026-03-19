# Merge And Open Target

An Obsidian plugin for moving note content into another note and opening the target note immediately after the merge.

一个 Obsidian 插件，用来把整篇笔记或当前选中的内容合并到另一篇笔记，并在完成后自动打开目标笔记。

## Why This Plugin

Obsidian's built-in Note composer is great for merging notes, but some workflows still feel missing:

- After merging note A into note B, open note B automatically
- Merge only the current selection into another note
- Skip source frontmatter when merging a whole note

This plugin exists to make that workflow feel faster and more direct.

## Features

- Merge the current note into another note and open the target note
- Merge selected text into another note and open the target note
- Strip source frontmatter when merging a whole note
- Append to the target note or prepend to the beginning
- Optionally move the source note to trash after a whole-note merge
- Ask for confirmation before merging

## Commands

- `Merge current file into another note and open target`
- `Merge selected text into another note and open target`

## Current Behavior

### Whole-note merge

- Merges the source note body into the target note
- Does not merge the source note's frontmatter into the target
- Can optionally move the source note to trash after merge
- Opens the target note after merge

### Selected-text merge

- Merges only the selected text into the target note
- Removes the selected text from the source note
- Opens the target note after merge

## What's New in v0.1.2

- Show a subtle `最近` badge for recently opened note suggestions
- Makes duplicate note titles easier to distinguish at a glance

## Previous Update in v0.1.1

- Search target notes by note title instead of full path
- Still show full path in the suggestion list for disambiguation
- When duplicate note titles exist, prioritize the note you opened most recently

## Settings

- Merge position: append to end or prepend to beginning
- Separator: custom text inserted between merged contents
- Trash source after whole-note merge
- Confirm before merge

## Install

### Manual install

Copy these files into your vault at `.obsidian/plugins/merge-open-target/`:

- `main.js`
- `manifest.json`
- `versions.json`

Then reload community plugins in Obsidian.

## Development

```bash
npm install
npm run build
```

## Notes

- This plugin currently works as an alternative command workflow rather than patching Obsidian's core Note composer command directly.
- When merging selected text, the current behavior is move, not copy.

## 中文说明

这个插件适合下面两类场景：

- 你把 A 合并到 B 以后，希望自动打开 B
- 你只想把当前选中的一段内容并到别的笔记，而不是整篇移动

当前版本特点：

- 整篇合并时，不会把源笔记的 frontmatter 合并过去
- 选区合并时，会把选中内容移动到目标笔记，并从原笔记删除
- 支持合并到目标笔记开头或末尾
- 支持合并前确认

## License

MIT
