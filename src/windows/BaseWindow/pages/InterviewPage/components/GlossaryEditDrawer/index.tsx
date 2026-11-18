import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Form, Input, Select, Tag, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { GLOSSARY_DOMAIN_LABEL, type GlossaryDomain, type GlossaryTerm } from "../../data/interview-glossary";
import { TRACKS, TRACK_LABEL, type CategoryNode } from "../../data/interview-taxonomy";
import type { GlossaryWriteOutcome } from "../../hooks/useGlossaryEdit";
import {
  GLOSSARY_LIMITS,
  buildEditedGlossary,
  validateGlossaryEdit,
  type GlossaryKeyHolder,
} from "../../persistence/glossary-edit";
import "./index.scss";

const { Text } = Typography;

/** 表单值：只收可编辑字段（`id` / `related` 不在这里） */
interface GlossaryFormValues {
  term: string;
  en?: string;
  domain: GlossaryDomain;
  categoryId?: string;
  short: string;
  /** 一行一条细节 */
  detail: string;
  aliases?: string[];
}

interface GlossaryEditDrawerProps {
  open: boolean;
  /** 要编辑的词条（`null` = 抽屉关着） */
  term: GlossaryTerm | null;
  /** 合并后的分类表（含自定义分类）：改分类时要能选到 `u-c-*` */
  categories: readonly CategoryNode[];
  /** 参与键冲突判定的全部词条（合并词表 + 草稿词条，口径与 AI 出词条一致） */
  holders: readonly GlossaryKeyHolder[];
  pendingId: string | null;
  /** 写失败的原因（主进程原话；与页面级提示共用一个位置也行，这里只做兜底） */
  error: string | null;
  onClearError: () => void;
  onClose: () => void;
  /** 保存成功：外层负责关抽屉（合并视图已在 hook 里 reload） */
  onSaved: () => void;
  save: (term: GlossaryTerm) => Promise<GlossaryWriteOutcome>;
  /** 删除自建词条（二次确认在页面做，抽屉只管把「要删哪条」报上去） */
  onDelete: (term: GlossaryTerm) => void;
}

/** 词条 → 表单值（可选字段用空串占位，antd 的受控组件不认 `undefined`） */
function toFormValues(term: GlossaryTerm): GlossaryFormValues {
  return {
    term: term.term,
    en: term.en ?? "",
    domain: term.domain,
    categoryId: term.categoryId,
    short: term.short,
    detail: term.detail.join("\n"),
    aliases: [...(term.aliases ?? [])],
  };
}

/** 多行文本 → 细节数组（容忍 `- ` / `* ` 前缀，模型与手输都会带） */
function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * 词条编辑抽屉。
 *
 * 【为什么需要它】
 * 词条一旦建错（AI 给的领域不对、词名太长、一句话定义写歪、想换分类），
 * 之前唯一的手段是「右键删别名」或「解除这一处绑定」—— 都是绕路：
 * 词条本身还在，正文里照旧点亮，只是用户放弃了纠正它。
 *
 * 【为什么改词名要提醒】
 * 词表按整词命中。把「Webpack Loader」改成「loader」之后，正文里原来那段
 * 「Webpack Loader」就不再是可点名词了。提醒一句比自动把旧名塞进别名好：
 * 后者会让一次改名悄悄改变全库的匹配结果，用户并不知道。
 */
