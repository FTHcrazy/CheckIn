import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Form, Input, Select, Typography } from "antd";
import { SHAPE_LIMITS } from "@/shared/interview/payload-shape";
import { DIFFICULTY_LABEL, TRACKS, TRACK_LABEL, type CategoryNode } from "../../data/interview-taxonomy";
import type {
  Difficulty,
  InterviewCategoryId,
  InterviewQuestion,
} from "../../data/interview-types";
import type { QuestionOrigin, QuestionWriteOutcome } from "../../hooks/useQuestionOverride";
import "./index.scss";

const { Text } = Typography;

/** 表单值：只收可编辑字段，`id` / `track` / `heat` / `reviewedAt` 不在这里 */
interface QuestionFormValues {
  title: string;
  stem: string;
  stemCode?: string;
  stemCodeLang?: string;
  answer: string;
  categoryId: InterviewCategoryId;
  difficulty: Difficulty;
  tags?: string[];
  topic: string;
}

interface QuestionEditDrawerProps {
  open: boolean;
  /** 要编辑的那道题（`override` 时是**用户版本**，不是基线原文） */
  question: InterviewQuestion | null;
  /** 来源：决定文案与「保存后会写哪种行」的解释 */
  origin: QuestionOrigin;
  /** 分类可选项（22 个基线分类；将来接自定义分类时调用方多传几个即可） */
  categories: readonly CategoryNode[];
  onClose: () => void;
  /** 保存成功：外层负责关抽屉 */
  onSaved: () => void;
  /** 保存通道由页面统一注入（`useQuestionOverride().saveOverride`） */
  saveOverride: (question: InterviewQuestion) => Promise<QuestionWriteOutcome>;
}

/** 来源 → 抽屉顶部的说明（用户得知道自己在改什么） */
const ORIGIN_HINT: Record<QuestionOrigin, string> = {
  baseline: "这是内置的默认题。保存后成为你本地的修改版本，随时可以「还原默认」。",
  override: "这是你改过的版本。保存只更新你自己的版本，内置默认题不受影响。",
  new: "这是你自己新建的题，保存后立刻在题库里生效。",
};

/** 来源 → 抽屉标题 */
const ORIGIN_TITLE: Record<QuestionOrigin, string> = {
  baseline: "编辑默认题",
  override: "编辑我的修改",
  new: "编辑新建题",
};

/**
 * `updatedAt` 只存到日（主进程按 ≤10 字校验，库里也是 `2026-01-15` 这种形态）。
 *
 * 用本地日期而不是 `toISOString()` 的 UTC 日：东八区凌晨改的题不该记成「昨天」。
 */
function todayStamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 题目 → 表单值（可选字段用空串占位，antd 的受控组件不认 `undefined`） */
function toFormValues(question: InterviewQuestion): QuestionFormValues {
  return {
    title: question.title,
    stem: question.stem,
    stemCode: question.stemCode ?? "",
    stemCodeLang: question.stemCodeLang ?? "",
    answer: question.answer,
    categoryId: question.categoryId,
    difficulty: question.difficulty,
    tags: [...question.tags],
    topic: question.topic,
  };
}

/**
 * 表单值 → 题目。
 *
 * 三条容易漏的：
 * 1. **可选字段要能被清空**：`{...question}` 会保留原有的 `stemCode`，
 *    用户把代码框删空后保存，旧代码会「失而复得」—— 空值必须走 `delete`。
 * 2. **`track` 跟着分类走**：分类换了轨道（如基础题改成笔试题）时，`track`
 *    留在旧值会出现「分类属于笔试题、轨道属于基础知识库」的自相矛盾记录，
 *    筛选按轨道一刀切时这道题就两边都不出现。
 * 3. **`id` 一律以入参为准**：收藏、React `key`、`expandedId` 全按 id 认人。
 */
