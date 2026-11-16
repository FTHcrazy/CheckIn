import { Button } from "antd";
import { RightOutlined } from "@ant-design/icons";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  coverPaletteOf,
  formatDayLabel,
  formatGenreLabel,
  formatWordsCompact,
  type WorkCardView,
} from "../../bookshelf-utils";
import type { ShelfViewMode } from "../ShelfToolbar";
import "./index.scss";

interface BookCardProps {
  card: WorkCardView;
  view: ShelfViewMode;
  onOpen: (workId: string) => void;
  /** 右键书卡：由页面把「哪本书 + 光标在哪」交给作品操作菜单 */
  onContextMenu?: (x: number, y: number) => void;
}

/**
 * 书卡（R32）：程序化渐变封面 + 首字水印（无图片依赖，与编辑器的
 * 程序化贴图思路一致）；连载状态 chip + 题材 + 字数章节 + 最近更新时间。
 *
 * 整卡就是一个入口，由组件库 `Button` 承载（§6.1.2）：旧实现是 div[role=button]，
 * 键盘/焦点环/按压语义全靠手写补齐，且 `role=button` 的容器在朗读器里会丢失
 * 「激活」提示。注意 `<p>` 不能嵌进 `<button>` → meta / updated 改用 `<span>`。
 *
 * 两种视图的信息架构不同，分开渲染而不是靠 CSS 折腾同一棵树：
 * 网格 = 封面在上 + 信息堆叠；列表 = 横排行（标题行 / 合并 meta 行）+
 * 右缘「更新时间 + 箭头」尾随区，扫读时视线不用跳。题材在网格里单独一行、
 * 在列表里并进 meta 行——列表行高是硬约束（多一行就让平铺的几十本变笨重）。
 */
export default function BookCard({ card, view, onOpen, onContextMenu }: BookCardProps) {
  const palette = coverPaletteOf(card.id);
  const initial = card.name.trim().charAt(0) || "书";
  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    // 书架是桌面应用：右键不该冒出 Electron 默认的「检查元素」菜单
    event.preventDefault();
    onContextMenu?.(event.clientX, event.clientY);
  };
  const updatedText = card.updatedAt
    ? `${formatDayLabel(card.updatedAt)}更新`
    : "尚未动笔";
  const genreText = formatGenreLabel(card.genre);
  // 未设置题材时压一档色，读成「待补」而不是「这就是它的分类」
  const genreClass = card.genre?.trim()
    ? "bs-card__genre"
    : "bs-card__genre is-unset";

  /**
   * 封面有两档：导入过图片就用图片，否则还是那张程序化渐变 + 首字水印。
   * 图片是主进程压到 320px 宽的 JPEG data URL（见 novel-work-cover），
   * <img> 用 object-fit: cover 自己适配网格 5:4 与列表 38×50 两种比例。
   */
  const cover = (
    <span
      className={`bs-card__cover${card.cover ? " is-image" : ""}`}
      style={{ background: `linear-gradient(160deg, ${palette.from}, ${palette.to})` }}
    >
      {card.cover ? (
        <img
          className="bs-card__cover-img"
          src={card.cover}
          alt={`《${card.name}》封面`}
          draggable={false}
        />
      ) : (
        <span className="bs-card__cover-char" style={{ color: palette.accent }} aria-hidden>
          {initial}
        </span>
      )}
    </span>
  );

  const nameRow = (
    <span className="bs-card__name-row">
      <span className="bs-card__name">{card.name}</span>
      <span className={`bs-card__badge bs-card__badge--${card.status}`}>
        {card.status === "finished" ? "已完稿" : "连载中"}
      </span>
    </span>
  );

  if (view === "list") {
    return (
      <Button
        className="bs-card bs-card--list"
        onClick={() => onOpen(card.id)}
        onContextMenu={handleContextMenu}
        aria-label={`打开《${card.name}》`}
      >
        {cover}
        <span className="bs-card__info">
          {nameRow}
          <span className="bs-card__meta">
            <span className={genreClass}>{genreText}</span>
            {" · "}
            {formatWordsCompact(card.totalWords)}字 · {card.chapterCount} 章 ·{" "}
            <span className="bs-card__updated">{updatedText}</span>
          </span>
        </span>
        <span className="bs-card__trail">
          <RightOutlined className="bs-card__go" aria-hidden />
        </span>
      </Button>
    );
  }

  return (
    <Button
      className="bs-card bs-card--grid"
      onClick={() => onOpen(card.id)}
      onContextMenu={handleContextMenu}
      aria-label={`打开《${card.name}》`}
    >
      {/* button 的内容模型是 phrasing content：一律用 span + display:flex，
          嵌 div 是非法 HTML，浏览器会把结构拆坏 */}
      {cover}
      <span className="bs-card__info">
        {nameRow}
        <span className={genreClass}>{genreText}</span>
        <span className="bs-card__meta">
          {formatWordsCompact(card.totalWords)}字 · {card.chapterCount} 章
        </span>
        <span className="bs-card__updated">{updatedText}</span>
      </span>
    </Button>
  );
}