export default function GlossaryEditDrawer({
  open,
  term,
  categories,
  holders,
  pendingId,
  error,
  onClearError,
  onClose,
  onSaved,
  save,
  onDelete,
}: GlossaryEditDrawerProps) {
  const [form] = Form.useForm<GlossaryFormValues>();
  const [failures, setFailures] = useState<string[]>([]);
  /** 保存中：只让「保存」转圈（删除是另一个动作，共用 `pendingId` 会出现两个按钮一起转） */
  const [saving, setSaving] = useState(false);

  // 每次打开都用当前词条重填：抽屉不销毁（`forceRender`），
  // 残留上一条的值会让用户改错词条
  useEffect(() => {
    if (!open || !term) return;
    form.setFieldsValue(toFormValues(term));
    setFailures([]);
  }, [open, term, form]);

  /** 内置还是自建：决定删除按钮与顶部说明 */
  const builtin = term ? !term.id.startsWith("u-") : false;

  const domainOptions = useMemo(
    () =>
      (Object.keys(GLOSSARY_DOMAIN_LABEL) as GlossaryDomain[]).map((value) => ({
        label: GLOSSARY_DOMAIN_LABEL[value],
        value,
      })),
    [],
  );

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

  const submit = async (values: GlossaryFormValues): Promise<void> => {
    if (!term) return;
    const next = buildEditedGlossary(term, {
      term: values.term,
      en: values.en,
      domain: values.domain,
      categoryId: values.categoryId,
      short: values.short,
      detail: splitLines(values.detail),
      aliases: values.aliases,
    });
    // 先在本地过结构校验与键冲突：不改就直接告诉用户「哪一条重了」，
    // 不必等主进程拒绝（它只会说「词条名不能为空」这类结构层的话）
    const local = validateGlossaryEdit(next, holders);
    if (local.length > 0) {
      setFailures(local);
      return;
    }
    setFailures([]);
    setSaving(true);
    const outcome = await save(next);
    setSaving(false);
    if (outcome.ok) {
      onSaved();
      return;
    }
    // 失败不关抽屉：用户改的那几段文字还在，能直接照着错误改
    setFailures(outcome.errors);
  };

  return (
    <Drawer
      className="interview-gedit"
      title={builtin ? "编辑内置词条" : "编辑我的词条"}
      size="large"
      open={open}
      onClose={onClose}
      // 与题目编辑同一口径：点遮罩不关，避免误点丢掉刚改的词条内容
      maskClosable={false}
      // 抽屉根节点默认 inset:0 会盖住 34px 的窗口标题栏（顶部 × 落进拖动带，
      // 系统命中测试判成 HTCAPTION，与 z-index 无关）。与其余抽屉逐字一致。
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
      // 表单常驻：`setFieldsValue` 要求 Form 已挂载
      forceRender
      footer={
        <div className="interview-gedit__footer">
          {builtin ? null : (
            <Button
              className="interview-gedit__delete"
              danger
              icon={<DeleteOutlined />}
              loading={pendingId === term?.id}
              onClick={() => {
                if (term) onDelete(term);
              }}
            >
              删除词条
            </Button>
          )}
          <span className="interview-gedit__spacer" />
          <Button className="interview-gedit__cancel" onClick={onClose}>
            取消
          </Button>
          <Button
            className="interview-gedit__save"
            type="primary"
            loading={saving}
            onClick={() => form.submit()}
          >
            保存
          </Button>
        </div>
      }
    >
      <Text type="secondary" className="interview-gedit__hint">
        {builtin
          ? "这是内置词条。保存后成为你本地的版本，随时可以在题库里改回来；内置内容不会被覆盖。"
          : "这是你自己建的词条，保存后立刻生效，正文里的匹配也一起更新。"}
        改词名后，正文里原来的说法不再自动点亮 —— 还想让它可点的话，把旧说法加进别名。
      </Text>

      {failures.length > 0 ? (
        <Alert
          className="interview-gedit__failures"
          type="error"
          showIcon
          title="没有保存成功"
          description={
            <ul className="interview-gedit__failure-list">
              {failures.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {error ? (
        <Alert
          className="interview-gedit__error"
          type="warning"
          showIcon
          closable
          title={error}
          onClose={onClearError}
        />
      ) : null}

      <Form<GlossaryFormValues>
        className="interview-gedit__form"
        form={form}
        layout="vertical"
        requiredMark
        onFinish={(values) => void submit(values)}
      >
        <div className="interview-gedit__row">
          <Form.Item
            name="term"
            label="词名"
            className="interview-gedit__row-main"
            rules={[{ required: true, whitespace: true, message: "词名不能为空" }]}
            extra="正文里按这个词点亮；同名的不同领域解释可以共存"
          >
            <Input maxLength={GLOSSARY_LIMITS.term} placeholder="如「闭包」" />
          </Form.Item>
          <Form.Item name="en" label="英文名" className="interview-gedit__row-side">
            <Input maxLength={GLOSSARY_LIMITS.en} placeholder="如 Closure（可留空）" />
          </Form.Item>
        </div>

        <div className="interview-gedit__row">
          <Form.Item
            name="domain"
            label="领域"
            className="interview-gedit__row-side"
            rules={[{ required: true, message: "请选择领域" }]}
            extra="同键只有同领域才算重复"
          >
            <Select options={domainOptions} placeholder="领域" />
          </Form.Item>
          <Form.Item name="categoryId" label="所属分类" className="interview-gedit__row-main">
            <Select
              options={categoryOptions}
              placeholder="留空表示不限分类"
              showSearch
              optionFilterProp="label"
              allowClear
            />
          </Form.Item>
        </div>

        <Form.Item
          name="short"
          label="一句话定义"
          rules={[{ required: true, whitespace: true, message: "一句话定义不能为空" }]}
          extra={`弹层首行显示，建议 40 字内（上限 ${GLOSSARY_LIMITS.short} 字）`}
        >
          <Input maxLength={GLOSSARY_LIMITS.short} placeholder="一句话说清它是什么" />
        </Form.Item>

        <Form.Item
          name="detail"
          label="展开细节"
          rules={[{ required: true, message: "至少写一条展开细节" }]}
          extra={`一行一条，最多 ${GLOSSARY_LIMITS.detail} 条`}
        >
          <Input.TextArea
            autoSize={{ minRows: 4, maxRows: 12 }}
            placeholder={"如：\n捕获定义时所在作用域\n即使外层函数已返回仍可访问"}
          />
        </Form.Item>

        <Form.Item name="aliases" label="别名" extra="别的说法 / 缩写，同样能在正文里点亮">
          <Select
            mode="tags"
            tokenSeparators={[",", "，"]}
            placeholder="回车或逗号分隔"
            maxCount={GLOSSARY_LIMITS.aliases}
          />
        </Form.Item>
      </Form>

      <div className="interview-gedit__meta">
        <Tag className="interview-gedit__id">{term?.id ?? ""}</Tag>
        <span className="interview-gedit__note">
          {builtin ? "内置词条不可删除" : "删除后正文里立刻不再点亮"}
        </span>
      </div>
    </Drawer>
  );
}