function buildEditedQuestion(
  question: InterviewQuestion,
  values: QuestionFormValues,
  categories: readonly CategoryNode[],
): InterviewQuestion {
  const categoryId = values.categoryId ?? question.categoryId;
  const categoryNode = categories.find((node) => node.id === categoryId);
  const next: InterviewQuestion = {
    ...question,
    id: question.id,
    title: values.title.trim(),
    stem: values.stem.trim(),
    answer: values.answer.trim(),
    categoryId,
    track: categoryNode?.track ?? question.track,
    difficulty: values.difficulty,
    tags: (values.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    topic: values.topic.trim(),
    updatedAt: todayStamp(),
  };

  const stemCode = (values.stemCode ?? "").trim();
  if (stemCode) next.stemCode = stemCode;
  else delete next.stemCode;

  const stemCodeLang = (values.stemCodeLang ?? "").trim();
  if (stemCodeLang) next.stemCodeLang = stemCodeLang;
  else delete next.stemCodeLang;

  return next;
}

/**
 * 题目编辑抽屉。
 *
 * 【为什么是抽屉而不是弹窗】一题一答，题干 + 代码 + 答案三段都要能滚；
 * 弹窗在 960×600 的最小窗口里会被压成两层滚动条，抽屉能整列铺开。
 *
 * 【为什么保存路径由外面注入】写库要「先写、再重算合并视图」，重算只有页面
 * 那一份 `useQuestionOverride` 能做（它持有 `reload`）。抽屉只管表单与
 * 失败展示，不自己开通道 —— 否则每打开一次抽屉就多一份 `pendingId`。
 */
export default function QuestionEditDrawer({
  open,
  question,
  origin,
  categories,
  onClose,
  onSaved,
  saveOverride,
}: QuestionEditDrawerProps) {
  const [form] = Form.useForm<QuestionFormValues>();
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  // 每次打开都用当前这道题重填：抽屉不销毁（`forceRender`），
  // 残留上一次的值会让用户以为改错了题
  useEffect(() => {
    if (!open || !question) return;
    form.setFieldsValue(toFormValues(question));
    setFailures([]);
  }, [open, question, form]);

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

  const submit = async (values: QuestionFormValues): Promise<void> => {
    if (!question) return;
    setSaving(true);
    setFailures([]);
    const outcome = await saveOverride(buildEditedQuestion(question, values, categories));
    setSaving(false);
    if (outcome.ok) {
      onSaved();
      return;
    }
    // 失败不关抽屉：用户在表单里改的那几百字还在，能直接照着错误提示修
    setFailures(outcome.errors);
  };

  return (
    <Drawer
      className="interview-qedit"
      title={ORIGIN_TITLE[origin]}
      size="large"
      open={open}
      onClose={onClose}
      // 点遮罩不关闭：答案动辄几百字，一次误点就把刚改的内容全丢了。
      // 要走就走 × / 取消（或 Esc），那是明确动作。
      maskClosable={false}
      // 抽屉根节点默认 inset:0，会把 34px 的窗口标题栏一起盖住：面板顶部的 ×
      // 正好落进拖动带（系统命中测试判成 HTCAPTION，与 z-index 无关），点了没反应。
      // 与 KnowledgeDrawer 的处理保持逐字一致。
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
      // 表单常驻：`setFieldsValue` 需要 Form 已挂载，否则 antd 会警告
      // 「Instance created by useForm is not connected to any Form element」
      forceRender
      footer={
        <div className="interview-qedit__footer">
          <Button className="interview-qedit__cancel" onClick={onClose}>
            取消
          </Button>
          <Button
            className="interview-qedit__save"
            type="primary"
            loading={saving}
            onClick={() => form.submit()}
          >
            保存
          </Button>
        </div>
      }
    >
      <Text type="secondary" className="interview-qedit__hint">
        {ORIGIN_HINT[origin]}
      </Text>

      {failures.length > 0 ? (
        <Alert
          className="interview-qedit__failures"
          type="error"
          showIcon
          message="没有保存成功"
          description={
            <ul className="interview-qedit__failure-list">
              {failures.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Form<QuestionFormValues>
        className="interview-qedit__form"
        form={form}
        layout="vertical"
        requiredMark
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, whitespace: true, message: "标题不能为空" }]}
        >
          <Input maxLength={SHAPE_LIMITS.question.title} placeholder="一句话说清这道题问什么" />
        </Form.Item>

        <Form.Item
          name="stem"
          label="题干"
          rules={[{ required: true, whitespace: true, message: "题干不能为空" }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={SHAPE_LIMITS.question.stem}
            placeholder="题目描述；读代码类题目把代码放到下面的「题干代码」里"
          />
        </Form.Item>

        <div className="interview-qedit__row">
          <Form.Item name="stemCode" label="题干代码" className="interview-qedit__row-main">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 10 }}
              maxLength={SHAPE_LIMITS.question.stemCode}
              placeholder="留空表示这道题没有题干代码"
            />
          </Form.Item>
          <Form.Item name="stemCodeLang" label="代码语言" className="interview-qedit__row-side">
            <Input maxLength={20} placeholder="js / ts / vue" />
          </Form.Item>
        </div>

        <Form.Item
          name="answer"
          label="参考答案"
          rules={[{ required: true, whitespace: true, message: "参考答案不能为空" }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 6, maxRows: 16 }}
            maxLength={SHAPE_LIMITS.question.answer}
            placeholder="要点式作答；代码用 ```lang 围栏包起来"
          />
        </Form.Item>

        <div className="interview-qedit__row">
          <Form.Item
            name="categoryId"
            label="分类"
            className="interview-qedit__row-main"
            rules={[{ required: true, message: "请选择分类" }]}
          >
            <Select
              options={categoryOptions}
              placeholder="选择所属分类"
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            name="difficulty"
            label="难度"
            className="interview-qedit__row-side"
            rules={[{ required: true, message: "请选择难度" }]}
          >
            <Select options={difficultyOptions} placeholder="难度" />
          </Form.Item>
        </div>

        <Form.Item name="tags" label="标签">
          <Select
            mode="tags"
            tokenSeparators={[",", "，"]}
            placeholder="回车或逗号分隔，最多 12 个"
            maxCount={SHAPE_LIMITS.question.tags}
          />
        </Form.Item>

        <Form.Item
          name="topic"
          label="来源主题"
          rules={[{ required: true, whitespace: true, message: "来源主题不能为空" }]}
        >
          <Input maxLength={SHAPE_LIMITS.question.topic} placeholder="如「React 渲染原理」" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
