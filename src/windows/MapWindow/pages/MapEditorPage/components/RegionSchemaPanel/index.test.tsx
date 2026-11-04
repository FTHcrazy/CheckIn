import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RegionSchemaPanel from "./index";
import { DEFAULT_REGION_SCHEMA, REGION_TOTAL_LIMIT, type RegionLevelDef } from "../../regions";

/**
 * `RegionSchemaPanel` 的纯 props 行为（R-REG-01）。
 *
 * 【为什么能在这一层测】面板不读 store、不写文档：输入是 `schema`，输出是
 * "下一份完整 schema"（`onChange`）+ "一次连续调参结束"（`onEditEnd`）。
 * 快照账目（合并键）与"减少层数要删区块"的二次确认都在页面/store 侧，
 * 各有一处用例；这里只钉"面板算得对、且不篡改入参"。
 */

const noop = () => {};

function schema(levels: number): RegionLevelDef[] {
  return DEFAULT_REGION_SCHEMA.slice(0, levels).map((def) => ({ ...def }));
}

function panel(props: {
  schema: readonly RegionLevelDef[];
  onChange?: (next: RegionLevelDef[]) => void;
  onEditEnd?: () => void;
  onApplyAndGenerate?: () => void;
}) {
  return render(
    <RegionSchemaPanel
      schema={props.schema}
      onChange={props.onChange ?? noop}
      onEditEnd={props.onEditEnd ?? noop}
      onApplyAndGenerate={props.onApplyAndGenerate ?? noop}
    />,
  );
}

afterEach(cleanup);

describe("RegionSchemaPanel 合计与超限", () => {
  it("默认四级合计 223 / 600，未超限 ⇒「应用并生成区块」可点", () => {
    panel({ schema: schema(4) });
    expect(screen.getByLabelText("层级数量合计").textContent).toContain("223");
    expect(screen.getByRole("button", { name: /应用并生成区块/ })).not.toBeDisabled();
  });

  it("合计超上限：标红（--over 类）且禁用「应用并生成区块」", () => {
    // 600 上限：三级各 300 ⇒ 900
    const over: RegionLevelDef[] = [
      { name: "大陆", count: 300 },
      { name: "洲", count: 300 },
      { name: "国家", count: 300 },
    ];
    expect(over.reduce((s, d) => s + d.count, 0)).toBeGreaterThan(REGION_TOTAL_LIMIT);
    panel({ schema: over });

    const total = screen.getByLabelText("层级数量合计");
    expect(total.className).toContain("region-schema-panel__total--over");
    expect(screen.getByRole("button", { name: /应用并生成区块/ })).toBeDisabled();
  });
});

describe("RegionSchemaPanel 编辑（不可变 + 断键）", () => {
  it("改名称：失焦提交，产出**新数组**且不修改入参", () => {
    const input = schema(2);
    const snapshot = JSON.parse(JSON.stringify(input)) as RegionLevelDef[];
    const onChange = vi.fn();
    const onEditEnd = vi.fn();
    panel({ schema: input, onChange, onEditEnd });

    const nameBox = screen.getByRole("textbox", { name: "第 1 级名称" });
    fireEvent.change(nameBox, { target: { value: "大陆甲" } });
    fireEvent.blur(nameBox);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as RegionLevelDef[];
    expect(next[0].name).toBe("大陆甲");
    expect(next[1]).toEqual(input[1]);
    // 入参一字未改（面板绝不能原地写）
    expect(input).toEqual(snapshot);
    // 一次改名到此结束 ⇒ 断快照合并键
    expect(onEditEnd).toHaveBeenCalledTimes(1);
  });

  it("名称没变就不提交（失焦不该压一步空编辑）", () => {
    const onChange = vi.fn();
    const onEditEnd = vi.fn();
    panel({ schema: schema(2), onChange, onEditEnd });

    const nameBox = screen.getByRole("textbox", { name: "第 1 级名称" });
    fireEvent.blur(nameBox);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("层数从 2 加到 3：新增一级名为 L3、数量 = 上一级 × 4", () => {
    const input = schema(2); // 3 / 12
    const onChange = vi.fn();
    panel({ schema: input, onChange });

    const depth = screen.getByRole("spinbutton", { name: "层数" });
    fireEvent.change(depth, { target: { value: "3" } });

    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const next = calls[calls.length - 1][0] as RegionLevelDef[];
    expect(next).toHaveLength(3);
    expect(next[2].name).toBe("L3");
    expect(next[2].count).toBe(input[1].count * 4);
  });

  it("重置为默认：产出默认四级（新数组）并断键", () => {
    const onChange = vi.fn();
    const onEditEnd = vi.fn();
    panel({ schema: [{ name: "只有一级", count: 5 }], onChange, onEditEnd });

    fireEvent.click(screen.getByRole("button", { name: /重置为默认/ }));

    const next = onChange.mock.calls[0][0] as RegionLevelDef[];
    expect(next).toEqual(DEFAULT_REGION_SCHEMA.map((def) => ({ ...def })));
    expect(next).not.toBe(DEFAULT_REGION_SCHEMA); // 必须是副本，不能把常量递出去
    expect(onEditEnd).toHaveBeenCalledTimes(1);
  });

  it("「应用并生成区块」把动作原样转给页面（面板自己不做生成）", () => {
    const onApplyAndGenerate = vi.fn();
    panel({ schema: schema(4), onApplyAndGenerate });

    fireEvent.click(screen.getByRole("button", { name: /应用并生成区块/ }));
    expect(onApplyAndGenerate).toHaveBeenCalledTimes(1);
  });
});
