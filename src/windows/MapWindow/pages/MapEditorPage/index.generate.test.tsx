import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapEditorPage 页面级回归（拆分之四）：B1 素材属性面板与快捷键 / B2 点要素
 * 落位自带地名 / B3 一键成图。
 *
 * 【为什么拆成多个文件】原 `index.test.tsx` 单文件 2214 行、51 条用例，vitest 只能
 * 文件级并行，单文件内部串行成为全量测试的绝对瓶颈（~722s）。按主题拆成
 * `index.coords / index.land-labels / index.regions / index.generate` 四个文件后，
 * 由 `--maxWorkers=4` 并行消化。公共的 pixi mock 工厂在 `__pixi-mock.ts`，常量与
 * 查询 helper 在 `__test-utils.tsx`；每个文件用自己的 `vi.hoisted` 探针数组，
 * 通过异步 `vi.mock("pixi.js", async () => ...)` 注入，避免跨文件共享探针实例。
 */
import {
  clickCanvas,
  countLabel,
  deleteButton,
  installPointerShims,
  labelCount,
  localOf,
  pickSprite,
  rect,
  setup,
} from "./__test-utils";
import { resetMapStores } from "./store/reset";
import { useMapDocStore } from "./store/useMapDocStore";
import { CONTENT_LABELS } from "./domain/generator";

const { spritePositions, labelNodes } = vi.hoisted(() => ({
  spritePositions: [] as { x: number; y: number }[],
  labelNodes: [] as {
    text: string;
    destroyed: boolean;
    style: { fontSize?: number } | null;
  }[],
}));

vi.mock("pixi.js", async () => {
  const { createPixiMock } = await import("./__pixi-mock");
  return createPixiMock({ spritePositions, labelNodes });
});

vi.mock("./hooks/useTextureCache", () => ({
  useTextureCache: () => ({ textures: {}, ready: true }),
}));

installPointerShims();

let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spritePositions.length = 0;
  labelNodes.length = 0;
  // 三个 store 是模块级单例，必须显式复位（对齐 useNovelEditorStore.test 范式）
  resetMapStores();
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
});

afterEach(() => {
  // 未开启 vitest globals 时 RTL 不会自动清理，DOM 会跨用例累积
  cleanup();
  rectSpy.mockRestore();
});

// 整组重组件用例统一吃 120s 墙钟预算（理由见原 index.test.tsx 顶部同段注释）
vi.setConfig({ testTimeout: 120000 });

/**
 * B1（R-MAP-23 / R-MAP-25）：素材属性面板 + 剪贴板 / 微移。
 *
 * 【为什么这些落在页面用例】store 层用例（useMapDocStore.element-actions.test.ts）
 * 钉的是"撤销栈账目"；这一组钉的是**接线**——面板真的出现在选中后、按钮真的
 * 调到了 store、全局快捷键真的绕过了输入框守卫。账目错了 store 用例红，接线错
 * 了只有这里能红。
 */
