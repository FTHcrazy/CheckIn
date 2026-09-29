import { coverPaletteOf, formatDayLabel, formatWordsCompact, type WorkCardView } from "../../bookshelf-utils";
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
 */
export default function BookCard({ card, view, onOpen }: BookCardProps) {
  const palette = coverPaletteOf(card.id);
  const initial = card.name.trim().charAt(0) || "书";
  const updatedText = card.updatedAt
    ? `${formatDayLabel(card.updatedAt)}更新`
    : "尚未动笔";

  return (
    <div
      className={`bs-card bs-card--${view}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(card.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(card.id);
        }
      }}
      aria-label={`打开《${card.name}》`}
    >
      <div
        className="bs-card__cover"
        style={{ background: `linear-gradient(160deg, ${palette.from}, ${palette.to})` }}
      >
        <span className="bs-card__cover-char" style={{ color: palette.accent }} aria-hidden>
          {initial}
        </span>
      </div>

      <div className="bs-card__info">
        <div className="bs-card__name-row">
          <span className="bs-card__name">{card.name}</span>
          <span className={`bs-card__badge bs-card__badge--${card.status}`}>
            {card.status === "finished" ? "已完稿" : "连载中"}
          </span>
        </div>
        <p className="bs-card__meta">
          {formatWordsCompact(card.totalWords)}字 · {card.chapterCount} 章
        </p>
        <p className="bs-card__updated">{updatedText}</p>
      </div>
    </div>
  );
}
