import { describe, expect, it } from "vitest";
import type { GlossaryTerm } from "../../data/interview-glossary";
import { aliasOfMenuKey, buildTermMenu, EDIT_KEY, isTermMenuGroup, UNBIND_KEY } from "./term-menu";

function makeTerm(id: string, term: string, extra: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id,
    term,
    domain: "browser",
    short: "一句话定义。",
    detail: ["展开细节。"],
    ...extra,
  };
}

/**
 * 右键菜单守卫。
 *
 * 菜单是「纯文本匹配出错」的唯一补救口，退化方式都很安静：
 * 少一项 → 用户找不到动作；多一项无效项 → 点了没反应；
 * key 拼错 → 面板点了不生效（`aliasOfMenuKey` 解不出来）。
 */
describe("默认必须有「这里不是这个词」", () => {
  it("没有别名时只有解除绑定一项", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流"),
      hitText: "节流",
      hitKey: "节流",
    });
    expect(nodes).toEqual([{ key: UNBIND_KEY, label: "这里不是「节流」" }]);
  });

  it("标签用正文里的原文，而不是词条名（划中的可能是别名）", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流", { aliases: ["throttle"] }),
      hitText: "throttle",
      hitKey: "throttle",
    });
    expect(nodes[0].key).toBe(UNBIND_KEY);
    expect(nodes[0].label).toBe("这里不是「throttle」");
  });
});

describe("别名删除", () => {
  it("命中的正是别名：直接给「删掉别名」，不再收进子菜单", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流", { aliases: ["throttle"] }),
      hitText: "throttle",
      hitKey: "throttle",
    });
    expect(nodes.map((node) => node.label)).toEqual([
      "这里不是「throttle」",
      "删掉别名「throttle」",
    ]);
    expect(aliasOfMenuKey(nodes[1].key)).toBe("throttle");
  });

  it("命中的是词名：别名剩下的逐条可删", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流", { aliases: ["throttle", "限流"] }),
      hitText: "节流",
      hitKey: "节流",
    });
    expect(nodes).toHaveLength(3);
    expect(nodes.slice(1).map((node) => aliasOfMenuKey(node.key))).toEqual(["throttle", "限流"]);
  });

  it("别名三条以上收成子菜单（避免菜单一屏全是别名）", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流", { aliases: ["a", "b", "c"] }),
      hitText: "节流",
      hitKey: "节流",
    });
    const group = nodes[1];
    expect(isTermMenuGroup(group)).toBe(true);
    if (!isTermMenuGroup(group)) return;
    expect(group.label).toBe("删掉某个别名");
    expect(group.children.map((child) => aliasOfMenuKey(child.key))).toEqual(["a", "b", "c"]);
  });

  it("命中的别名已不在列表里（数据刚变过）时不额外塞一项", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流"),
      hitText: "throttle",
      hitKey: "throttle",
    });
    expect(nodes).toHaveLength(1);
  });

  it("空串别名被过滤（库里可能有历史脏数据）", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流", { aliases: ["  ", "限流"] }),
      hitText: "节流",
      hitKey: "节流",
    });
    expect(nodes.slice(1).map((node) => aliasOfMenuKey(node.key))).toEqual(["限流"]);
  });
});

describe("aliasOfMenuKey", () => {
  it("只认带前缀的键", () => {
    expect(aliasOfMenuKey("unbind")).toBeNull();
    expect(aliasOfMenuKey("alias:")).toBeNull();
    expect(aliasOfMenuKey("alias:闭包")).toBe("闭包");
  });
});

/**
 * 编辑词条是「词条本身建错了」的出口：领域不对 / 词名太长 / 定义写歪。
 * 它必须与「这里不是这个词」并列摆着 —— 后者只治一处，前者治根。
 */
describe("编辑词条入口", () => {
  it("接线了才给这一项（没接线时不给点了没反应的菜单）", () => {
    const term = makeTerm("g-throttle", "节流");
    const without = buildTermMenu({ term, hitText: "节流", hitKey: "节流" });
    const withEdit = buildTermMenu({ term, hitText: "节流", hitKey: "节流", canEdit: true });

    expect(without.map((node) => node.key)).toEqual([UNBIND_KEY]);
    expect(withEdit.map((node) => node.key)).toEqual([UNBIND_KEY, EDIT_KEY]);
  });

  it("标签点名要编辑的是哪条词条", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流"),
      hitText: "节流",
      hitKey: "节流",
      canEdit: true,
    });
    expect(nodes[1].label).toBe("编辑词条「节流」");
  });

  it("编辑项排在别名删除之前（先修词条，再逐个删说法）", () => {
    const nodes = buildTermMenu({
      term: makeTerm("g-throttle", "节流", { aliases: ["限流"] }),
      hitText: "节流",
      hitKey: "节流",
      canEdit: true,
    });
    expect(nodes.map((node) => node.key)).toEqual([UNBIND_KEY, EDIT_KEY, "alias:限流"]);
  });
});
