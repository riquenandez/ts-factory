import js from "@eslint/js";
import tseslint from "typescript-eslint";

const ignores = [
  "**/python-gold/**",
  ".claude/skills/sssf/apps/visualizer/**",
  ".claude/skills/sssf/templates/harness_engineering/**",
  "**/node_modules/**",
  "**/fixtures/repo_*/**",
];

const sources = [
  ".claude/skills/sssf/templates/adws/**/*.ts",
  ".claude/skills/sssf/scripts/**/*.ts",
  "tools/parity/**/*.ts",
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
      // PORT_CONTRACT: identifiers are camelCase; wire fields (object keys, class fields,
      // destructured sqlite/JSON columns) keep their Python snake_case spelling.
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "variable", modifiers: ["destructured"], format: null },
        {
          selector: ["variable", "function", "parameter", "classMethod", "typeLike"],
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
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
