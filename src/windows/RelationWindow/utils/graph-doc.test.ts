/**
 * 画布记忆纯函数单测（R27 / S2）
 *
 * 重点不是「正常路径能跑」，而是三条会**静默毁数据**的路径：
 * ① 坏 JSON / 旧版本不能被当成本次记忆（否则整张图错位或空白）；
 * ② 播种不能覆盖用户已经拖过的坐标；
 * ③ 视口与坐标同一份文档读写（视口丢了只是「每次回到全景」，看不出错）。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_ID,
  REL_GRAPH_DOC_VERSION,
  REL_GRAPH_KEY_PREFIX,
  createEmptyGraphDoc,
  graphDocKey,
  markSeeded,
  memberIds,
  parseGraphDoc,
  pruneMembers,
  seedMembers,
  serializeGraphDoc,
  setViewport,
  stampGraphDoc,
  withMember,
  withMemberPosition,
  withoutMember,
  type RelGraphDoc,
} from "./graph-doc";

function docWith(members: RelGraphDoc["members"]): RelGraphDoc {
  return { ...createEmptyGraphDoc(), members, autoSeeded: 1 };
}

describe("键名与版本", () => {
  it("一个作品一个键，graphId 缺省为 g1", () => {
    expect(graphDocKey("w1")).toBe(`${REL_GRAPH_KEY_PREFIX}:w1:${DEFAULT_GRAPH_ID}`);
    expect(graphDocKey("w1", "g2")).toBe(`${REL_GRAPH_KEY_PREFIX}:w1:g2`);
  });

  it("空 workId 返回空串：调用方据此跳过读写，不会写出 :g1 这种野键", () => {
    expect(graphDocKey("")).toBe("");
  });

  it("版本不匹配整条丢弃（v1 的 nodes/k/tx/ty/tf 不认）", () => {
    expect(parseGraphDoc(JSON.stringify({ v: 1, nodes: [] }))).toBeNull();
    expect(parseGraphDoc(JSON.stringify({ v: REL_GRAPH_DOC_VERSION }))).not.toBeNull();
  });
});

describe("解析与容错", () => {
  it("坏 JSON / 空值都返回 null，不抛错", () => {
    expect(parseGraphDoc("{oops")).toBeNull();
    expect(parseGraphDoc("")).toBeNull();
    expect(parseGraphDoc(null)).toBeNull();
  });

  it("逐条过滤非法成员，合法成员保留", () => {
    const raw = JSON.stringify({
      v: 2,
      members: {
        a: [10, 20, 1],
        b: [Number.NaN, 0, 0],
        c: "nope",
        d: [1],
        e: [3.4, -8.6, 5],
      },
    });
    const doc = parseGraphDoc(raw);
    expect(doc?.members.a).toEqual([10, 20, 1]);
    expect(doc?.members.e).toEqual([3.4, -8.6, 0]);
    expect(doc?.members.b).toBeUndefined();
    expect(doc?.members.c).toBeUndefined();
    expect(doc?.members.d).toBeUndefined();
  });

  it("视口缺省 / k=0 兜底为 1（k=0 会让画布整个不可见）", () => {
    const doc = parseGraphDoc(JSON.stringify({ v: 2 }));
    expect(doc?.view).toEqual({ k: 1, tx: 0, ty: 0 });
    const zero = parseGraphDoc(JSON.stringify({ v: 2, view: { k: 0, tx: 5, ty: 6 } }));
    expect(zero?.view).toEqual({ k: 1, tx: 5, ty: 6 });
  });

  it("序列化 → 解析可往返", () => {
    const doc = docWith({ a: [1, 2, 1] });
    expect(parseGraphDoc(serializeGraphDoc(doc))).toEqual(doc);
  });
});

describe("成员增删改", () => {
  it("拖入即上图，坐标取整且标记 fixed", () => {
    const doc = withMember(createEmptyGraphDoc(), "a", { x: 10.4, y: 20.6 });
    expect(doc.members.a).toEqual([10, 21, 1]);
  });

  it("移动只作用于已在图上的成员", () => {
    const base = docWith({ a: [1, 1, 0] });
    expect(withMemberPosition(base, "a", { x: 5, y: 7 }).members.a).toEqual([5, 7, 1]);
    // 不在图上 → 原样返回，不会凭空加成成员
    expect(withMemberPosition(base, "ghost", { x: 5, y: 7 })).toBe(base);
  });

  it("移出画布只删成员，不产生其它字段变化（关系数据在别的表）", () => {
    const base = docWith({ a: [1, 1, 1], b: [2, 2, 0] });
    const next = withoutMember(base, "a");
    expect(memberIds(next)).toEqual(["b"]);
    expect(next.members.b).toEqual([2, 2, 0]);
    // 不存在时返回同一引用，避免无意义的重渲染与写库
    expect(withoutMember(next, "a")).toBe(next);
  });

  it("写库前剔除已删除的要素", () => {
    const base = docWith({ a: [0, 0, 0], b: [0, 0, 0] });
    const { doc, removed } = pruneMembers(base, new Set(["a"]));
    expect(removed).toBe(1);
    expect(memberIds(doc)).toEqual(["a"]);
    // 无需剔除时返回原引用
    expect(pruneMembers(base, new Set(["a", "b"])).doc).toBe(base);
  });
});

describe("首次播种", () => {
  it("只补缺，不覆盖用户拖过的坐标", () => {
    const base: RelGraphDoc = { ...createEmptyGraphDoc(), members: { a: [99, 99, 1] } };
    const { doc, added } = seedMembers(base, [
      { id: "a", point: { x: 0, y: 0 } },
      { id: "b", point: { x: 12.2, y: -3.8 } },
    ]);
    expect(added).toBe(1);
    expect(doc.members.a).toEqual([99, 99, 1]);
    expect(doc.members.b).toEqual([12, -4, 0]);
    expect(doc.autoSeeded).toBe(1);
  });

  it("没有可播种节点时也要标记完成，否则每次打开都重跑一次播种", () => {
    const doc = markSeeded(createEmptyGraphDoc());
    expect(doc.autoSeeded).toBe(1);
    expect(markSeeded(doc)).toBe(doc);
  });
});

describe("写回与冲突", () => {
  it("落库推进 rev 并刷新时间戳", () => {
    const next = stampGraphDoc(createEmptyGraphDoc(), 1234);
    expect(next.rev).toBe(1);
    expect(next.ts).toBe(1234);
  });

  it("视口未变化时返回同一引用", () => {
    const base = createEmptyGraphDoc();
    expect(setViewport(base, { k: 1, tx: 0, ty: 0 })).toBe(base);
    expect(setViewport(base, { k: 2, tx: 0, ty: 0 }).view.k).toBe(2);
  });
});
