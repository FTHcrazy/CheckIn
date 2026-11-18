import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Drawer, Empty, Form, Input, InputNumber, Select, Spin, Tag, Typography } from "antd";
import { DownOutlined, ThunderboltOutlined, UpOutlined } from "@ant-design/icons";
import { DRAFT_DIFFICULTY_LABELS } from "@/shared/ai/context/prompt";
import type {
  DiagramShape,
  GlossaryShape,
  InterviewKind,
  QuestionShape,
} from "@/shared/interview/payload-shape";
import { DIFFICULTY_LABEL, TRACKS, TRACK_LABEL, type CategoryNode } from "../../data/interview-taxonomy";
import { GLOSSARY_DOMAIN_LABEL, type GlossaryDomain } from "../../data/interview-glossary";
import type { InterviewDiagram } from "../../data/interview-diagrams";
import type { Difficulty, QuestionTrack } from "../../data/interview-types";
import type { DraftCandidate, UseInterviewAiResult } from "../../hooks/useInterviewAi";
import DiagramFigure from "../DiagramFigure";
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
  /**
   * 分类所属轨道。
   *
   * 只在「刚建好的分类」场景需要：分类刚写进库、合并视图还没重算出这一行时，
   * `categories.find(id)` 是空的，靠它兜底才不会把笔试题生成到基础题轨道。
   */
  track?: QuestionTrack;
  seed?: string;
  /** 打开即生成（划词「加为词条」用：用户点的就是「补全这个词」） */
  autoRun?: boolean;
  /**
   * 「补充释义」：为已有的那条词条再写一条更深的。
   *
   * 与 `seed` 的区别是它同时带 `id` —— 生成的词条 `related` 要指回原词条，
   * prompt 也要知道「已经讲到哪」，否则产出的只是原定义的复读。
   */
  supplementOf?: { id: string; term: string; short: string };
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
 * 候选**必须能看全内容**：只给标题的预览等于让用户凭标题判断答案对不对，
 * 那还不如不给预览。三类产物各有一套详情（题干 + 答案 / 定义 + 细节 /
 * 真图渲染），校验红字与详情并列显示 —— 红字说「哪里坏了」，详情让人
 * 自己判断「能不能救」。
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
  /** 最近一条采纳的回执（候选会立刻从列表消失，没有回执等于「少了一条」） */
  const [adoptedNote, setAdoptedNote] = useState<string | null>(null);
  /** 回执里点名的那段原文（词名与原文不同时，告诉用户正文里哪个词亮了） */
  const [adoptedAlias, setAdoptedAlias] = useState<string | null>(null);

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
    setAdoptedNote(null);
    setAdoptedAlias(null);
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
      track: category?.track ?? prefill.track ?? "foundation",
      difficulty: values.difficulty,
      diagramKind: values.diagramKind,
      count: values.count,
      seed: values.seed,
      // 出词条时把种子的原词一并交给归一化：模型换个名字（`Webpack Loader`）
      // 也要保证正文里划中的 `loader` 采纳后可点
      ...(values.kind === "glossary" && values.seed?.trim()
        ? { anchor: values.seed.trim() }
        : {}),
      ...(prefill.supplementOf ? { supplementOf: prefill.supplementOf } : {}),
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

      {/* 补充释义的上下文必须说清楚：用户点了「补充释义」，但他可能没意识到
          产出的是**第二条**词条（原词条不会被改动） */}
      {prefill.supplementOf ? (
        <Alert
          className="interview-aidraft__supplement"
          type="info"
          showIcon
          title={`正在为词条「${prefill.supplementOf.term}」补充释义`}
          description="新词条会关联到原词条（点开能互相跳），原词条本身不会被覆盖。"
        />
      ) : null}

      {!ai.available ? (
        <Alert
          className="interview-aidraft__offline"
          type="warning"
          showIcon
          title="AI 当前不可用"
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
                  {/* 图解永远只出一张（`generate` 里 count 被强制成 1）：
                      这里不挂 `name`，免得表单里那个「3」被当成真的条数显示出来 */}
                  <Form.Item label="条数" className="interview-aidraft__row-side">
                    <InputNumber disabled value={1} controls={false} />
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
                  <InputNumber min={1} max={10} precision={0} />
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
          // key 跟着文案换：Alert 的「已关闭」是组件内部状态，同一个实例不会重新打开，
          // 换一条新错误时就再也弹不出来了
          key={ai.error}
          className="interview-aidraft__error"
          type="error"
          showIcon
          title={ai.error}
          closable
        />
      ) : null}

      {/* 采纳后候选就从列表里消失了：不给一句回执，用户只知道「少了一条」 */}
      {adoptedNote ? (
        <Alert
          className="interview-aidraft__adopted"
          type="success"
          showIcon
          title={`已采纳「${adoptedNote}」，题库里可以搜到了`}
          description={
            adoptedAlias
              ? `正文里的「${adoptedAlias}」现在也能点开（已记为它的别名）。`
              : "正文里同名的词现在可以点开。"
          }
          closable
          onClose={() => setAdoptedNote(null)}
        />
      ) : null}

      {ai.usedFallback ? (
        <Alert
          className="interview-aidraft__fallback"
          type="warning"
          showIcon
          title="模型返回的 JSON 不规整，已按兜底规则解析，请重点核对内容"
        />
      ) : null}

      {ai.generating ? (
        <div className="interview-aidraft__loading" role="status">
          <Spin size="small" /> 正在生成，稍等几秒…
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
              onAdopt={() => {
                void ai.adopt(candidate, "adopted").then((ok) => {
                  if (!ok) return;
                  const aliases =
                    "aliases" in candidate.payload ? candidate.payload.aliases ?? [] : [];
                  const seed = prefill.seed?.trim() ?? "";
                  setAdoptedNote(candidate.title);
                  setAdoptedAlias(
                    seed && seed !== candidate.title && aliases.includes(seed) ? seed : null,
                  );
                });
              }}
              onDiscard={() => ai.discard(candidate.key)}
            />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

/** 一条候选：预览（三类各一套）+ 校验红字 + 两个动作（采纳 / 丢弃） */
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

      <CandidatePreview candidate={candidate} />

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

/**
 * 候选详情。
 *
 * 三类产物的 payload 在类型上是联合，但 `kind` 与 payload 是一起构造的
 * （`buildDraftCandidate` 的每个分支只产出对应类型），所以这里按 `kind`
 * 取窄类型是安全的 —— 不去做「字段探测式」的类型收窄，那种写法在
 * 结构校验失败、payload 回落到手构对象时会走进错的预览分支。
 */
function CandidatePreview({ candidate }: { candidate: DraftCandidate }): ReactNode {
  if (candidate.kind === "question") {
    return <QuestionPreview shape={candidate.payload as QuestionShape} />;
  }
  if (candidate.kind === "glossary") {
    return <GlossaryPreview shape={candidate.payload as GlossaryShape} />;
  }
  const invalid = candidate.errors.length > 0;
  return <DiagramPreview shape={candidate.payload as DiagramShape} invalid={invalid} />;
}

/** 题目预览：难度 / 标签 → 题干 → 题干代码 → 参考答案（可折叠） */
function QuestionPreview({ shape }: { shape: QuestionShape }): ReactNode {
  const [openAnswer, setOpenAnswer] = useState(false);
  return (
    <div className="interview-aidraft__preview">
      <div className="interview-aidraft__preview-meta">
        <Tag className={`interview-aidraft__difficulty is-${shape.difficulty}`}>
          {DIFFICULTY_LABEL[shape.difficulty] ?? shape.difficulty}
        </Tag>
        {shape.tags.map((tag) => (
          <Tag className="interview-aidraft__tag" key={tag}>
            {tag}
          </Tag>
        ))}
      </div>

      <p className="interview-aidraft__stem">{shape.stem}</p>

      {shape.stemCode ? (
        <pre className="interview-aidraft__code">
          <code>{shape.stemCode}</code>
        </pre>
      ) : null}

      <Button
        className="interview-aidraft__toggle"
        type="text"
        size="small"
        icon={openAnswer ? <UpOutlined /> : <DownOutlined />}
        aria-expanded={openAnswer}
        onClick={() => setOpenAnswer((previous) => !previous)}
      >
        {openAnswer ? "收起参考答案" : "查看参考答案"}
      </Button>

      {openAnswer ? <pre className="interview-aidraft__answer">{shape.answer}</pre> : null}
    </div>
  );
}

/** 词条预览：英文名 / 领域 → 一句话定义 → 展开细节 → 别名 */
function GlossaryPreview({ shape }: { shape: GlossaryShape }): ReactNode {
  const domain = GLOSSARY_DOMAIN_LABEL[shape.domain as GlossaryDomain] ?? shape.domain;
  return (
    <div className="interview-aidraft__preview">
      <div className="interview-aidraft__preview-meta">
        {shape.en ? <span className="interview-aidraft__en">{shape.en}</span> : null}
        <Tag className="interview-aidraft__tag">{domain}</Tag>
      </div>

      <p className="interview-aidraft__stem">{shape.short}</p>

      <ul className="interview-aidraft__points">
        {shape.detail.map((point, index) => (
          <li key={`${index}-${point.slice(0, 8)}`}>{point}</li>
        ))}
      </ul>

      {shape.aliases && shape.aliases.length > 0 ? (
        <p className="interview-aidraft__aliases">别名：{shape.aliases.join(" / ")}</p>
      ) : null}
    </div>
  );
}

/** 图解预览：结构合法就直接画出来（画不出来才是要看的信号） */
function DiagramPreview({ shape, invalid }: { shape: DiagramShape; invalid: boolean }): ReactNode {
  if (invalid) {
    return (
      <div className="interview-aidraft__preview">
        <p className="interview-aidraft__stem">{shape.caption}</p>
        <p className="interview-aidraft__aliases">
          结构不完整，画不出来。按上面的红字补全后重新生成。
        </p>
      </div>
    );
  }
  return (
    <div className="interview-aidraft__preview is-diagram">
      <DiagramFigure diagram={shape as unknown as InterviewDiagram} compact />
    </div>
  );
}
