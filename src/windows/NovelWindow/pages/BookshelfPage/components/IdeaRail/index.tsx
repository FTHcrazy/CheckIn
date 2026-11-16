import { ArrowUpOutlined } from "@ant-design/icons";
import { useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import type { InputRef } from "antd";
import { Virtuoso } from "react-virtuoso";
import type { IdeaFilter } from "../../bookshelf-utils";
import IdeaNoteCard from "../IdeaNoteCard";
import type { NovelNoteDTO } from "@/shared/types/electron";
import "./index.scss";

interface IdeaRailProps {
  counts: Record<IdeaFilter, number>;
  filter: IdeaFilter;
  onFilterChange: (filter: IdeaFilter) => void;
  /** 已按筛选 + 关键词排好序的灵感列表（页面派生） */
  visibleNotes: NovelNoteDTO[];
  workOptions: Array<{ id: string; name: string }>;
  workNameOf: (workId: string) => string | null;
  onAdd: (content: string, workId: string) => boolean;
  onTogglePin: (noteId: string) => void;
  onMove: (noteId: string, workId: string) => void;
  onUpdateContent: (noteId: string, content: string) => void;
  onRemove: (noteId: string) => void;
}

const FILTER_CHIPS: Array<{ key: IdeaFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unassigned", label: "未归属" },
  { key: "pinned", label: "置顶" },
  { key: "archived", label: "已归档" },
];

/**
 * 少于这个条数就走普通渲染，不挂虚拟列表。
 *
 * 虚拟化的初衷是「灵感攒到上千条」（1.41.0），但数据集小、内容又刚好比视口
 * 高一点点时，Virtuoso 的高度测量修正会让滚动位置反复回拉 —— 表现就是滚到
 * 最底部时列表上下抖动。三十条以内最多两三屏，原生滚动完全够用，也彻底没有
 * 这条「高度修正 ↔ 滚动位置」的回路。
 */
const VIRTUALIZE_FROM = 30;

/**
 * 虚拟列表的行高估算（px，含 `.bs-rail__cell` 的 8px 间距）。
 *
 * 虚拟列表的总高是「估算 → 逐项实测修正」两步得来的，估算一旦离谱，滚动中
 * 就会看到列表总高一直在涨、位置被反复钳制（实测：不传这个值时首帧总高等于
 * 视口高，随后一次跳 +498px；给了接近真实的值，滚动中的爬升压到十几像素）。
 * 灵感卡按 1~3 行 clamp，取 1~2 行的中位高度做估算。
 */
const IDEA_ITEM_ESTIMATE = 96;

/**
 * 全局灵感库右栏（R32）：跨作品收集池。
 * 捕捉框 Enter 直接记录（Shift+Enter 换行），归属可选「未归属」或任一作品；
 * 灵感卡支持置顶 / 编辑 / 归档到作品 / 退回灵感池 / 删除。
 *
 * 列表虚拟化（1.41.0）：此前是 `.map` 全量挂载，灵感攒到上千条会把右栏
 * 拖垮 —— 与编辑器灵感面板（InspirationPanel）同款 Virtuoso 方案；
 * 2.55.0 起按条数分流，小数据集继续走原生滚动（见 `VIRTUALIZE_FROM`）。
 */
export default function IdeaRail({
  counts,
  filter,
  onFilterChange,
  visibleNotes,
  workOptions,
  workNameOf,
  onAdd,
  onTogglePin,
  onMove,
  onUpdateContent,
  onRemove,
}: IdeaRailProps) {
  const [draft, setDraft] = useState("");
  const [captureWorkId, setCaptureWorkId] = useState("");
  const textareaRef = useRef<InputRef>(null);

  const submit = () => {
    if (!draft.trim()) return;
    if (onAdd(draft, captureWorkId)) {
      setDraft("");
      textareaRef.current?.focus();
    }
  };

  const renderCard = (note: NovelNoteDTO) => {
    const workName = note.workId ? workNameOf(note.workId) : null;
    return (
      <IdeaNoteCard
        note={note}
        workName={note.workId ? workName ?? "未知作品" : null}
        workOptions={workOptions}
        onTogglePin={() => onTogglePin(note.id)}
        onArchiveTo={(workId) => onMove(note.id, workId)}
        onUnassign={() => onMove(note.id, "")}
        onUpdateContent={(content) => onUpdateContent(note.id, content)}
        onRemove={() => onRemove(note.id)}
      />
    );
  };

  const virtualize = visibleNotes.length >= VIRTUALIZE_FROM;

  return (
    <aside className="bs-rail" aria-label="全局灵感库">
      <div className="bs-rail__head">
        <span className="bs-rail__title">灵感库</span>
        <span className="bs-rail__total">全部 {counts.all}</span>
      </div>
      <p className="bs-rail__subtitle">跨作品收集，随时归纳到作品或回编辑器转为伏笔</p>

      <div className="bs-rail__capture">
        <Input.TextArea
          ref={textareaRef}
          className="bs-rail__input"
          variant="borderless"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="随手记一条灵感…（Enter 记录）"
          rows={2}
        />
        <div className="bs-rail__capture-foot">
          <Select
            className="bs-rail__owner"
            value={captureWorkId}
            onChange={setCaptureWorkId}
            size="small"
            variant="borderless"
            popupMatchSelectWidth={false}
            options={[
              { value: "", label: "未归属" },
              ...workOptions.map((work) => ({ value: work.id, label: `《${work.name}》` })),
            ]}
          />
          <Button
            type="primary"
            size="small"
            shape="circle"
            icon={<ArrowUpOutlined />}
            disabled={!draft.trim()}
            onClick={submit}
            aria-label="记录灵感"
          />
        </div>
      </div>

      <div className="bs-rail__chips" role="tablist" aria-label="灵感筛选">
        {FILTER_CHIPS.map((chip) => (
          <Button
            key={chip.key}
            role="tab"
            aria-selected={filter === chip.key}
            className={`bs-rail__chip${filter === chip.key ? " is-active" : ""}`}
            onClick={() => onFilterChange(chip.key)}
          >
            {chip.label}
            <span className="bs-rail__chip-count">{counts[chip.key]}</span>
          </Button>
        ))}
      </div>

      {visibleNotes.length === 0 ? (
        <div className="bs-rail__empty">还没有符合条件的灵感，随手记一条吧</div>
      ) : virtualize ? (
        <Virtuoso
          className="bs-rail__list"
          data={visibleNotes}
          overscan={8}
          defaultItemHeight={IDEA_ITEM_ESTIMATE}
          increaseViewportBy={{ top: 240, bottom: 240 }}
          computeItemKey={(_, note) => note.id}
          itemContent={(_, note) => <div className="bs-rail__cell">{renderCard(note)}</div>}
        />
      ) : (
        <div className="bs-rail__list">
          {visibleNotes.map((note) => (
            <div className="bs-rail__cell" key={note.id}>
              {renderCard(note)}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
