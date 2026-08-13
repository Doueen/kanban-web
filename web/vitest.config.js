/* Vitest（M1-6 E11）：node 环境跑纯函数；组件测试文件用
 * `// @vitest-environment happy-dom` 文件级注释切换（pager.test.js 等）。 */
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
