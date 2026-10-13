import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CORE_PACK_MODULE_KEYS, DEFAULT_LAYOUTS } from "./pack-config";
import { PACK_MODULES } from "./types";
import {
  notifyNameChanged,
  notifyProtagonistChanged,
  notifyQuickAdded,
  PACK_NAME_EVENT,
  PACK_PROTAGONIST_EVENT,
  PACK_QUICK_ADDED_EVENT,
  readEventDetail,
  registerPackQuickAdd,
  runPackInsertIntoChapter,
  runPackQuickAdd,
  type PackNameEventDetail,
  type PackProtagonistEventDetail,
  type PackQuickAddedEventDetail,
} from "./pack-config";

/**
 * 事件负载归一化。
 *
 * 这一组测试钉死的是一个**纯静默**的失效模式：同一个事件有两条投递路径，
 * 负载形状不同（同窗口是 `CustomEvent.detail`，跨窗口是第一个参数本身）。
 * 曾经所有监听器都写 `args[0] as Detail`，于是同窗口那条路读出 `undefined`——
 * 读主角的会把值清空（点「设为主角」角标一闪就没），读境界的直接 return
 * （行囊和右侧面板各说各话）。而广播刻意排除发送者，没有任何一条路能兜住。
 */
describe("readEventDetail（事件负载归一化）", () => {
  it("跨窗口形状：第一个参数就是负载本身", () => {
    const payload: PackProtagonistEventDetail = { workId: "w1", entityId: "e1" };
    expect(readEventDetail<PackProtagonistEventDetail>([payload])).toEqual(payload);
  });

  it("同窗口形状：第一个参数是 CustomEvent，负载在 detail 上", () => {
    const payload: PackProtagonistEventDetail = { workId: "w1", entityId: "e1" };
    const event = new CustomEvent(PACK_PROTAGONIST_EVENT, { detail: payload });
    expect(readEventDetail<PackProtagonistEventDetail>([event])).toEqual(payload);
    // 反面：直接把事件对象当负载用，读 workerId 会得到 undefined
    expect((event as unknown as PackProtagonistEventDetail).workId).toBeUndefined();
  });

  it("无参数 / 无 detail 的裸 Event 都返回空值，且不抛", () => {
    expect(readEventDetail([])).toBeFalsy();
    expect(readEventDetail([new Event(PACK_PROTAGONIST_EVENT)])).toBeFalsy();
  });

  it("回归：广播后同窗口监听器能拿到负载（而不是拿到 CustomEvent 对象）", () => {
    const seen: Array<PackProtagonistEventDetail | undefined> = [];
    const handler = (...args: unknown[]) => {
      seen.push(readEventDetail<PackProtagonistEventDetail>(args));
    };
    window.addEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
    try {
      notifyProtagonistChanged("w1", "e1");
    } finally {
      window.removeEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ workId: "w1", entityId: "e1" });
  });
});

/**
 * 受保护关闭桥（历史 P1-8）。
 *
 * P3-1 已把进程内关闭桥（registerPackCloser / requestClosePackPanel /
 * registerPackGuard / guardPackBeforeAction）整体删除：行囊拆成独立窗口后
 * 页面侧再无调用方，跨窗口的未保存拦截统一由主进程关闭守卫三通道裁决。
 * 这组**反向守卫**钉死「桥不得复活」—— 复活了也不会有人调用（半座桥）。
 */
describe("受保护关闭桥已删除（P3-1 反向守卫）", () => {
  it("pack-config 不再导出任何进程内关闭 / 闸门桥", async () => {
    const mod = await import("./pack-config");
    expect("requestClosePackPanel" in mod).toBe(false);
    expect("registerPackCloser" in mod).toBe(false);
    expect("registerPackGuard" in mod).toBe(false);
    expect("guardPackBeforeAction" in mod).toBe(false);
    // PackGuardReason 类型仍由 pack-close-guard 三通道使用（类型擦除，运行时查不到）
    expect("PackGuardReason" in mod).toBe(false);
  });
});

/**
 * 「插入本章末尾」桥（REQ-034）
 *
 * 行囊已独立成窗口，与编辑器分属两个 renderer —— 恒走跨窗口广播
 * （`pack-insert-into-chapter`），返回 true 表示「已发出」—— fire-and-forget，
 * 失败由编辑器侧提示。P3-1 删掉了再无注册方的本地桥半座。
 */
