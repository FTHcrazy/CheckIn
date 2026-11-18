import { Alert, Button, Drawer, Empty, Tag, Typography } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { INTERVIEW_LIMITS, type AuditSeverity } from "@/shared/ai/context/prompt";
import type { InterviewQuestion } from "../../data/interview-types";
import type { AuditIssue } from "../../hooks/useInterviewAudit";
import { AUDIT_SEVERITY_SHORT } from "../../hooks/useInterviewAudit";
import "./index.scss";

const { Text } = Typography;

/** 严重程度 → 徽标样式类（配色在 scss 里按语义分配，不在组件里写色值） */
const SEVERITY_CLASS: Record<AuditSeverity, string> = {
  high: "is-high",
  medium: "is-medium",
  low: "is-low",
};

interface AuditDrawerProps {
  open: boolean;
  /** 送检范围：当前筛选下的题目（超上限由 hook 截断） */
  pool: readonly InterviewQuestion[];
  /** 题目 id → 题目；查不到（刚被删）时不显示「去改」 */
  questionOf: (id: string) => InterviewQuestion | undefined;
  /** AI 可用性（M8 口径：整块隐藏 / 禁用并说明原因） */
  available: boolean;
  unavailableText: string;
  running: boolean;
  error: string | null;
  issues: readonly AuditIssue[];
  usedFallback: boolean;
  /** 上次送检的题数；0 = 还没跑过 */
  auditedCount: number;
  onRun: () => void;
  onDiscard: (id: string) => void;
  onEdit: (question: InterviewQuestion) => void;
  onClose: () => void;
}

/**
 * 题目质检面板。
 *
 * 【它回答的问题】
 * 「我背的这些题，答案本身对吗？」——分类、难度、完整性、与已有题重复，
 * 一次批量核对（上限 20 道，再多模型会开始复制粘贴上一条的建议）。
 *
 * 【为什么只给建议、不给一键修复】
 * 质检的价值在于**让人看一眼**：模型说「答案漏了内存屏障」时，用户要判断
 * 这句对不对，而不是让 AI 直接改掉他背过的答案。所以每条结论只有
 * 「去改」（打开已有的编辑抽屉）与「忽略」两个动作，库里一个字都不会被动。
 */
export default function AuditDrawer({
  open,
  pool,
  questionOf,
  available,
  unavailableText,
  running,
  error,
  issues,
  usedFallback,
  auditedCount,
  onRun,
  onDiscard,
  onEdit,
  onClose,
}: AuditDrawerProps) {
  /** 送检范围（与 hook 的截断口径同一个上限常量） */
  const batchSize = Math.min(pool.length, INTERVIEW_LIMITS.auditTargets);

  return (
    <Drawer
      className="interview-audit"
      title={`题目质检${issues.length > 0 ? ` · ${issues.length}` : ""}`}
      size="large"
      open={open}
      onClose={onClose}
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
    >
      <Text type="secondary" className="interview-audit__hint">
        把当前筛选下的题目送上去逐条核对：答案对不对、关键点有没有漏、分类与难度是否匹配、
        是否与已有题目重复。质检**不会改动题库**，每条结论点「去改」才会打开该题的编辑。
      </Text>

      <div className="interview-audit__bar">
        <span className="interview-audit__scope">
          送检范围：当前筛选下前 <b>{batchSize}</b> 道（上限 {INTERVIEW_LIMITS.auditTargets} 道）
          {auditedCount > 0 ? ` · 上次检查了 ${auditedCount} 道` : ""}
        </span>
        <Button
          className="interview-audit__run"
          type="primary"
          icon={<SafetyCertificateOutlined />}
          loading={running}
          disabled={!available || batchSize === 0}
          title={unavailableText || (batchSize === 0 ? "当前筛选下没有题目" : "开始质检")}
          onClick={onRun}
        >
          {issues.length > 0 || auditedCount > 0 ? "重新质检" : "开始质检"}
        </Button>
      </div>

      {!available && unavailableText ? (
        <Alert
          className="interview-audit__notice"
          type="info"
          showIcon
          message={unavailableText}
        />
      ) : null}

      {error ? (
        <Alert className="interview-audit__error" type="error" showIcon message={error} />
      ) : null}

      {usedFallback ? (
        <Alert
          className="interview-audit__notice"
          type="warning"
          showIcon
          message="模型这次输出的 JSON 不完整，已按文本尽力解析，条目可能不全"
        />
      ) : null}

      {issues.length === 0 ? (
        <Empty
          className="interview-audit__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            auditedCount > 0
              ? `这 ${auditedCount} 道题没有发现明显问题`
              : "还没有质检过。选好范围后点「开始质检」。"
          }
        />
      ) : (
        <ul className="interview-audit__list">
          {issues.map((issue) => {
            const question = questionOf(issue.id);
            return (
              <li className="interview-audit__item" key={issue.id}>
                <div className="interview-audit__head">
                  <Tag className={`interview-audit__severity ${SEVERITY_CLASS[issue.severity]}`}>
                    {AUDIT_SEVERITY_SHORT[issue.severity]}
                  </Tag>
                  <span className="interview-audit__title">
                    {question?.title ?? issue.id}
                  </span>
                </div>
                {issue.issues.length > 0 ? (
                  <ul className="interview-audit__points">
                    {issue.issues.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                ) : null}
                {issue.suggestion ? (
                  <p className="interview-audit__suggestion">建议：{issue.suggestion}</p>
                ) : null}
                <div className="interview-audit__ops">
                  {question ? (
                    <Button
                      className="interview-audit__edit"
                      type="link"
                      size="small"
                      onClick={() => onEdit(question)}
                    >
                      去改
                    </Button>
                  ) : null}
                  <Button
                    className="interview-audit__discard"
                    type="link"
                    size="small"
                    onClick={() => onDiscard(issue.id)}
                  >
                    忽略
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