describe("MapEditorPage B1：素材属性面板与快捷键", () => {
  /** 放一座山并等计数变化（落位即选中） */
  async function placeMountain() {
    await setup();
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    return useMapDocStore.getState().doc.elements[0];
  }

  it("选中素材出属性面板：四件套滑杆 + 层级下拉 + 地名输入都在", async () => {
    await placeMountain();
    const panel = document.querySelector(".element-panel");
    expect(panel).not.toBeNull();
    // 四件套：尺寸 / 旋转 / 不透明 / 色相
    expect(panel?.querySelectorAll("[role='slider']").length).toBe(4);
    // 层级下拉与地名输入（placeholder 与工具栏时代一致，语义不变）
    expect(panel?.querySelector(".element-panel__level")).not.toBeNull();
    expect(screen.getByPlaceholderText("地名")).toBeTruthy();
    // 面板标题是素材名
    expect(panel?.querySelector(".element-panel__title")?.textContent).toContain("山");
  });

  it("Ctrl+C / Ctrl+V 连续粘贴：粘贴件可连贴、可撤销", async () => {
    await placeMountain();

    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await waitFor(() => expect(countLabel()).toContain("3"));
    // 两份副本都是新 id（不是把原素材挪了个位置）
    const ids = useMapDocStore.getState().doc.elements.map((el) => el.id);
    expect(new Set(ids).size).toBe(3);

    // 一次粘贴是一步撤销：退一步少一份
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(countLabel()).toContain("2"));
  });

  it("Ctrl+D 复制一份并选中新副本（副本出现在原位右下方）", async () => {
    const first = await placeMountain();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    await waitFor(() => expect(countLabel()).toContain("2"));
    const els = useMapDocStore.getState().doc.elements;
    const copy = els[els.length - 1];
    expect(copy.id).not.toBe(first.id);
    expect(copy.x).toBeGreaterThan(first.x);
    // 副本自动选中：删除按钮可用即"当前有选中"
    expect(deleteButton()).not.toBeDisabled();
  });

  it("方向键微移：精调 4 / Shift 加速 16，连按合并为一步撤销", async () => {
    const first = await placeMountain();
    const x0 = first.x;

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    await waitFor(() =>
      expect(useMapDocStore.getState().doc.elements[0].x).toBeCloseTo(x0 + 24, 5),
    );

    // 连按是同一次移动：一步撤销回到起点
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(useMapDocStore.getState().doc.elements[0].x).toBeCloseTo(x0, 5));
  });

  it("置底按钮调整渲染顺序：后放的素材可以被垫到最先画的下面", async () => {
    await placeMountain();
    // 再放一座：后放者默认在最上层（数组尾），且落位即选中。
    // 【为什么放很远】点击命中已有素材 = 选中而不是落位；两座山太近时第二下
    // 只是选中了第一座，计数不动 —— 这是画布语义，不是 bug。
    pickSprite("山（中）");
    clickCanvas(localOf({ x: -280, y: -160 }));
    await waitFor(() => expect(countLabel()).toContain("2"));
    const secondId = useMapDocStore.getState().doc.elements[1].id;

    fireEvent.click(screen.getByRole("button", { name: "置底素材" }));
    // 选中者（后放者）被移到数组头 = 渲染最底层；先放者相应掉到数组尾
    const ids = useMapDocStore.getState().doc.elements.map((el) => el.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(secondId);
    expect(ids[1]).not.toBe(secondId);
  });

  it("输入框里的 Ctrl+C 不会被劫持成复制素材（守卫在先）", async () => {
    await placeMountain();
    // 聚焦地名输入框：这里的 Ctrl+C 必须是"复制文字"，不能动剪贴板
    const nameBox = screen.getByPlaceholderText("地名") as HTMLInputElement;
    fireEvent.focus(nameBox);
    fireEvent.change(nameBox, { target: { value: "青云岭" } });
    const clipboardBefore = useMapDocStore.getState().clipboard;
    fireEvent.keyDown(nameBox, { key: "c", ctrlKey: true });
    fireEvent.keyDown(nameBox, { key: "Enter" });
    await waitFor(() => expect(labelCount()).toContain("1"));
    // 剪贴板没被写入（复制文字不等于复制素材）
    expect(useMapDocStore.getState().clipboard).toBe(clipboardBefore);
  });
});

/**
 * B2（R-MAP-22）：素材与地名联动 —— 点要素落位自带默认名。
 *
 * 【为什么落在页面用例】联动逻辑在 useMapEditor.placeSprite（读取名池、
 * 查重、挂地名），store 与面板都感知不到。这里钉的是：摆一个城市即出现
 * 默认名、再摆一个自动换下一个名字（不撞名）、纯地貌（山）不带名。
 */
