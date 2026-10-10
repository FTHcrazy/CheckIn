import { Button } from "antd";
import { RightOutlined } from "@ant-design/icons";
import {
  coverPaletteOf,
  formatDayLabel,
  formatWordsCompact,
  type WorkCardView,
} from "../../bookshelf-utils";
import type { ShelfViewMode } from "../ShelfToolbar";
import "./index.scss";

interface BookCardProps {
  card: WorkCardView;
  view: ShelfViewMode;
  onOpen: (workId: string) => void;
}

/**
 * 书卡（R32）：程序化渐变封面 + 首字水印（无图片依赖，与编辑器的
 * 程序化贴图思路一致）；连载状态 chip + 字数章节 + 最近更新时间。
 *
 * 整卡就是一个入口，由组件库 `Button` 承载（§6.1.2）：旧实现是 div[role=button]，
 * 键盘/焦点环/按压语义全靠手写补齐，且 `role=button` 的容器在朗读器里会丢失
 * 「激活」提示。注意 `<p>` 不能嵌进 `<button>` → meta / updated 改用 `<span>`。
 *
 * 两种视图的信息架构不同，分开渲染而不是靠 CSS 折腾同一棵树：
 * 网格 = 封面在上 + 信息堆叠；列表 = 横排行（标题行 / 合并 meta 行）+
 * 右缘「更新时间 + 箭头」尾随区，扫读时视线不用跳。
 */
export default function BookCard({ card, view, onOpen }: BookCardProps) {
  const palette = coverPaletteOf(card.id);
  const initial = card.name.trim().charAt(0) || "书";
  const updatedText = card.updatedAt
    ? `${formatDayLabel(card.updatedAt)}更新`
    : "尚未动笔";

  const cover = (
    <span
      className="bs-card__cover"
      style={{ background: `linear-gradient(160deg, ${palette.from}, ${palette.to})` }}
    >
      <span className="bs-card__cover-char" style={{ color: palette.accent }} aria-hidden>
        {initial}
      </span>
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
        aria-label={`打开《${card.name}》`}
      >
        {cover}
        <span className="bs-card__info">
          {nameRow}
          <span className="bs-card__meta">
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
      aria-label={`打开《${card.name}》`}
    >
      {/* button 的内容模型是 phrasing content：一律用 span + display:flex，
          嵌 div 是非法 HTML，浏览器会把结构拆坏 */}
      {cover}
      <span className="bs-card__info">
        {nameRow}
        <span className="bs-card__meta">
          {formatWordsCompact(card.totalWords)}字 · {card.chapterCount} 章
        </span>
        <span className="bs-card__updated">{updatedText}</span>
      </span>
    </Button>
  );
}
