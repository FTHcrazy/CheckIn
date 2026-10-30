/**
 * 等级体系 AI 生成 / 拓展弹窗（R-AI-18）
 *
 * 两个形态（设定中心 / 全局设定中心）共用这一个弹窗 —— 外壳是 Modal，
 * 挂在 body portal 上，所以样式作用域自包含（`.ai-lvl`），不依赖父级类名。
 *
 * 交互取舍：
 * - **模式只有两档**：整理整套（空阶梯的场景）/ 拓展后续（接着末端往下）。
 *   不提供「覆盖现有」—— 等级行被角色卡与行囊按名字引用，覆盖会让引用悬空。
 * - **候选不自动入库**：`onRun` 只产候选，`onApply` 才写；与实体抽取、关系建议
 *   同一纪律（PRD 判据②）。
 * - **勾选默认全开**：AI 给的是一套体系，逐条取消比逐条勾选顺手；重名的禁勾。
 */
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Segmented } from "antd";
import AiCandidateList, {
  type AiCandidateItem,
} from "@/shared/components/AiCandidateList";
import type { LevelGenMode } from "@/shared/novel/level-gen";
import type { LevelGenSession } from "../../hooks/useAiLevelGen";
import "./index.scss";

export interface AiLevelGenModalProps {
  open: boolean;
  /** 目标分类名（标题里说清「给哪套体系排」） */
  categoryName: string;
  session: LevelGenSession | null;
  mode: LevelGenMode;
  onModeChange: (mode: LevelGenMode) => void;
  countText: string;
  onCountChange: (value: string) => void;
  /** 夹取后的条数（按钮文案用同一个数） */
  count: number;
  pickedCount: number;
  /** 非空 = 「整理整套」不可用（说明原因） */
  generateBlockedReason: string | null;
  /** AI 不可用的一句话说明（面板里如实说，而不是让按钮无声失效） */
  unavailableText: string | null;
  onRun: () => void;
  onToggle: (key: string) => void;
  onApply: () => void;
  onClose: () => void;
}

export default function AiLevelGenModal({
  open,
  categoryName,
  session,
  mode,
  onModeChange,
  countText,
  onCountChange,
  count,
  pickedCount,
  generateBlockedReason,
  unavailableText,
  onRun,
  onToggle,
  onApply,
  onClose,
}: AiLevelGenModalProps) {
  const loading = session?.loading ?? false;
  const applied = session?.applied ?? null;
  const candidates = session?.candidates ?? [];

  const items: AiCandidateItem[] = candidates.map((item) => ({
    key: item.key,
    title: `${item.sequence}. ${item.name}`,
    tag: item.duplicate ? "已有" : undefined,
    tagTone: "muted",
    subtitle: item.note || undefined,
    checked: item.selected,
    disabled: item.duplicate,
  }));

  return (
    <Modal
      className="ai-lvl"
      open={open}
      title={categoryName ? `AI 排阶梯 · ${categoryName}` : "AI 排阶梯"}
      width={560}
      onCancel={onClose}
      footer={
        <div className="ai-lvl__footer">
          <span className="ai-lvl__count">
            {pickedCount > 0 ? `已选 ${pickedCount} 级` : "还没勾选"}
          </span>
          <span className="ai-lvl__spacer" />
          <Button size="small" onClick={onClose}>
            关闭
          </Button>
          <Button
            size="small"
            type="primary"
            className="ai-lvl__apply"
            disabled={pickedCount === 0 || loading}
            onClick={onApply}
          >
            加入阶梯
          </Button>
        </div>
      }
    >
      <div className="ai-lvl__body">
        <Segmented
          value={mode}
          aria-label="生成方式"
          options={[
            {
              value: "generate",
              label: "整理整套",
              // desc 阶梯已有等级时整套生成会语义错位（顶点落到末尾），禁掉而不是说谎
              disabled: generateBlockedReason !== null,
            },
            { value: "extend", label: "拓展后续" },
          ]}
          onChange={(value) => onModeChange(value as LevelGenMode)}
        />

        <div className="ai-lvl__row">
          <label className="ai-lvl__field">
            <span>条数</span>
            <Input
              size="small"
              value={countText}
              inputMode="numeric"
              aria-label="生成条数"
              className="ai-lvl__input"
              onChange={(event) => onCountChange(event.target.value)}
            />
          </label>
          <span className="ai-lvl__spacer" />
          <Button
            size="small"
            className="ai-lvl__run"
            icon={loading ? <ReloadOutlined /> : <ThunderboltOutlined />}
            disabled={loading || unavailableText !== null}
            onClick={onRun}
          >
            {loading ? "生成中…" : candidates.length > 0 ? "再生成一批" : "生成候选"}
          </Button>
        </div>

        {generateBlockedReason && (
          <p className="ai-lvl__hint is-warn">{generateBlockedReason}</p>
        )}
        {unavailableText && <p className="ai-lvl__hint is-warn">{unavailableText}</p>}

        {session?.error && <p className="ai-lvl__hint is-error">{session.error}</p>}
        {session?.usedFallback && !loading && (
          <p className="ai-lvl__hint">
            模型这次没给标准 JSON，已按文本兜底解析，条目可能不全
          </p>
        )}
        {applied !== null && !loading && (
          <p className="ai-lvl__hint is-ok">
            已加入 {applied} 级。要继续往上排，点「再生成一批」。
          </p>
        )}

        {loading ? (
          <p className="ai-lvl__empty">正在按「{categoryName}」推演阶梯…</p>
        ) : items.length > 0 ? (
          <div className="ai-lvl__list">
            <AiCandidateList items={items} onToggle={onToggle} toggleVerb="加入" />
          </div>
        ) : (
          <p className="ai-lvl__empty">
            {session
              ? "这次没有可用候选，换一种方式或改改分类名再试"
              : `选好方式和条数，点「生成候选」。候选不会自动入库 —— 勾选后点「加入阶梯」，按当前阶梯顺序追加到末尾（共 ${count} 级）。`}
          </p>
        )}

        <p className="ai-lvl__tip">
          只发送分类名、说明与现有阶梯名，<b>不发送正文</b>；顺序即阶梯序，
          加完可在阶梯里拖动手柄调整。新阶会继承分类的「每阶小层数」与小层命名。
        </p>
      </div>
    </Modal>
  );
}
