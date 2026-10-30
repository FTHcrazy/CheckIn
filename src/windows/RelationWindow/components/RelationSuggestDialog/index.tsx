/**
 * 「从正文推断关系」弹层（R-AI-15）
 *
 * 交互模型与抽取设定一致：**先看再选**。模型读完一章给出候选边（两端 + 关系名 +
 * 置信度 + 出处句），作者勾选后点「写入关系图」，才走 `novel-graph-commit`
 * 单事务写进 `novel_links` 并广播 `novel-links-changed`。
 *
 * 为什么不做「一键全收」：误判关系（把仇人判成恋人）会直接画在图上给作者难堪，
 * 而少一条边只是回去再点一次 —— 这个不对称决定了必须逐条确认（PRD 风险表）。
 *
 * 低置信候选**默认不勾**（`selected` 由 `buildRelationCandidates` 决定），
 * 但行仍列出：作者可能正想确认那条拿不准的关系。
 */
import { Button, Modal, Select } from "antd";
import { ApartmentOutlined, ReloadOutlined } from "@ant-design/icons";
import AiCandidateList, { type AiCandidateItem } from "@/shared/components/AiCandidateList";
import { RELATION_CONFIDENCE_LABELS } from "@/shared/novel/relation-suggest";
import type { RelationSuggestSession, SuggestChapter } from "../../hooks/useRelationSuggest";
import "./index.scss";

export interface RelationSuggestDialogProps {
  open: boolean;
  /** 本书章节（正文已随 `editorLoad(true)` 取回） */
  chapters: SuggestChapter[];
  chaptersLoading: boolean;
  chapterId: string | null;
  onChapterChange: (id: string) => void;
  /** 本次会话；null = 还没点过「从正文推断」 */
  session: RelationSuggestSession | null;
  onSubmit: () => void;
  onToggle: (key: string) => void;
  onApply: () => void;
  /** 收起重来（清会话） */
  onReset: () => void;
  onClose: () => void;
  /** 真正会写入的条数（低置信未勾 / 已存在都不算） */
  pickedCount: number;
  /** AI 不可用的一句话说明；非空时按钮禁用 */
  unavailableText?: string;
  /** 正在提交（写入中按钮不可重按） */
  submitting?: boolean;
}

/** 候选行 → 共用列表条目（两种面板同一行结构） */
function toItems(session: RelationSuggestSession | null): AiCandidateItem[] {
  return (session?.candidates ?? []).map((item) => ({
    key: item.key,
    title: `${item.fromName} → ${item.toName}`,
    subtitle: `关系：${item.relation}`,
    evidence: item.evidence ? `「${item.evidence}」` : undefined,
    tag: RELATION_CONFIDENCE_LABELS[item.confidence],
    tagTone: item.confidence === "high" ? "success" : item.confidence === "low" ? "warning" : "muted",
    checked: item.selected,
  }));
}

export default function RelationSuggestDialog({
  open,
  chapters,
  chaptersLoading,
  chapterId,
  onChapterChange,
  session,
  onSubmit,
  onToggle,
  onApply,
  onReset,
  onClose,
  pickedCount,
  unavailableText,
  submitting = false,
}: RelationSuggestDialogProps) {
  const loading = session?.loading ?? false;

  const chapterOptions = chapters.map((item) => ({ label: item.title, value: item.id }));

  const runLabel = loading ? "推断中…" : session ? "重新推断" : "从正文推断关系";

  const dropped = session?.dropped;

  return (
    <Modal
      open={open}
      title="从正文推断关系"
      className="rel-sg-modal"
      width={540}
      centered
      zIndex={1250}
      onCancel={onClose}
      footer={null}
    >
      <div className="rel-sg">
        <div className="rel-sg__source">
          <span className="rel-sg__label">来源章节</span>
          <Select
            className="rel-sg__select"
            size="small"
            disabled={loading || chaptersLoading || chapters.length === 0}
            value={chapterId ?? undefined}
            options={chapterOptions}
            placeholder={chaptersLoading ? "读取章节正文…" : "选择章节"}
            aria-label="关系推断来源章节"
            popupMatchSelectWidth={false}
            onChange={onChapterChange}
          />
        </div>

        <div className="rel-sg__actions">
          <Button
            className="rel-sg__run"
            icon={loading ? <ReloadOutlined spin /> : <ApartmentOutlined />}
            disabled={loading || chapters.length === 0 || Boolean(unavailableText)}
            title={unavailableText || undefined}
            onClick={onSubmit}
          >
            {runLabel}
          </Button>
          {session && !loading && (
            <Button onClick={onReset}>收起重来</Button>
          )}
        </div>

        <p className="rel-sg__hint">
          {unavailableText ??
            "整章正文会发给你配置的模型服务；推断出的关系要你勾选后才画进关系图，低置信默认不勾。"}
        </p>

        {session?.usedFallback && !loading && (
          <p className="rel-sg__hint rel-sg__hint--warn">
            模型这次没给标准 JSON，已按文本兜底解析，条目可能不全
          </p>
        )}

        {session && session.applied !== null && !loading && (
          <p className="rel-sg__hint rel-sg__hint--ok">
            已写入 {session.applied} 条关系，画布与主窗口右栏都已同步
          </p>
        )}

        <div className="rel-sg__list">
          {loading ? (
            <div className="rel-sg__empty">
              <b>正在推断</b>
              <span>读「{session?.chapterTitle}」，读完把候选关系列在这里</span>
            </div>
          ) : !session ? (
            <div className="rel-sg__empty">
              <b>尚未推断</b>
              <span>选好来源章节后点「从正文推断关系」，结果不会自动画进图</span>
            </div>
          ) : session.error ? (
            <div className="rel-sg__empty">
              <b>推断没有完成</b>
              <span>{session.error}</span>
            </div>
          ) : session.candidates.length === 0 ? (
            <div className="rel-sg__empty">
              <b>{session.applied !== null ? `已写入 ${session.applied} 条` : "没有可写入的关系"}</b>
              <span>
                {session.applied !== null
                  ? "本次候选已处理完，可以换一章继续推断"
                  : `「${session.chapterTitle}」里读不出新的关系`}
              </span>
            </div>
          ) : (
            <AiCandidateList items={toItems(session)} onToggle={onToggle} toggleVerb="写入" />
          )}
        </div>

        {/* 丢弃统计如实摆出来：模型给了 8 条只进来 3 条时，作者必须知道差在哪 */}
        {!loading && dropped && dropped.unknown > 0 && (
          <p className="rel-sg__hint rel-sg__hint--muted">
            另有 {dropped.unknown} 条提到的人物还没建卡，去工具箱「抽取设定」建好再试
          </p>
        )}

        {session && !loading && session.candidates.length > 0 && (
          <div className="rel-sg__foot">
            <span className="rel-sg__count">勾选 {pickedCount} 条</span>
            <Button
              type="primary"
              disabled={pickedCount === 0 || submitting}
              loading={submitting}
              onClick={onApply}
            >
              写入关系图
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
