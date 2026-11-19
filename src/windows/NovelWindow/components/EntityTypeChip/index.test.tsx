import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENTITY_TYPE_META } from "@/shared/novel/entity-type-meta";
import EntityTypeChip from ".";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("EntityTypeChip：前缀是文本节点、形态按 §6.1.2", () => {
  it("纯展示用 antd Tag，前缀字可被读屏读到（不是 ::before）", () => {
    const { container } = render(
      <EntityTypeChip meta={ENTITY_TYPE_META.character}>林晚照</EntityTypeChip>,
    );
    expect(container.querySelector(".ant-tag")).not.toBeNull();
    expect(screen.getByText("人")).toBeTruthy();
    expect(screen.getByText("林晚照")).toBeTruthy();
    expect(container.querySelector(".ant-btn")).toBeNull();
  });

  it("可点筛选用一个 antd Button + aria-pressed，点击回调透传", () => {
    const onClick = vi.fn();
    const { container } = render(
      <EntityTypeChip
        meta={ENTITY_TYPE_META.location}
        pressed
        onClick={onClick}
      >
        青云山
      </EntityTypeChip>,
    );
    const button = container.querySelector("button.ant-btn");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("地")).toBeTruthy();
    (button as HTMLElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("前缀来源唯一：直接取传入 meta.glyph，不硬编码", () => {
    const meta = { ...ENTITY_TYPE_META.item, glyph: "物" };
    render(<EntityTypeChip meta={meta}>玄铁剑</EntityTypeChip>);
    expect(screen.getByText("物")).toBeTruthy();
  });
});
