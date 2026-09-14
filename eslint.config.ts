import js from "@eslint/js";
import tseslint from "typescript-eslint";

const ignores = [
  "**/python-gold/**",
  ".claude/skills/sssf/apps/visualizer/**",
  ".claude/skills/sssf/templates/harness_engineering/**",
  "**/node_modules/**",
  "**/fixtures/repo_clean/**",
  "**/fixtures/repo_agent/**",
];

const sources = [
  ".claude/skills/sssf/templates/adws/**/*.ts",
  ".claude/skills/sssf/scripts/**/*.ts",
  ".claude/skills/sssf/tools/parity/**/*.ts",
];

export default tseslint.config(
  { ignores },
  {
    files: sources,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [".claude/skills/sssf/templates/adws/**/*.ts"],
    ignores: [".claude/skills/sssf/templates/adws/**/compat/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
          message: "Use pyJson or serdeJson. PORT_CONTRACT forbids JSON.stringify outside compat/.",
        },
      ],
    },
  },
);
