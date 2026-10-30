/**
 * 关系图 → 主窗口跳转的意图判定（R27 / S6）
 *
 * 三种落点各一条用例，外加一条「负载不可信就不动」——这条最重要：
 * 主进程可能因为旧版本 / 手滑传进半截负载，静默跳到一本空书的资料卡
 * 比什么都不做更糟。
 */
import { describe, expect, it } from "vitest";
import { planEntityJump, readEntityOpenPayload, resolveEntityJumpAction } from "./entity-jump";

describe("readEntityOpenPayload：跨进程负载只认两个非空 id", () => {
  it("正常负载原样取出", () => {
    expect(readEntityOpenPayload({ workId: "w1", entityId: "e1" })).toEqual({
      workId: "w1",
      entityId: "e1",
    });
  });

  it("缺字段 / 空串 / 非字符串 / 非对象一律 null", () => {
    expect(readEntityOpenPayload(null)).toBeNull();
    expect(readEntityOpenPayload(undefined)).toBeNull();
    expect(readEntityOpenPayload("w1")).toBeNull();
    expect(readEntityOpenPayload({ workId: "w1" })).toBeNull();
    expect(readEntityOpenPayload({ entityId: "e1" })).toBeNull();
    expect(readEntityOpenPayload({ workId: "", entityId: "e1" })).toBeNull();
    expect(readEntityOpenPayload({ workId: "w1", entityId: 2 })).toBeNull();
  });
});

describe("planEntityJump：书架切书 / 同书直开 / 异书先确认", () => {
  it("书架主页：直接切到目标作品（书架态不存在「当前书」）", () => {
    expect(planEntityJump({ onShelf: true, activeWorkId: "", targetWorkId: "w2" })).toBe("open");
    // 即使内存里还留着上次的作品 id，书架态也不该弹确认
    expect(planEntityJump({ onShelf: true, activeWorkId: "w1", targetWorkId: "w2" })).toBe("open");
  });

  it("编辑器 · 同一本书：直接开卡，不打扰", () => {
    expect(planEntityJump({ onShelf: false, activeWorkId: "w1", targetWorkId: "w1" })).toBe("open");
  });

  it("编辑器 · 另一本书：只抬窗口，等用户选「保存后跳转」", () => {
    expect(planEntityJump({ onShelf: false, activeWorkId: "w1", targetWorkId: "w2" })).toBe(
      "confirm",
    );
  });

  it("编辑器 · 还没有打开任何作品：直接切，没什么可保存的", () => {
    expect(planEntityJump({ onShelf: false, activeWorkId: "", targetWorkId: "w2" })).toBe("open");
  });

  it("目标为空：什么都不做（不去打开一本空书的资料卡）", () => {
    expect(planEntityJump({ onShelf: true, activeWorkId: "", targetWorkId: "" })).toBe("ignore");
  });
});

describe("resolveEntityJumpAction：窗口根的动作表（多两条「还不能判定」）", () => {
  const base = {
    onShelf: false,
    hasBridge: true,
    editorReady: true,
    activeWorkId: "w1",
    targetWorkId: "w2",
  };

  it("书架态：切书 + 开卡（没有可保存的正文）", () => {
    expect(resolveEntityJumpAction({ ...base, onShelf: true })).toBe("shelf");
    // 书架态即便内存里还留着上次的作品 id，也不该弹确认
    expect(
      resolveEntityJumpAction({ ...base, onShelf: true, activeWorkId: "w2" }),
    ).toBe("shelf");
  });

  it("编辑器 · 同书 → open；异书 → confirm", () => {
    expect(resolveEntityJumpAction({ ...base, targetWorkId: "w1" })).toBe("open");
    expect(resolveEntityJumpAction(base)).toBe("confirm");
  });

  it("句柄还没交上来：一律 defer，绝不凭空白切一次书", () => {
    // 这是「先切书，再弹窗」的第二条来源：拿不到当前作品 id 时，
    // 以前兜底成「同书直开」，书切完了确认框才跟上
    expect(resolveEntityJumpAction({ ...base, hasBridge: false, activeWorkId: "" })).toBe("defer");
    // 即便调用方「顺手」塞了一个 id 进来，没有句柄也还是 defer：
    // 那个 id 可能是上一本书的，不能拿它做判定依据
    expect(resolveEntityJumpAction({ ...base, hasBridge: false })).toBe("defer");
    expect(resolveEntityJumpAction({ ...base, hasBridge: false, onShelf: false })).toBe("defer");
  });

  it("目标为空：任何状态下都 ignore", () => {
    expect(resolveEntityJumpAction({ ...base, targetWorkId: "" })).toBe("ignore");
    expect(
      resolveEntityJumpAction({ ...base, onShelf: true, targetWorkId: "", hasBridge: false }),
    ).toBe("ignore");
  });

  it("书架态优先于「句柄缺席」：书架没有当前书，切过去就是用户要的", () => {
    expect(resolveEntityJumpAction({ ...base, onShelf: true, hasBridge: false })).toBe("shelf");
  });
});

  it("数据还没装载完：一律 defer，空 id 不能当「空态直开」用（先切书的第三条来源）", () => {
    const input = {
      onShelf: false,
      hasBridge: true,
      editorReady: false,
      activeWorkId: "",
      targetWorkId: "w2",
    };
    // 装载完成前 activeWorkId() 恒为 ""，曾被判成「编辑器空态」直接切书
    expect(resolveEntityJumpAction(input)).toBe("defer");
    // 即便句柄在、也塞了个 id，没就绪就不算数
    expect(resolveEntityJumpAction({ ...input, activeWorkId: "w1" })).toBe("defer");
  });
