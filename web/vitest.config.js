/* Vitest（M1-6 E11）：纯函数测试骨架，node 环境即可，无需 DOM。 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
