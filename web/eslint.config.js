/* ESLint 9 flat config + eslint-plugin-vue + prettier（M1-6 E11 工程化地基）。
 * 只做静态检查，不触碰构建链（vite.config.js / package.json 构建脚本零改动）。
 */
import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";

export default [
  { ignores: ["dist/**", "node_modules/**", "public/sw.js"] },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        fetch: "readonly",
        console: "readonly",
        URL: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        btoa: "readonly",
        atob: "readonly",
        crypto: "readonly",
        AbortController: "readonly",
        Audio: "readonly",
        Image: "readonly",
        DragEvent: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        TouchEvent: "readonly",
        PointerEvent: "readonly",
        Node: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        innerWidth: "readonly",
        devicePixelRatio: "readonly",
        visualViewport: "readonly",
        Notification: "readonly",
        Headers: "readonly",
        FormData: "readonly",
        matchMedia: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      /* 组件名全部为单次命名，关闭强制多词（存量约定，不逐改名） */
      "vue/multi-word-component-names": "off",
      /* 模板内未使用变量由 Vue 编译器保证，避免误报 */
      "vue/no-unused-vars": "off",
      /* 存量代码历史包袱：先开放，避免 --fix 引入行为差异（M3 再收严） */
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      "no-empty": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
    },
  },
];
