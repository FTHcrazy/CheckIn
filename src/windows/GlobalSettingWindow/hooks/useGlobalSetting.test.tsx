import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI, NovelGlobalSettingCategoryDTO } from "@/shared/types/electron";
import { useGlobalSetting, type GlobalSettingController } from "./useGlobalSetting";

/**
 * `useGlobalSetting` 删除分类的 D4 二次确认（N-05）
 *
 * 旧实现用原生 `window.confirm`：
 * - 违反 §6.1.2（业务代码禁原生控件 —— 原生控件不跟随 antd 的 darkAlgorithm，
 *   无组件库的键盘可达性 / 焦点环 / aria 语义）；
 * - 明暗主题都不跟主题走。
 *
 * 现改为 antd 上下文内的确认框（`Modal.useModal()` 的实例方法 + `contextHolder`
 * 渲染在组件树里），语义保持不变：**引用计数 >0 才弹确认**；确认才继续固化删除、
 * 取消则中止。
 *
 * 判据：
 * - 「不再用 window.confirm」用**两条**钉住：① 运行期 `window.confirm` spy 未被调用；
 *   ② 源码文本不再出现 `window.confirm`（防「换个分支又写回来」）。
 *   之所以不能只靠 ①：antd 确认框与原生 confirm 是两条互斥路径，只覆盖被走到的
 *   那一条会漏；源码断言把「整份实现里都不存在」钉死。
 * - 主题继承：确认框由 `Modal.useModal()` 的 `contextHolder` 承载并渲染在组件树内，
 *   而不是静态 `Modal.confirm`（后者脱离 ConfigProvider，暗色会掉色，见 hook 注释）。
 */

type NovelApi = Partial<ElectronAPI["novel"]>;

/** 装一份（不完整的）window.electronAPI 桩 */
function mountApi(novel: NovelApi): void {
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: {
      novel,
      windowAPI: {
        on: vi.fn(),
        off: vi.fn(),
        broadcast: vi.fn(async () => {}),
        sendTo: vi.fn(async () => {}),
        setCloseGuard: vi.fn(),
        respondClose: vi.fn(),
      },
    } as unknown as ElectronAPI,
  });
}

/** 把 controller 暴露给测试；同时渲染 contextHolder（确认框的挂载点） */
function Harness({ onReady }: { onReady: (c: GlobalSettingController) => void }) {
  const controller = useGlobalSetting();
  onReady(controller);
  return <>{controller.modalContextHolder}</>;
}

/** 按可见文案找按钮（去空白匹配：antd 给两字中文按钮插字间距） */
function findButton(text: string): HTMLElement {
  const target = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").replace(/\s/g, "") === text);
  if (!target) throw new Error(`找不到按钮：${text}`);
  return target;
}