describe("插入本章末尾桥（REQ-034）", () => {
  it("恒转投跨窗口广播并返回 true（已发出）", () => {
    const seen: Array<[string, string]> = [];
    const prev = window.electronAPI;
    (window as { electronAPI?: unknown }).electronAPI = {
      windowAPI: {
        broadcast: (event: string, text: string) => {
          seen.push([event, text]);
        },
      },
    };
    try {
      expect(runPackInsertIntoChapter("## 行囊 · 物品栏")).toBe(true);
      expect(seen).toEqual([["pack-insert-into-chapter", "## 行囊 · 物品栏"]]);
    } finally {
      (window as { electronAPI?: unknown }).electronAPI = prev;
    }
  });

  it("模块不再导出本地桥注册入口（P3-1 反向守卫）", async () => {
    const mod = await import("./pack-config");
    expect("registerPackInsertIntoChapter" in mod).toBe(false);
  });
});

/**
 * 主角名变更事件。
 *
 * 钉死的是「要素库改名 → 行囊头部跟着变」这条链路上的两个约定：
 * ① 负载形状仍走 readEventDetail 的归一化（同窗口 / 跨窗口两种都要认）；
 * ② 广播必须带 `origin`，否则行囊自己改的名会绕回来再 mutate 一次
 *    （虽然被幂等判等挡住，但依赖判等兜错不如一开始就不发）。
 */
describe("notifyNameChanged（主角名变更广播）", () => {
  it("同窗口能收到，负载含 workId / displayName / entityId / origin", () => {
    const seen: Array<PackNameEventDetail & { origin?: string }> = [];
    const handler = (event: Event) => {
      seen.push(readEventDetail<PackNameEventDetail & { origin?: string }>([event])!);
    };
    window.addEventListener(PACK_NAME_EVENT, handler);
    try {
      notifyNameChanged("w1", "陆长安", "panel", "e1");
    } finally {
      window.removeEventListener(PACK_NAME_EVENT, handler);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      workId: "w1",
      displayName: "陆长安",
      entityId: "e1",
      origin: "panel",
    });
  });

  it("未绑定实体（改行囊内那格）时 entityId 为空串", () => {
    const seen: Array<PackNameEventDetail & { origin?: string }> = [];
    const handler = (event: Event) => {
      seen.push(readEventDetail<PackNameEventDetail & { origin?: string }>([event])!);
    };
    window.addEventListener(PACK_NAME_EVENT, handler);
    try {
      notifyNameChanged("w1", "主角", "pack");
    } finally {
      window.removeEventListener(PACK_NAME_EVENT, handler);
    }
    expect(seen[0]?.entityId).toBe("");
  });

  it("事件名与主角变更事件分开（改名不必重载整份 bundle）", () => {
    expect(PACK_NAME_EVENT).not.toBe(PACK_PROTAGONIST_EVENT);
  });
});

/**
 * 快速记账跨窗口合并（P1-1）。
 *
 * 钉死两件事：① 桥把新建物品 id 透出来（合并要靠它定位）；
 * ② `notifyQuickAdded` 双通道各发一次，负载带 workId + itemId。
 * 少了任何一个，行囊窗口的下一次整文档保存都会把刚记的物品清掉。
 */
describe("快速记账跨窗口合并（P1-1）", () => {
  it("本地桥把新建物品 id 透出来；没面板时 handled=false", () => {
    registerPackQuickAdd(() => "pi-new");
    try {
      const hit = runPackQuickAdd({ name: "破境丹", chapterId: "c1" });
      expect(hit).toEqual({ handled: true, ok: true, itemId: "pi-new" });
    } finally {
      registerPackQuickAdd(null);
    }
    expect(runPackQuickAdd({ name: "x", chapterId: "c1" })).toEqual({
      handled: false,
      ok: false,
      itemId: null,
    });
  });

  it("面板记账失败（返回 null）时 ok=false，调用方落主进程", () => {
    registerPackQuickAdd(() => null);
    try {
      const hit = runPackQuickAdd({ name: "破境丹", chapterId: "c1" });
      expect(hit.handled).toBe(true);
      expect(hit.ok).toBe(false);
      expect(hit.itemId).toBeNull();
    } finally {
      registerPackQuickAdd(null);
    }
  });

  it("notifyQuickAdded 同窗口可收，负载含 workId + itemId", () => {
    const seen: Array<PackQuickAddedEventDetail | undefined> = [];
    const handler = (...args: unknown[]) => {
      seen.push(readEventDetail<PackQuickAddedEventDetail>(args));
    };
    window.addEventListener(PACK_QUICK_ADDED_EVENT, handler as EventListener);
    try {
      notifyQuickAdded("w1", "pi-42");
    } finally {
      window.removeEventListener(PACK_QUICK_ADDED_EVENT, handler as EventListener);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ workId: "w1", itemId: "pi-42" });
  });

  it("事件名与其它行囊事件互不撞车", () => {
    expect(PACK_QUICK_ADDED_EVENT).not.toBe(PACK_PROTAGONIST_EVENT);
    expect(PACK_QUICK_ADDED_EVENT).not.toBe(PACK_NAME_EVENT);
  });
});

