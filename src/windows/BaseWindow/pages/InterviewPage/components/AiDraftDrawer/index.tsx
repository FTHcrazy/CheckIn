import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Drawer, Empty, Form, Input, Select, Tag, Typography } from "antd";
import { BulbOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { DRAFT_DIFFICULTY_LABELS } from "@/shared/ai/context/prompt";
import type { InterviewKind } from "@/shared/interview/payload-shape";
import { DIFFICULTY_LABEL, TRACKS, TRACK_LABEL, type CategoryNode } from "../../data/interview-taxonomy";
import type { Difficulty } from "../../data/interview-types";
import type { DraftCandidate, UseInterviewAiResult } from "../../hooks/useInterviewAi";
import "./index.scss";

const { Text } = Typography;

/** 三种产物的中文名（按钮与标题共用，别让用户对着 `diagram` 猜） */
const KIND_LABEL: Record<InterviewKind, string> = {
  question: "出题",
  glossary: "出词条",
  diagram: "出图解",
};

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as InterviewKind[]).map((value) => ({
  label: KIND_LABEL[value],
  value,
}));

const DIAGRAM_KIND_OPTIONS = [
  { label: "流程图（节点顺序）", value: "flow" },
  { label: "时序图（先后发生）", value: "timeline" },
  { label: "对照图（左右两栏）", value: "compare" },
  { label: "分层图（自下而上）", value: "layers" },
] as const;

interface DraftFormValues {
  kind: InterviewKind;
  categoryId: string;
  difficulty: Difficulty;
  diagramKind: "flow" | "timeline" | "compare" | "layers";
  count: number;
  seed?: string;
}

export interface AiDraftPrefill {
  kind: InterviewKind;
  categoryId?: string;
  seed?: string;
  /** 打开即生成（划词「加为词条」用：用户点的就是「补全这个词」） */
  autoRun?: boolean;
}

interface AiDraftDrawerProps {
  open: boolean;
  prefill: AiDraftPrefill;
  categories: readonly CategoryNode[];
  ai: UseInterviewAiResult;
  onClose: () => void;
}

/**
 * AI 拓展抽屉：出题 / 出词条 / 出图解。
 *
 * 三步走：选参数 → 生成候选 → 逐条采纳。**没有「一键全采」**：
 * 模型偶尔会出「听起来对但答案是错的」内容，题库是复习资料，
 * 批量采纳等于把审核成本整体推给未来的自己。
 *
 * 分类下拉来自**合并后的分类表**（22 基线 + `u-c-*` 自定义分类）：
 * AI 造的题只能落在这张封闭词表里，落点不合法就没有下次升级的保护。
 */
