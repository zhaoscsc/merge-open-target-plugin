# Merge And Open Target

An Obsidian plugin for moving note content into another note and opening the target immediately after the merge.

## Features

- Merge the current note into another note and open the target note
- Merge selected text into another note and open the target note
- Strip frontmatter from the source note when merging a whole file
- Append to the end of the target note or prepend to the beginning
- Optionally move the source note to trash after a whole-note merge

## Commands

- `Merge current file into another note and open target`
- `Merge selected text into another note and open target`

## Behavior

- Whole-note merge:
  - merges the source note body into the target note
  - does not merge source frontmatter into the target
  - can optionally trash the source note after merge
- Selected-text merge:
  - merges only the selected text into the target note
  - removes the selected text from the source note
  - opens the target note after merge

## Development

```bash
npm install
npm run build
```

## Install Locally

Copy these files into your vault at `.obsidian/plugins/merge-open-target/`:

- `main.js`
- `manifest.json`
- `versions.json`

Then reload community plugins in Obsidian.
