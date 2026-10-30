import { Button, Select } from "antd";
import { ReloadOutlined, SnippetsOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import AiCandidateList, { type AiCandidateItem } from "@/shared/components/AiCandidateList";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import type { ExtractSession } from "../../utils/entity-extract";
import type { EntityType, NovelChapter } from "../../types";
import "./index.scss";

interface ExtractPanelProps {
  /** 当前编辑章：抽取来源的默认值（跟随编辑器，作者不必再找一遍） */
  chapterId: string | null;
  /** 全书章节：抽取来源可改选，方便在写第 3 章时补第 1 章的设定 */
  chapters: NovelChapter[];
  /** 本次抽取会话；null = 还没有点过「抽取」 */
  session: ExtractSession | null;
  /** 发起一次抽取（内部会走 L3 授权 / 二次确认） */
  onRun: (chapterId: string, force?: boolean) => void;
  /** 勾选 / 取消勾选一条候选 */
  onToggle: (key: string) => void;
  /** 改一条候选的类型 */
  onTypeChange: (key: string, type: EntityType) => void;
  /** 确认把「勾选且不重名」的候选批量建卡 */
  onConfirm: () => void;
  /** 关闭面板（清掉本次会话） */
  onClose: () => void;
  onNotify: (text: string, tone?: ToastTone) => void;
  /** AI 不可用的一句话说明；非空时按钮禁用 */
  unavailableText?: string;
}

/**
 * 抽取动作组（与 `NamingActions` / `InspirationActions` 同一约定）。
 *
 * 收成一个对象由 `SupportPanel` 透传，而不是在面板 props 上摊开六项：
 * 右栏容器的 props 已经三十多个，再摊六项会让「这个 Tab 依赖哪一组回调」
 * 彻底看不出来。
 */
export interface ExtractActions {
  session: ExtractSession | null;
  /** `force = true` 跳过二次确认（同一章「重新抽取」用，见 `handleRun`） */
  onRun: (chapterId: string, force?: boolean) => void;
  onToggle: (key: string) => void;
  onTypeChange: (key: string, type: EntityType) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * 抽取设定面板（工具箱二级面板，R-AI-08）
 *
 * 交互模型是「**先看再选**」：模型产出的候选一律不落库，作者勾选、可改类型，
 * 点「建卡并入库」才写进要素库（PRD 判据②：不存在自动入库的分支）。
 *
 * 已存在同名卡的条目**禁用勾选**并标「已存在」：覆盖作者手写的简介是不可逆
 * 的损失，而补一句简介只要点开卡片改一次——这个不对称决定了宁可少建。
 *
 * 会话状态由 `useNovelPage` 持有（`session` prop），面板只负责呈现与回传：
 * 切走再切回，候选与已建张数都还在。
 */
export default function ExtractPanel({
  chapterId,
  chapters,
  session,
  onRun,
  onToggle,
  onTypeChange,
  onConfirm,
  onClose,
  onNotify,
  unavailableText,
}: ExtractPanelProps) {
  const { metaOf, filterOrder } = useEntityTypeMeta();

  /** 抽取来源：默认当前编辑章，作者可改选（不写进 store，纯面板 UI 状态） */
  const [sourceId, setSourceId] = useState<string | null>(chapterId);

  // 切章后来源跟着走：作者的注意力已在新的这一章上
  useEffect(() => {
    if (chapterId) setSourceId(chapterId);
  }, [chapterId]);

  const loading = session?.loading ?? false;

  const chapterOptions = useMemo(
    () => chapters.map((item) => ({ label: item.title, value: item.id })),
    [chapters],
  );

  const typeOptions = useMemo(
    () => filterOrder.map((type) => ({ label: metaOf(type).label, value: type })),
    [filterOrder, metaOf],
  );

  /** 真正会入库的条数（重名的一律不算，即便被勾上） */
  const picked = useMemo(
    () => session?.candidates.filter((item) => item.selected && !item.existingId).length ?? 0,
    [session],
  );
  const duplicateCount = useMemo(
    () => session?.candidates.filter((item) => item.existingId !== null).length ?? 0,
    [session],
  );

  /**
   * 候选行 → 共用列表的条目。
   *
   * 重名的行把类型下拉换成「已存在」标签：那种行不该让作者改类型（改了也没用，
   * 不会入库），留着下拉只会让人以为「改个类型就能覆盖」。
   */
  const items = useMemo<AiCandidateItem[]>(
    () =>
      (session?.candidates ?? []).map((item) => ({
        key: item.key,
        title: item.name,
        accessory: item.existingId ? undefined : (
          <Select
            className="nv-xp__type"
            size="small"
            value={item.type}
            options={typeOptions}
            aria-label={`${item.name} 的类型`}
            popupMatchSelectWidth={false}
            onChange={(value: EntityType) => onTypeChange(item.key, value)}
          />
        ),
        tag: item.existingId ? "已存在" : undefined,
        subtitle: item.summary || undefined,
        evidence: item.evidence ? `「${item.evidence}」` : undefined,
        checked: item.selected,
        disabled: item.existingId !== null,
      })),
    [session, typeOptions, onTypeChange],
  );

  const handleRun = useCallback((): void => {
    if (unavailableText) {
      onNotify(unavailableText, "warning");
      return;
    }
    if (!sourceId) {
      onNotify("先在左侧打开一章，再抽取设定", "info");
      return;
    }
    /**
     * 同一章已经有结果时再点，是「我要再抽一次」的明确表示：
     * 二次确认（「从这一章抽取设定？」）只有在还没有结果时才需要。
     * 换了来源章节则照常确认 —— 那一章还没有人点过同意。
     */
    const force = session !== null && session.chapterId === sourceId;
    onRun(sourceId, force);
  }, [unavailableText, sourceId, session, onRun, onNotify]);

  const runLabel = loading
    ? "抽取中…"
    : session
      ? "重新抽取"
      : "抽取本章设定";

  return (
    <div className="nv-xp">
      <div className="nv-xp__source">
        <span className="nv-xp__label">抽取来源</span>
        <Select
          className="nv-xp__select"
          size="small"
          disabled={loading || chapters.length === 0}
          value={sourceId ?? undefined}
          options={chapterOptions}
          placeholder={chapters.length === 0 ? "这本书还没有章节" : "选择章节"}
          aria-label="抽取来源章节"
          popupMatchSelectWidth={false}
          onChange={setSourceId}
        />
      </div>

      <div className="nv-xp__actions">
        <Button
          className="nv-ghost"
          icon={loading ? <ReloadOutlined spin /> : <SnippetsOutlined />}
          disabled={loading || chapters.length === 0}
          title={unavailableText || undefined}
          onClick={handleRun}
        >
          {runLabel}
        </Button>
        {session && !loading && (
          <Button className="nv-ghost" onClick={onClose}>
            收起重来
          </Button>
        )}
      </div>

      <p className="nv-xp__hint">
        {unavailableText ??
          "把整章正文发给模型，抽出的设定要你勾选后才建卡；已建过的不会重复建。"}
      </p>

      {session?.usedFallback && !loading && (
        <p className="nv-xp__hint nv-xp__hint--warn">
          模型这次没给标准 JSON，已按文本兜底解析，条目可能不全
        </p>
      )}

      {session && session.applied !== null && !loading && (
        <p className="nv-xp__hint nv-xp__hint--ok">
          已建 {session.applied} 张卡，切到「要素」Tab 即可看到
        </p>
      )}

      <div className="nv-xp__list">
        {loading ? (
          <div className="nv-empty">
            <b>正在抽取</b>
            <span>读「{session?.chapterTitle}」，抽完列在这里供你勾选</span>
          </div>
        ) : !session ? (
          <div className="nv-empty">
            <b>尚未抽取</b>
            <span>选好来源章节后点「抽取本章设定」，结果不会自动入库</span>
          </div>
        ) : session.error ? (
          <div className="nv-empty">
            <b>抽取没有完成</b>
            <span>{session.error}</span>
          </div>
        ) : session.candidates.length === 0 ? (
          <div className="nv-empty">
            <b>{session.applied !== null ? `已建 ${session.applied} 张卡` : "没有可建卡的条目"}</b>
            <span>
              {session.applied !== null
                ? "本次候选已处理完，可以换一章继续抽"
                : `「${session.chapterTitle}」里抽到的都已建过卡，或名字无法辨认`}
            </span>
          </div>
        ) : (
          <AiCandidateList items={items} onToggle={onToggle} />
        )}
      </div>

      {session && !loading && session.candidates.length > 0 && (
        <div className="nv-xp__foot">
          <span className="nv-xp__count">
            勾选 {picked} 条
            {duplicateCount > 0 ? ` · ${duplicateCount} 条已存在` : ""}
          </span>
          <Button
            className="nv-xp__confirm"
            type="primary"
            disabled={picked === 0}
            onClick={onConfirm}
          >
            建卡并入库
          </Button>
        </div>
      )}
    </div>
  );
}
