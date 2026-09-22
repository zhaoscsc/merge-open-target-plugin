import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: ["main.js", "esbuild.config.mjs", "node_modules/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
  },
];
