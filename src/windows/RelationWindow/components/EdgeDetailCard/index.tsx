/**
 * 边详情卡（S3 / W-17 的「边详情只读边界」）
 *
 * 边在数据层可能是多条平行关系（同一对要素的「同门」「道侣」「宿敌」），画布上
 * 合并成一条「首条 + N」。这里把 N 条逐条摊开，只做两件事：
 * ① **改备注**（每条关系自己的 note，上限 200 字，走 `novel-graph-commit` 事务）；
 * ② **去右栏删除**（跳回主窗口的要素资料卡，删除动作只在那边发生）。
 *
 * 刻意不提供：改关系名、删边、删要素、改类型。关系名的唯一编辑入口仍是主窗口
 * 右栏 —— 图上能改名会让「一条边 = 哪一行」变得难以解释，而删除是不可逆动作，
 * 值得多一次跳转。
 *
 * 排版按四段分区（纯视觉，交互语义不变）：标题区 / 关系列表 / 备注编辑 / 删除区。
 * 「关系列表」里先标两端要素，再逐条摊开关系；备注编辑是行内的独立块，编辑态下
 * 用主色描边 + 槽底色把它与相邻关系行切开。
 */
import { useEffect, useState } from "react";
import { Button, Input } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
} from "@ant-design/icons";
import type { RelationGraphEdge, RelationGraphNode } from "@/shared/novel/relation-graph";
import "./index.scss";

/** 备注上限：与主窗口要素卡的关系备注同口径（W-13 / RG-I-48） */
export const EDGE_NOTE_MAX = 200;

export interface EdgeDetailCardProps {
  edge: RelationGraphEdge;
  nodeById: ReadonlyMap<string, RelationGraphNode>;
  typeLabelOf: (type: string) => string;
  /** 保存某一条关系的备注；返回 false 表示没写进去（卡片保留编辑态） */
  onSaveNote: (linkId: string, note: string) => Promise<boolean>;
  /** 去右栏删除：把主窗口抬起来并打开该要素的资料卡 */
  onOpenInMain: (entityId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
  saving: boolean;
}

export default function EdgeDetailCard({
  edge,
  nodeById,
  typeLabelOf,
  onSaveNote,
  onOpenInMain,
  onSelectNode,
  onClose,
  saving,
}: EdgeDetailCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // 换一条边 / 换一端节点时退出编辑态：否则「刚输入的备注」会被写进另一行
  useEffect(() => {
    setEditingId(null);
    setDraft("");
  }, [edge.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (editingId) {
          setEditingId(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingId, onClose]);

  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);

  const startEdit = (linkId: string, note: string | undefined) => {
    setEditingId(linkId);
    setDraft(note ?? "");
  };

  const save = async () => {
    if (!editingId) return;
    const ok = await onSaveNote(editingId, draft);
    if (ok) {
      setEditingId(null);
      setDraft("");
    }
  };

  return (
    <aside className="rel-edge" aria-label="关系详情">
      {/* ── 标题区 ── */}
      <header className="rel-edge__head">
        <span className="rel-edge__badge">关系</span>
        <h2 className="rel-edge__title" title={edge.label}>
          {edge.label}
        </h2>
        <Button
          type="text"
          size="small"
          className="rel-edge__close"
          aria-label="关闭关系详情"
          icon={<CloseOutlined />}
          onClick={onClose}
        />
      </header>

      <div className="rel-edge__body">
        {/* ── 关系列表：先两端、再逐条关系 ── */}
        <section className="rel-edge__section rel-edge__section--links">
          <span className="rel-edge__section-title">
            这条连线上的关系 <b>{edge.relations.length}</b>
          </span>

          <div className="rel-edge__pair">
            <Button
              type="text"
              className="rel-edge__endpoint"
              onClick={() => onSelectNode(edge.source)}
              title={source?.name ?? "（已删除的要素）"}
            >
              <ArrowRightOutlined className="rel-edge__dir" />
              <span className="rel-edge__name">{source?.name ?? "（已删除的要素）"}</span>
              <span className="rel-edge__type">
                {source ? typeLabelOf(source.type) : "—"}
              </span>
            </Button>
            <span className="rel-edge__between" aria-hidden>
              ————
            </span>
            <Button
              type="text"
              className="rel-edge__endpoint"
              onClick={() => onSelectNode(edge.target)}
              title={target?.name ?? "（已删除的要素）"}
            >
              <ArrowLeftOutlined className="rel-edge__dir" />
              <span className="rel-edge__name">{target?.name ?? "（已删除的要素）"}</span>
              <span className="rel-edge__type">
                {target ? typeLabelOf(target.type) : "—"}
              </span>
            </Button>
          </div>

          <ul className="rel-edge__list">
            {edge.relations.map((relation, index) => {
              const linkId = edge.linkIds[index];
              const note = edge.notes[index];
              const editing = editingId === linkId;
              return (
                <li
                  key={linkId ?? `${edge.id}:${index}`}
                  className={`rel-edge__row${editing ? " rel-edge__row--editing" : ""}`}
                >
                  <div className="rel-edge__row-head">
                    <span className="rel-edge__relation">{relation}</span>
                    {!editing && (
                      <Button
                        type="text"
                        size="small"
                        className="rel-edge__action"
                        icon={<EditOutlined />}
                        aria-label={`编辑「${relation}」的备注`}
                        onClick={() => startEdit(linkId, note)}
                        disabled={!linkId}
                      >
                        备注
                      </Button>
                    )}
                  </div>

                  {editing ? (
                    /* ── 备注编辑区：独立槽，编辑态一眼可与相邻行切开 ── */
                    <div className="rel-edge__editor">
                      <Input.TextArea
                        value={draft}
                        autoFocus
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        maxLength={EDGE_NOTE_MAX}
                        showCount
                        className="rel-edge__editor-area"
                        classNames={{ count: "rel-edge__count" }}
                        placeholder="例如：在第 12 章决裂，之前一直是同门"
                        aria-label="关系备注"
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <div className="rel-edge__editor-actions">
                        <Button
                          size="small"
                          autoInsertSpace={false}
                          onClick={() => setEditingId(null)}
                        >
                          取消
                        </Button>
                        <Button size="small" type="primary" loading={saving} onClick={() => void save()}>
                          保存备注
                        </Button>
                      </div>
                    </div>
                  ) : note ? (
                    <p className="rel-edge__note">{note}</p>
                  ) : (
                    <p className="rel-edge__note rel-edge__note--empty">还没有备注</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── 删除区 ── */}
        <section className="rel-edge__section rel-edge__section--delete">
          <span className="rel-edge__section-title">删除</span>
          <p className="rel-edge__hint">
            图的连线是「派生」出来的：删掉关系，线才会消失。删除动作在主窗口的要素资料卡里完成。
          </p>
          <Button
            size="small"
            className="rel-edge__goto"
            icon={<DeleteOutlined />}
            onClick={() => onOpenInMain(edge.source)}
          >
            去右栏删除
          </Button>
        </section>
      </div>

      <footer className="rel-edge__foot">
        这里只改备注；关系名与删除仍在主窗口右栏（图上不提供不可逆操作）。
      </footer>
    </aside>
  );
}
