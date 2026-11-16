import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpritePanel from "./index";
import { SPRITES } from "../../sprites";

/**
 * 素材卡片的控件契约（AGENTS §6.1.2 / §8.3）。
 *
 * 卡片是「整块可点」的自带造型控件：必须用 antd Button 承载，才能拿到键盘
 * 可达、focus 环、aria-pressed 与组件级变量驱动的 hover 态。原生 <button>
 * 在暗色主题下不跟随 darkAlgorithm，且会与同页其余 8 个 antd 组件混用。
 */
afterEach(cleanup);

describe("SpritePanel 素材卡片", () => {
  it("每张卡片都由组件库按钮承载（不出现原生按钮）", () => {
    const { container } = render(<SpritePanel pendingSpriteId={null} onPick={vi.fn()} />);
    const cards = container.querySelectorAll(".sprite-card");
    expect(cards.length).toBe(SPRITES.length);
    for (const card of cards) {
      expect(card.tagName).toBe("BUTTON");
      expect(card.classList.contains("ant-btn")).toBe(true);
    }
  });

  it("点击素材进入待放置态，再点同一素材取消", () => {
    const onPick = vi.fn();
    const first = SPRITES[0];
    const { rerender } = render(<SpritePanel pendingSpriteId={null} onPick={onPick} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onPick).toHaveBeenCalledWith(first.id);

    rerender(<SpritePanel pendingSpriteId={first.id} onPick={onPick} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("选中态写在 aria-pressed 上", () => {
    const first = SPRITES[0];
    render(<SpritePanel pendingSpriteId={first.id} onPick={vi.fn()} />);
    expect(screen.getAllByRole("button")[0].getAttribute("aria-pressed")).toBe("true");
  });
});