describe("useGlobalSetting · 删除分类二次确认（N-05）", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // 若实现回潮到原生 confirm，spy 会命中（默认放行，便于定位回归）
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    window.electronAPI = undefined;
    confirmSpy.mockRestore();
  });

  /** 渲染 harness 并等待首次装载结束，返回最新的 controller 读取器 */
  async function renderHook(
    globalCategoryDelete: NovelApi["globalCategoryDelete"],
  ): Promise<() => GlobalSettingController> {
    mountApi({
      globalSettingLoad: vi.fn(async () => ({ categories: [] })),
      globalCategoryDelete,
    });
    let latest!: GlobalSettingController;
    render(
      <Harness
        onReady={(c) => {
          latest = c;
        }}
      />,
    );
    await waitFor(() => expect(latest.loading).toBe(false));
    return () => latest;
  }

  /** 触发一次删除并冲刷内部的 then 链（让确认框渲染出来） */
  async function triggerDelete(
    controller: GlobalSettingController,
    categoryId: string,
  ): Promise<void> {
    await act(async () => {
      controller.onDeleteCategory(categoryId);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("被引用（refCount>0）：弹上下文内确认框（文案带引用数），点「确定删除」才继续", async () => {
    const globalCategoryDelete = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, refCount: 3 })
      .mockResolvedValueOnce({ ok: true, refCount: 3 });
    const controller = await renderHook(globalCategoryDelete);

    await triggerDelete(controller(), "g1");

    // 第一次只探引用（不带 force）
    expect(globalCategoryDelete).toHaveBeenNthCalledWith(1, "g1");
    // 原生 confirm 不得被调用（否则就是 §6.1.2 回潮）
    expect(confirmSpy).not.toHaveBeenCalled();
    // antd 确认框出现（portal 挂 body），且文案带引用数
    expect(await screen.findByText(/正被 3 部书引用/)).toBeInTheDocument();
    expect(document.querySelector(".ant-modal")).not.toBeNull();

    fireEvent.click(screen.getByText("确定删除"));

    await waitFor(() =>
      expect(globalCategoryDelete).toHaveBeenNthCalledWith(2, "g1", true),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("取消确认：中止，不执行固化删除（无第二次 IPC 调用）", async () => {
    const globalCategoryDelete = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, refCount: 2 });
    const controller = await renderHook(globalCategoryDelete);

    await triggerDelete(controller(), "g2");

    expect(await screen.findByText(/正被 2 部书引用/)).toBeInTheDocument();

    fireEvent.click(findButton("取消"));

    await act(async () => {
      await Promise.resolve();
    });

    // 取消 ⇒ 不继续固化删除
    expect(globalCategoryDelete).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("引用计数为 0：不弹确认框，直接固化删除", async () => {
    const globalCategoryDelete = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, refCount: 0 })
      .mockResolvedValueOnce({ ok: true, refCount: 0 });
    const controller = await renderHook(globalCategoryDelete);

    await triggerDelete(controller(), "g3");

    expect(confirmSpy).not.toHaveBeenCalled();
    // 没有确认框（「部书引用」只出现在确认框文案里）
    expect(document.body.textContent).not.toContain("部书引用");
    await waitFor(() =>
      expect(globalCategoryDelete).toHaveBeenNthCalledWith(2, "g3", true),
    );
  });

  it("源码不再**调用**原生 window.confirm（防止回潮）", () => {
    // 按路径读（不用 import.meta.url：vitest 下该 URL 未必是 file: scheme）
    const sourcePath = join(
      process.cwd(),
      "src/windows/GlobalSettingWindow/hooks/useGlobalSetting.ts",
    );
    const source = readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
    // 判据定为「是否存在调用」：文档注释里正当地提到这个名字不算回潮，
    // 真正要钉死的是**执行路径**上不再出现 window.confirm(...) 调用。
    expect(source).not.toMatch(/window\s*\.\s*confirm\s*\(/);
  });
});

/**
 * R12 引用方名单：`loadCategoryRefs`
 *
 * 窗口侧要能从「N 部书引用」展开到「哪几部书」。这条通道是**新增**的，所以必须正视
 * 「渲染层与 preload 版本错位」这条真实路径：老 preload 里没有 `globalCategoryRefs`，
 * 此时 `api.globalCategoryRefs(...)` 是同步 TypeError —— 而它会被 UI 回调直接在
 * 渲染期调到，一抛就是整棵树卸载（白屏）。故判据是「返回空名单、不抛」，而不是报错。
 *
 * 它是**纯数据原语**：视图态（loading / error / retry）由使用它的抽屉自持。
 */
describe("useGlobalSetting · 引用方名单（R12）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    window.electronAPI = undefined;
    vi.restoreAllMocks();
  });

  /** 渲染 harness 并等待首次装载结束，返回最新的 controller 读取器 */
  async function renderWith(novel: NovelApi): Promise<() => GlobalSettingController> {
    mountApi({
      globalSettingLoad: vi.fn(async () => ({ categories: [] })),
      ...novel,
    });
    let latest!: GlobalSettingController;
    render(
      <Harness
        onReady={(c) => {
          latest = c;
        }}
      />,
    );
    await waitFor(() => expect(latest.loading).toBe(false));
    return () => latest;
  }

  it("正常返回名单（透传 IPC 结果，不改写字段）", async () => {
    const refs = [
      { workId: "w1", workName: "九州志" },
      { workId: "w2", workName: "尘仙录" },
    ];
    const globalCategoryRefs = vi.fn(async () => refs);
    const controller = await renderWith({ globalCategoryRefs });

    await expect(controller().loadCategoryRefs("g1")).resolves.toEqual(refs);
    expect(globalCategoryRefs).toHaveBeenCalledWith("g1");
  });

  it("preload 缺 globalCategoryRefs（版本错位）：返回 [] 且不抛", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // 这份桩里**故意不放** globalCategoryRefs —— 模拟旧版 preload
    const controller = await renderWith({});

    await expect(controller().loadCategoryRefs("g1")).resolves.toEqual([]);
    // 也不能借 console.error 之外的方式把异常冒到调用方
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("IPC 拒绝：退化为 [] 并留一条控制台错误（不把窗口打到错误态）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const globalCategoryRefs = vi.fn(async () => {
      throw new Error("db locked");
    });
    const controller = await renderWith({ globalCategoryRefs });

    await expect(controller().loadCategoryRefs("g1")).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * `useGlobalSetting` 装载映射（N-06 收口）
 *
 * 分类/等级 DTO → `SettingCategory` / `SettingLevel` 的映射已收口到共享的
 * `toSettingCategory`（`@/shared/novel/setting-mappers`）。该映射的形态开关
 * `withRefCount` **只在为真时才写 `refCount` 键** —— 这带来一个静默失败：
 * 漏传 `withRefCount` 时类型仍然通过、页面也不报错，只是「N 部书引用」徽标
 * 无声消失（REQ-041）。字段对照表证明两实现等价，但等价性无法挡住有人把
 * `{ workId: "", withRefCount: true }` 误写成 `{ workId: "" }`。
 *
 * 故这里从**装载结果**（不是直接调映射函数）钉一条：DTO 给的 `refCount`
 * 必须原样出现在 controller 暴露的 `settings` 上。这是「漏传即丢徽标」的
 * 唯一防线 —— 删掉 `withRefCount` 这条断言立刻变红。
 *
 * 顺带钉住全局域的形态：`workId` 恒为空串，且**不产出**本书域专有的
 * `sourceGlobalId` / `detachedFromName` 两个键（避免给全局输出平添 `undefined`）。
 */