export default function AiDraftDrawer({
  open,
  prefill,
  categories,
  ai,
  onClose,
}: AiDraftDrawerProps): ReactNode {
  const [form] = Form.useForm<DraftFormValues>();
  const [running, setRunning] = useState(false);

  const categoryOptions = useMemo(
    () =>
      TRACKS.map((track) => ({
        label: TRACK_LABEL[track.id],
        options: categories
          .filter((node) => node.track === track.id)
          .map((node) => ({ label: node.label, value: node.id })),
      })).filter((group) => group.options.length > 0),
    [categories],
  );

  const difficultyOptions = useMemo(
    () =>
      (Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((value) => ({
        label: DIFFICULTY_LABEL[value],
        value,
      })),
    [],
  );

  // 每次打开按 prefill 重填：抽屉不销毁，残留上一次的参数会让人以为选错了分类
  useEffect(() => {
    if (!open) return;
    ai.reset();
    form.setFieldsValue({
      kind: prefill.kind,
      categoryId: prefill.categoryId ?? categories[0]?.id ?? "",
      difficulty: "medium",
      diagramKind: "flow",
      count: 3,
      seed: prefill.seed ?? "",
    });
    // `ai.reset` 是稳定引用；把 ai 整个塞进依赖会每次渲染都重填表单
  }, [open, prefill.kind, prefill.categoryId, prefill.seed, form, categories]);

  const run = async (values: DraftFormValues): Promise<void> => {
    setRunning(true);
    const category = categories.find((node) => node.id === values.categoryId);
    await ai.generate({
      kind: values.kind,
      categoryId: values.categoryId,
      track: category?.track ?? "foundation",
      difficulty: values.difficulty,
      diagramKind: values.diagramKind,
      count: values.count,
      seed: values.seed,
    });
    setRunning(false);
  };

  const submit = (): void => {
    void form.validateFields().then((values) => run(values));
  };

  /**
   * 划词「加为词条」进来时直接生成：用户点的就是「帮我把这个词补全」，
   * 再让他按一次「生成候选」纯属多余的一步。
   */
  useEffect(() => {
    if (!open || !prefill.autoRun || !prefill.seed) return;
    const timer = window.setTimeout(() => {
      void form
        .validateFields()
        .then((values) => run(values))
        .catch(() => undefined);
    }, 60);
    return () => window.clearTimeout(timer);
    // run / form 引用稳定，真正的触发条件是「这次打开带着种子」
  }, [open, prefill.autoRun, prefill.seed]);

  return (
    <Drawer
      className="interview-aidraft"
      title="AI 拓展题库"
      size="large"
      open={open}
      onClose={onClose}
      // 与其余抽屉同一处理：整体下移 34px，避免 × 落进窗口标题栏的拖动带
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
      forceRender
      footer={
        <div className="interview-aidraft__footer">
          <Button className="interview-aidraft__cancel" onClick={onClose}>
            关闭
          </Button>
          <Button
            className="interview-aidraft__run"
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={running || ai.generating}
            onClick={submit}
          >
            生成候选
          </Button>
        </div>
      }
    >
      <Text type="secondary" className="interview-aidraft__hint">
        AI 只产出候选，逐条采纳后才进题库。生成的题落在你选的分类下，之后照常可以编辑、隐藏、导出。
      </Text>

      {!ai.available ? (
        <Alert
          className="interview-aidraft__offline"
          type="warning"
          showIcon
          message="AI 当前不可用"
          description={ai.unavailableText || "请先在设置里开启并补齐模型配置"}
        />
      ) : null}

      <Form<DraftFormValues>
        className="interview-aidraft__form"
        form={form}
        layout="vertical"
        onFinish={() => submit()}
      >
        <div className="interview-aidraft__row">
          <Form.Item name="kind" label="产出类型" className="interview-aidraft__row-side">
            <Select options={KIND_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="categoryId"
            label="落在哪个分类"
            className="interview-aidraft__row-main"
            rules={[{ required: true, message: "请选择分类" }]}
          >
            <Select
              options={categoryOptions}
              showSearch
              optionFilterProp="label"
              placeholder="选择分类"
            />
          </Form.Item>
        </div>

        {/* 难度与图型与类型联动：出图/出词时不需要难度，出题时不需要图型 */}
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.kind !== next.kind}>
          {({ getFieldValue }) => {
            const kind = getFieldValue("kind") as InterviewKind;
            if (kind === "diagram") {
              return (
                <div className="interview-aidraft__row">
                  <Form.Item name="diagramKind" label="图型" className="interview-aidraft__row-main">
                    <Select options={[...DIAGRAM_KIND_OPTIONS]} />
                  </Form.Item>
                  <Form.Item name="count" label="条数" className="interview-aidraft__row-side">
                    <Input disabled value="1" />
                  </Form.Item>
                </div>
              );
            }
            return (
              <div className="interview-aidraft__row">
                <Form.Item name="difficulty" label="难度" className="interview-aidraft__row-main">
                  <Select
                    options={difficultyOptions}
                    // 提示语直接用 prompt 层的中文档位说明，避免两套口径
                    optionRender={(option) => (
                      <div className="interview-aidraft__option">
                        <span>{option.data.label}</span>
                        <span className="interview-aidraft__option-note">
                          {DRAFT_DIFFICULTY_LABELS[option.data.value as Difficulty]}
                        </span>
                      </div>
                    )}
                  />
                </Form.Item>
                <Form.Item name="count" label="条数" className="interview-aidraft__row-side">
                  <Input type="number" min={1} max={10} />
                </Form.Item>
              </div>
            );
          }}
        </Form.Item>

        <Form.Item name="seed" label="种子（可选）">
          <Input placeholder="一句话方向：如「React 并发渲染」或某个术语" maxLength={120} />
        </Form.Item>
      </Form>

      {ai.error ? (
        <Alert
          className="interview-aidraft__error"
          type="error"
          showIcon
          message={ai.error}
          closable
        />
      ) : null}

      {ai.usedFallback ? (
        <Alert
          className="interview-aidraft__fallback"
          type="warning"
          showIcon
          message="模型返回的 JSON 不规整，已按兜底规则解析，请重点核对内容"
        />
      ) : null}

      {ai.generating ? (
        <div className="interview-aidraft__loading">
          <BulbOutlined /> 正在生成，稍等几秒…
        </div>
      ) : ai.candidates.length === 0 ? (
        <Empty
          className="interview-aidraft__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有候选：选好参数后点「生成候选」"
        />
      ) : (
        <ul className="interview-aidraft__list">
          {ai.candidates.map((candidate) => (
            <CandidateRow
              key={candidate.key}
              candidate={candidate}
              pending={ai.adoptingKey === candidate.key}
              onAdopt={() => void ai.adopt(candidate, "adopted")}
              onDiscard={() => ai.discard(candidate.key)}
            />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

/** 一条候选：标题 + 校验红字 + 三个动作（采纳 / 存草稿 / 丢弃） */
function CandidateRow({
  candidate,
  pending,
  onAdopt,
  onDiscard,
}: {
  candidate: DraftCandidate;
  pending: boolean;
  onAdopt: () => void;
  onDiscard: () => void;
}): ReactNode {
  const invalid = candidate.errors.length > 0;
  return (
    <li className={`interview-aidraft__item${invalid ? " is-invalid" : ""}`}>
      <div className="interview-aidraft__item-head">
        <Tag className="interview-aidraft__kind">{KIND_LABEL[candidate.kind]}</Tag>
        <span className="interview-aidraft__item-title">{candidate.title}</span>
      </div>

      {invalid ? (
        <ul className="interview-aidraft__item-errors">
          {candidate.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className="interview-aidraft__item-ops">
        <Button
          className="interview-aidraft__adopt"
          type="primary"
          size="small"
          disabled={invalid}
          loading={pending}
          onClick={onAdopt}
        >
          采纳进题库
        </Button>
        <Button className="interview-aidraft__drop" type="text" size="small" onClick={onDiscard}>
          丢弃
        </Button>
      </div>
    </li>
  );
}
