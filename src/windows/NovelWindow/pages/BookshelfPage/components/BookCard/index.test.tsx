import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkCardView } from "../../bookshelf-utils";
import BookCard from "./index";

/**
 * 书卡封面与右键入口守卫（2.56.0）。
 *
 * 封面是「导入过就显示图片、没导入就还是渐变首字」两档；右键则要把
 * **光标坐标**交出去，菜单才能停在用户点的位置，而不是卡片左上角。
 */
const card: WorkCardView = {
  id: "w1",
  name: "山海拾遗",
  createdAt: 1,
  totalWords: 1200,
  chapterCount: 3,
  doneCount: 1,
  volumeCount: 1,
  updatedAt: 2,
  status: "ongoing",
};

afterEach(cleanup);

describe("BookCard：封面与右键", () => {
  it("没导入封面时是程序化渐变 + 首字水印", () => {
    const { container } = render(
      <BookCard card={card} view="grid" onOpen={() => undefined} />,
    );

    expect(container.querySelector(".bs-card__cover-char")?.textContent).toBe("山");
    expect(container.querySelector(".bs-card__cover-img")).toBeNull();
  });

  it("导入过封面就换 <img>，两种视图都渲染且不挡住卡片", () => {
    for (const view of ["grid", "list"] as const) {
      const { container } = render(
        <BookCard
          card={{ ...card, cover: "data:image/jpeg;base64,AAA" }}
          view={view}
          onOpen={() => undefined}
        />,
      );
      const img = container.querySelector<HTMLImageElement>(".bs-card__cover-img");
      expect(img?.getAttribute("src")).toBe("data:image/jpeg;base64,AAA");
      expect(container.querySelector(".bs-card__cover")?.classList.contains("is-image")).toBe(true);
      expect(container.querySelector(".bs-card__cover-char")).toBeNull();
      cleanup();
    }
  });

  it("右键把光标坐标交给页面，并拦下 Electron 默认菜单", () => {
    const onContextMenu = vi.fn();
    render(
      <BookCard
        card={card}
        view="grid"
        onOpen={() => undefined}
        onContextMenu={onContextMenu}
      />,
    );
    const button = screen.getByRole("button", { name: "打开《山海拾遗》" });
    const event = fireEvent.contextMenu(button, { clientX: 321, clientY: 456 });

    // fireEvent 返回 false 即 preventDefault 生效
    expect(event).toBe(false);
    expect(onContextMenu).toHaveBeenCalledWith(321, 456);
  });
});
