import "@testing-library/jest-dom/vitest";

/**
 * jsdom 缺失的浏览器 API 兜底（供组件库在测试环境正常渲染）：
 *
 * `ResizeObserver`：antd 6 的 Select / 虚拟列表在挂载时就会用到，
 * jsdom 未实现 → 直接抛 `ReferenceError: ResizeObserver is not defined`。
 *
 * `matchMedia`：antd 的响应式观察器（`useBreakpoint` 等）需要，
 * jsdom 自带实现，这里只在确实缺失时补一个只读桩。
 */
interface ResizeObserverLike {
  observe(): void;
  unobserve(): void;
  disconnect(): void;
}

/** 只用到 antd 读取的这几个字段，故本地声明最小形状（node 侧无 DOM lib） */
interface MediaQueryListLike {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => boolean;
}

const globals = globalThis as unknown as {
  ResizeObserver?: new () => ResizeObserverLike;
  matchMedia?: (query: string) => MediaQueryListLike;
};

if (!globals.ResizeObserver) {
  class ResizeObserverStub implements ResizeObserverLike {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}

if (!globals.matchMedia) {
  Object.defineProperty(globalThis, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