describe("MapEditorPage B2：点要素落位自带地名", () => {
  it("摆一个城市自动挂默认名，再摆一个不撞名", async () => {
    await setup();
    pickSprite("大城");
    clickCanvas(localOf({ x: -40, y: -30 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    pickSprite("大城");
    clickCanvas(localOf({ x: 40, y: 30 }));
    await waitFor(() => expect(countLabel()).toContain("2"));

    const labels = useMapDocStore.getState().doc.labels;
    expect(labels).toHaveLength(2);
    // 名池前两个依次取用，不重复
    expect(new Set(labels.map((l) => l.text)).size).toBe(2);
    expect(["临江城", "云中城"]).toContain(labels[0].text);
    expect(["临江城", "云中城"]).toContain(labels[1].text);
  });

  it("纯地貌（山）落位不带名", async () => {
    await setup();
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    expect(useMapDocStore.getState().doc.labels).toHaveLength(0);
  });
});

/**
 * 一键成图（B3 / R-MAP-21）—— 状态链路层。
 *
 * 几何与确定性在 `domain/generator.test.ts`；这里覆盖「按钮 → 弹层 → 生成 →
 * 落库 → 撤销」的编排链路，以及五档重掷里最两条易错的语义：
 * 只换素材（陆地不动）与只换地名（素材不动）。
 */
describe("MapEditorPage 一键成图（B3）", () => {
  it("生成一张：陆地/素材/地名一次落库，撤销一步全回来", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /一键成图/ }));
    fireEvent.click(await screen.findByRole("button", { name: /生成一张/ }));

    await waitFor(
      () => {
        const { doc } = useMapDocStore.getState();
        expect(doc.land).not.toBeNull();
        expect(doc.elements.length).toBeGreaterThan(20);
        expect(doc.labels.length).toBeGreaterThan(0);
      },
      { timeout: 20000 },
    );

    // 地名全部与素材联动（生成器产出的标注不落孤儿）
    for (const l of useMapDocStore.getState().doc.labels) {
      expect(l.elementId).toBeTruthy();
    }
    // 摘要就地展示（review §5.3 反馈断点）
    expect(await screen.findByText(/已生成：陆地/)).toBeTruthy();

    // 撤销一步：陆地 / 素材 / 地名一起回退（applyGenerated 单 commit）
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(useMapDocStore.getState().doc.land).toBeNull());
    expect(useMapDocStore.getState().doc.elements).toHaveLength(0);
    expect(useMapDocStore.getState().doc.labels).toHaveLength(0);
  });

  it("五档重掷：只换素材时陆地不动；只换地名时素材不动", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /一键成图/ }));
    fireEvent.click(await screen.findByRole("button", { name: /生成一张/ }));
    await waitFor(
      () => expect(useMapDocStore.getState().doc.elements.length).toBeGreaterThan(0),
      { timeout: 20000 },
    );
    const before = useMapDocStore.getState().doc;
    const seedBefore = before.land!.seed;

    // ── 只换素材：素材换血，陆地区块原样 ──
    fireEvent.click(await screen.findByRole("button", { name: /只换素材/ }));
    await waitFor(() => {
      const after = useMapDocStore.getState().doc;
      expect(after.elements.map((e) => e.id)).not.toEqual(before.elements.map((e) => e.id));
    });
    expect(useMapDocStore.getState().doc.land!.seed).toBe(seedBefore);

    // ── 只换地名：素材 id 集不动，地名仍全部联动 ──
    const idsAfterSprites = useMapDocStore.getState().doc.elements.map((e) => e.id);
    fireEvent.click(await screen.findByRole("button", { name: /只换地名/ }));
    await waitFor(() => {
      const after = useMapDocStore.getState();
      expect(after.doc.elements.map((e) => e.id)).toEqual(idsAfterSprites);
      // relabelElements 走了 commit（撤销栈增长）且标注依然全部绑定素材
      expect(after.undoStack.length).toBeGreaterThan(0);
    });
    for (const l of useMapDocStore.getState().doc.labels) {
      expect(l.elementId).toBeTruthy();
    }
  });

  it("面板按逆向目标补齐三组控制：要素大小 / 生成内容 / 山体 / 河流", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /一键成图/ }));

    // 弹层本体（只看这个节点，避免与画布上的素材名/提示文案撞词）
    const panel = await waitFor(() => {
      const node = document.querySelector(".map-generator");
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    const text = panel.textContent ?? "";
    for (const label of ["要素大小", "生成内容", "山体", "河流", "含地名", "划分区块"]) {
      expect(text, `面板缺「${label}」`).toContain(label);
    }
    // 「生成内容」七项与生成器的 CONTENT_KEYS 一一对应
    for (const label of Object.values(CONTENT_LABELS)) {
      expect(text, `生成内容缺「${label}」`).toContain(label);
    }
  });

  it("画布已有内容时首次生成先确认；取消则不动文档", async () => {
    await setup();
    // 先放一个素材，让画布"有内容"
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: /一键成图/ }));
    fireEvent.click(await screen.findByRole("button", { name: /生成一张/ }));
    // 确认框出现 → 取消
    expect(await screen.findByText(/将替换当前陆地、素材与地名/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByText(/将替换当前陆地、素材与地名/)).toBeNull());
    expect(useMapDocStore.getState().doc.elements).toHaveLength(1);
    expect(useMapDocStore.getState().doc.land).toBeNull();
  });
});