describe("useGlobalSetting · 装载映射（N-06 收口）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    window.electronAPI = undefined;
  });

  it("装载后分类的 refCount 等于 DTO 提供的数字（漏传 withRefCount 即丢徽标 REQ-041）", async () => {
    const dto: NovelGlobalSettingCategoryDTO = {
      id: "g1",
      name: "境界体系",
      color: "#7c5cff",
      kind: "realm",
      sortOrder: 1,
      note: "",
      subLevels: 1,
      carryDir: "asc",
      subPattern: "",
      refCount: 7,
      levels: [
        {
          id: "l1",
          categoryId: "g1",
          name: "炼气",
          rank: 1,
          aliases: ["引气"],
          note: "",
          subLevels: 1,
          subPattern: "",
          power: null,
          parentId: null,
          segFrom: null,
          segTo: null,
        },
      ],
    };
    mountApi({ globalSettingLoad: vi.fn(async () => ({ categories: [dto] })) });

    let latest!: GlobalSettingController;
    render(
      <Harness
        onReady={(c) => {
          latest = c;
        }}
      />,
    );
    await waitFor(() => expect(latest.loading).toBe(false));

    const category = latest.settings[0];
    // 核心断言：引用计数不丢（漏传 withRefCount 会变 undefined）
    expect(category.refCount).toBe(7);
    // 全局域形态：workId 恒为空串；不产出本书域专有键
    expect(category.workId).toBe("");
    expect("sourceGlobalId" in category).toBe(false);
    expect("detachedFromName" in category).toBe(false);
    // 等级子数组也走了共享映射（不再是本地 toLevel）
    expect(category.levels.map((level) => level.name)).toEqual(["炼气"]);
    expect(category.levels[0].aliases).toEqual(["引气"]);
  });
});
