import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const hexColor = "/#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/";
const rawColorMessage =
  "Use semantic token utilities (bg-surface, text-text-muted) instead of raw color values.";

export const ignores = {
  ignores: [
    "**/node_modules/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/dist/**",
    "**/coverage/**",
    "**/next-env.d.ts",
  ],
};

export const base = tseslint.config(js.configs.recommended, ...tseslint.configs.strict, {
  languageOptions: {
    globals: { ...globals.node },
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
});

export const react = [
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];

export function tokensOnly(files) {
  return {
    files,
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${hexColor}]`, message: rawColorMessage },
        { selector: `TemplateElement[value.raw=${hexColor}]`, message: rawColorMessage },
      ],
    },
  };
}

const localeSensitiveMethods = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
]);
const intlFormatters = new Set([
  "DateTimeFormat",
  "NumberFormat",
  "RelativeTimeFormat",
  "PluralRules",
  "ListFormat",
]);
const fixedLocaleMessage =
  "Client components render on the server and in the browser, so format with a fixed locale (formatDate or formatCount from @cohory/ui/lib) to avoid hydration mismatches.";

function missingLocale(args) {
  const [first] = args;
  return first === undefined || (first.type === "Identifier" && first.name === "undefined");
}

function isClientModule(program) {
  return program.body.some((node) => node.directive === "use client");
}

const fixedLocaleRule = {
  meta: { type: "problem", schema: [], messages: { fixedLocale: fixedLocaleMessage } },
  create(context) {
    if (!isClientModule(context.sourceCode.ast)) return {};
    function checkIntl(node) {
      const { callee, parent } = node;
      if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return;
      if (callee.object.name !== "Intl" || !intlFormatters.has(callee.property.name)) return;
      const readsResolvedOptions =
        parent.type === "MemberExpression" &&
        parent.object === node &&
        parent.property.name === "resolvedOptions";
      if (readsResolvedOptions || !missingLocale(node.arguments)) return;
      context.report({ node, messageId: "fixedLocale" });
    }
    return {
      NewExpression: checkIntl,
      CallExpression(node) {
        checkIntl(node);
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
        if (!localeSensitiveMethods.has(callee.property.name)) return;
        if (missingLocale(node.arguments)) context.report({ node, messageId: "fixedLocale" });
      },
    };
  },
};

export function fixedLocale(files, ignores = []) {
  return {
    files,
    ignores,
    plugins: { cohory: { rules: { "fixed-locale": fixedLocaleRule } } },
    rules: { "cohory/fixed-locale": "error" },
  };
}

export function next(rootDir, files) {
  return {
    files,
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  };
}
