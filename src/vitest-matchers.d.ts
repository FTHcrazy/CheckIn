/**
 * jest-dom 匹配器类型声明（仅测试期生效）
 *
 * why：`@testing-library/jest-dom` 在 vitest 下的类型增强需要显式 import，
 * 而项目把它放在仓库根的 vitest.setup.ts（不在 tsconfig.app.json 的
 * include: ["src"] 范围内），于是 toBeInTheDocument / toBeDisabled 这类
 * 匹配器在组件测试里会报 TS2339。
 * 这里在 src 内声明一次，让所有 *.test.tsx 直接获得匹配器类型。
 */
import "@testing-library/jest-dom/vitest";