/**
 * 出厂模块拼装（默认启用态）。
 *
 * 钉的是「新书打开行囊一屏全开」这个已经被吐槽过的默认值：出厂只启用核心三块
 * （总属性汇总 / 人物属性 / 境界），其余七块以「存在但关闭」出厂 —— 顺序与完整性
 * 照旧，只是打开行囊先给一张干净的仪表盘。
 *
 * 顺带钉住第二条：`DEFAULT_LAYOUTS` 的启用集合必须**恰好**是核心模块清单。
 * 只要有人把某个模块加进 `coreModules`（动机通常是窄档不想折叠它），它就会
 * 顺带改变新书的默认启用态 —— 这个联动是刻意的，所以要有断言把它显式化，
 * 而不是留给下一个人从 diff 里发现。
 */
describe("DEFAULT_LAYOUTS（出厂模块拼装）", () => {
  it("覆盖全部模块，顺序与 PACK_MODULES 一致", () => {
    expect(DEFAULT_LAYOUTS.map((layout) => layout.key)).toEqual(
      PACK_MODULES.map((module) => module.key),
    );
  });

  it("默认只启用核心三块", () => {
    expect(
      DEFAULT_LAYOUTS.filter((layout) => layout.enabled).map((layout) => layout.key),
    ).toEqual([...CORE_PACK_MODULE_KEYS]);
  });

  it("核心三块之外没有被默认启用的（反向：别退化成全部启用）", () => {
    expect(DEFAULT_LAYOUTS.filter((layout) => layout.enabled)).toHaveLength(
      CORE_PACK_MODULE_KEYS.length,
    );
    expect(CORE_PACK_MODULE_KEYS.length).toBeLessThan(PACK_MODULES.length);
  });
});

/** 去掉注释再匹配：说明文字里会引用被改掉的写法，不该算命中 */
function stripSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * 缺失行的兜底必须与出厂默认**同源**——这是那条缺陷真正的根。
 *
 * 「新书一屏全开」不止 `DEFAULT_LAYOUTS` 一处写死的默认值，还在**每个替
 * 「库里没有这一行」拿主意的分支**：`mergeLayouts`（装载时补齐缺失行）与
 * `setModuleOrder`（重排序时补齐）。旧写法兜底 `true`，后果是「以后每加一个
 * 模块，所有老书都自动多开一块」——同一毛病换个入口复发（`pack-config.ts`
 * 顶部注释里写的就是这条）。
 *
 * 这两个函数都在 hook 内部、不导出，跨不了进程也挂不上组件，只能钉源码文本
 * （同 `pack-character-name-guard.test.ts` 的做法）。正面断言「两处都读
 * isCorePackModule」，反面断言「不许退回写死 true」——反面那条必须先
 * `stripSourceComments`，否则会命中解释这段历史的注释。
 */
describe("模块启用态：缺失行兜底与出厂默认同源", () => {
  const PANEL = stripSourceComments(
    readFileSync(
      resolve(__dirname, "hooks/usePackPanel.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n"),
  );

  it("mergeLayouts：缺失行按核心模块判定，不写死 true", () => {
    const body = PANEL.slice(PANEL.indexOf("function mergeLayouts")).slice(0, 900);
    expect(body).toMatch(/enabled: stored\?\.enabled \?\? isCorePackModule\(module\.key\)/);
    expect(body).not.toMatch(/enabled: stored\?\.enabled \?\? true/);
  });

  it("setModuleOrder：重排序补齐的缺失行同样按核心模块判定", () => {
    const body = PANEL.slice(PANEL.indexOf("const setModuleOrder")).slice(0, 1200);
    expect(body).toMatch(/enabled: stored\?\.enabled \?\? isCorePackModule\(key\)/);
    expect(body).not.toMatch(/enabled: stored\?\.enabled \?\? true/);
  });
});
