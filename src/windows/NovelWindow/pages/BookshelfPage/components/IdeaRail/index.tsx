import { ArrowUpOutlined, PlusOutlined } from "@ant-design/icons";
import { useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import type { InputRef } from "antd";
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
  onRemove: (noteId: string) => void;
}

const FILTER_CHIPS: Array<{ key: IdeaFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unassigned", label: "未归属" },
  { key: "pinned", label: "置顶" },
  { key: "archived", label: "已归档" },
];

/**
 * 全局灵感库右栏（R32）：跨作品收集池。
 * 捕捉框 Enter 直接记录（Shift+Enter 换行），归属可选「未归属」或任一作品；
 * 灵感卡支持置顶 / 归档到作品 / 退回灵感池 / 删除。
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

  return (
    <aside className="bs-rail" aria-label="全局灵感库">
      <div className="bs-rail__head">
        <span className="bs-rail__title">灵感库</span>
        <span className="bs-rail__total">全部 {counts.all}</span>
        <button
          type="button"
          className="bs-rail__plus"
          onClick={() => textareaRef.current?.focus()}
          aria-label="记一条灵感"
        >
          <PlusOutlined />
        </button>
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
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={filter === chip.key}
            className={`bs-rail__chip${filter === chip.key ? " is-active" : ""}`}
            onClick={() => onFilterChange(chip.key)}
          >
            {chip.label}
            <span className="bs-rail__chip-count">{counts[chip.key]}</span>
          </button>
        ))}
      </div>

      <div className="bs-rail__list">
        {visibleNotes.length === 0 ? (
          <div className="bs-rail__empty">还没有符合条件的灵感，随手记一条吧</div>
        ) : (
          visibleNotes.map((note) => {
            const workName = note.workId ? workNameOf(note.workId) : null;
            return (
              <IdeaNoteCard
                key={note.id}
                note={note}
                workName={note.workId ? workName ?? "未知作品" : null}
                workOptions={workOptions}
                onTogglePin={() => onTogglePin(note.id)}
                onArchiveTo={(workId) => onMove(note.id, workId)}
                onUnassign={() => onMove(note.id, "")}
                onRemove={() => onRemove(note.id)}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}
