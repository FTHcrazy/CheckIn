/**
 * 灵感库可复用内容体（O-12）
 *
 * 从书架 IdeaRail 抽出，放到窗口级：书架（常驻右栏）与编辑器全局灵感抽屉
 * 复用同一份筛选 / 列表 / 动作词，单向流两处从此一致。
 * 组件本身受控、不碰 store / IPC；捕捉框外壳由使用方决定是否渲染。
 */
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowUpOutlined } from "@ant-design/icons";
import { Button, Input, Select } from "antd";
import type { InputRef } from "antd";
import { Virtuoso } from "react-virtuoso";
import type { NovelNoteDTO } from "@/shared/types/electron";
import IdeaNoteCard from "../IdeaNoteCard";
import type { IdeaFilter } from "../../utils/idea-filter";
import "./index.scss";

export type { IdeaFilter };

export interface IdeaLibraryContentProps {
  notes: NovelNoteDTO[];
  counts: Record<IdeaFilter, number>;
  filter: IdeaFilter;
  onFilterChange: (filter: IdeaFilter) => void;
  workOptions: Array<{ id: string; name: string }>;
  workNameOf: (workId: string) => string | null;
  onAdd: (content: string, workId: string) => boolean;
  onMove: (noteId: string, workId: string) => void;
  onTogglePin: (noteId: string, pinned: boolean) => void;
  onUpdate: (noteId: string, content: string) => void;
  onRemove: (noteId: string) => void;
  /** 已转伏笔的点转伏笔角标只读；抽屉内不传即不展示该动作 */
  onPromote?: (noteId: string) => void;
  /** 书架保留捕捉框；编辑器抽屉里只查看，不重复给新增入口 */
  showCapture?: boolean;
  /** 少于该条数不挂虚拟列表（与抽出前 IdeaRail 同口径） */
  virtualizeFrom?: number;
}

const FILTER_CHIPS: Array<{ key: IdeaFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unassigned", label: "未归属" },
  { key: "pinned", label: "置顶" },
  // 「归档」一词只留给筛选态；动作一律用「归属」
  { key: "archived", label: "已归档" },
];

const IDEA_ITEM_ESTIMATE = 96;

export default function IdeaLibraryContent({
  notes,
  counts,
  filter,
  onFilterChange,
  workOptions,
  workNameOf,
  onAdd,
  onMove,
  onTogglePin,
  onUpdate,
  onRemove,
  onPromote,
  showCapture = true,
  virtualizeFrom = 30,
}: IdeaLibraryContentProps) {
  const [draft, setDraft] = useState("");
  const [captureWorkId, setCaptureWorkId] = useState("");
  const textareaRef = useRef<InputRef>(null);

  const submit = (): void => {
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
        onTogglePin={() => onTogglePin(note.id, !note.pinned)}
        onMoveTo={(workId) => onMove(note.id, workId)}
        onUpdateContent={(content) => onUpdate(note.id, content)}
        onRemove={() => onRemove(note.id)}
        onPromote={onPromote ? () => onPromote(note.id) : undefined}
      />
    );
  };

  const virtualize = notes.length >= virtualizeFrom;

  return (
    <>
      {showCapture && (
        <div className="bs-rail__capture">
          <Input.TextArea
            ref={textareaRef}
            className="bs-rail__input"
            variant="borderless"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.nativeEvent.isComposing) return;
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
                ...workOptions.map((work) => ({
                  value: work.id,
                  label: `《${work.name}》`,
                })),
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
      )}

      <div className="bs-rail__chips" role="tablist" aria-label="灵感筛选">
        {FILTER_CHIPS.map((chip) => (
          <Button
            key={chip.key}
            role="tab"
            aria-pressed={filter === chip.key}
            className={`bs-rail__chip${filter === chip.key ? " is-active" : ""}`}
            onClick={() => onFilterChange(chip.key)}
          >
            {chip.label}
            <span className="bs-rail__chip-count">{counts[chip.key]}</span>
          </Button>
        ))}
      </div>

      {notes.length === 0 ? (
        <div className="bs-rail__empty">还没有符合条件的灵感，随手记一条吧</div>
      ) : virtualize ? (
        <Virtuoso
          className="bs-rail__list"
          data={notes}
          overscan={8}
          defaultItemHeight={IDEA_ITEM_ESTIMATE}
          increaseViewportBy={{ top: 240, bottom: 240 }}
          computeItemKey={(_, note) => note.id}
          itemContent={(_, note) => (
            <div className="bs-rail__cell">{renderCard(note)}</div>
          )}
        />
      ) : (
        <div className="bs-rail__list">
          {notes.map((note) => (
            <div className="bs-rail__cell" key={note.id}>
              {renderCard(note)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
