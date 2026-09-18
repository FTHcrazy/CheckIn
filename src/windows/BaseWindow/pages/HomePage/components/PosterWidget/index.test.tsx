import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import PosterWidget from "./index";

describe("PosterWidget 组件", () => {
  afterEach(() => {
    cleanup();
  });

  it("ThemeProvider 内正常渲染且无 GL 环境下降级为不渲染", () => {
    // jsdom 没有 WebGL 实现：组件应把引擎创建失败视为"装饰件不可用"，
    // 静默隐藏自身，而不是抛错或留下空白 canvas
    const { container } = render(
      <ThemeProvider>
        <PosterWidget />
      </ThemeProvider>,
    );
    expect(container.querySelector("canvas.poster-widget")).toBeNull();
  });

  it("卸载不抛错（dispose 路径在无引擎时也必须安全）", () => {
    const { unmount } = render(
      <ThemeProvider>
        <PosterWidget />
      </ThemeProvider>,
    );
    expect(() => unmount()).not.toThrow();
  });
});
