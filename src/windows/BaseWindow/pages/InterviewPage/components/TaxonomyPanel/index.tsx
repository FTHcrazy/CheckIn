import { useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Drawer, Empty, Form, Input, Select, Tag, Typography } from "antd";
import { CheckOutlined, DownOutlined, PlusOutlined, RobotOutlined } from "@ant-design/icons";
import type { InterviewTaxonomyDTO } from "@/shared/types/electron";
import { TRACKS, TRACK_LABEL } from "../../data/interview-taxonomy";
import type { QuestionTrack } from "../../data/interview-types";
import { trackText, type UseInterviewTaxonomyResult } from "../../hooks/useInterviewTaxonomy";
import type { UseTaxonomySuggestResult } from "../../hooks/useTaxonomySuggest";
import "./index.scss";

const { Text } = Typography;

interface TaxonomyFormValues {
  label: string;
  track: QuestionTrack;
  note?: string;
}

interface TaxonomyPanelProps {
  open: boolean;
  /** 库里的自定义分类（含 `draft`；22 个基线分类不在其中、也不可改） */
  taxonomy: readonly InterviewTaxonomyDTO[];
  /** 侧栏当前轨道：新建分类默认落在这一侧 */
  track: QuestionTrack;
  api: UseInterviewTaxonomyResult;
  /** AI 建议（`interviewTaxonomySuggest`） */
  ai: UseTaxonomySuggestResult;
  /**
   * 建议被采纳、分类已落库。
   *
   * 页面接住这个回调去**立刻出示例题**：只建分类不落题，侧栏会多出一行
   * 「点进去 0 道题」的空分类（规范 §9 闸门 ②）。`track` 一并带过去 ——
   * 新建的分类这一帧还不在合并视图里，页面拿不到它属于哪条轨道。
   */
  onAdoptedSuggest: (
    categoryId: string,
    samples: readonly string[],
    track: QuestionTrack,
  ) => void;
  onClose: () => void;
}

/**
 * 分类管理抽屉。
 *
 * 三层闸门（规范 §9）在这里落地：
 * ① 新建的分类先是 `draft`，**不进侧栏**（避免出现 0 题的空分类）；
 * ② 点「采纳进侧栏」才 `adopted`，侧栏立刻多一行；
 * ③ 22 个基线分类不在本表里，因此这里既不显示也没有改名/删除入口
 *    （基线分类是源码常量，改名等于让知识体系与题库对不上）。
 *
 * 没有「删除分类」：删了分类，挂在它下面的题会悬空（规范 §13-3 的已知未决）。
 * 这里给的是「退回草稿」= 从侧栏收起来，题还在，想用再采纳。
 */
export default function TaxonomyPanel({
  open,
  taxonomy,
  track,
  api,
  ai,
  onAdoptedSuggest,
  onClose,
}: TaxonomyPanelProps): ReactNode {
  const [form] = Form.useForm<TaxonomyFormValues>();
  const [creating, setCreating] = useState(false);
  /** AI 推荐的方向（一句话，可空 = 让模型自己找空缺） */
  const [seed, setSeed] = useState("");
  /** 正在采纳的建议 key */
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null);

  const drafted = useMemo(() => taxonomy.filter((row) => row.status === "draft"), [taxonomy]);
  const adopted = useMemo(() => taxonomy.filter((row) => row.status === "adopted"), [taxonomy]);

  const submit = async (values: TaxonomyFormValues): Promise<void> => {
    setCreating(true);
    const id = await api.create({
      label: values.label,
      track: values.track,
      note: values.note,
    });
    setCreating(false);
    if (id) form.resetFields(["label", "note"]);
  };

  /**
   * 采纳一条 AI 建议：先落分类（直接 `adopted` —— 用户点「采纳」就是采纳），
   * 再让页面去出示例题。顺序不能反：示例题要挂在分类 id 上。
   */
  const adoptSuggestion = async (suggestion: {
    key: string;
    label: string;
    track: QuestionTrack;
    note: string;
    samples: readonly string[];
  }): Promise<void> => {
    setAdoptingKey(suggestion.key);
    const id = await api.create(
      { label: suggestion.label, track: suggestion.track, note: suggestion.note },
      "adopted",
    );
    setAdoptingKey(null);
    if (!id) return;
    ai.discard(suggestion.key);
    onAdoptedSuggest(id, suggestion.samples, suggestion.track);
  };

  /** 一行分类：标题 + 轨道 + 说明 + 两个动作 */
  const rowOf = (row: InterviewTaxonomyDTO, primary: ReactNode): ReactNode => (
    <li className="interview-taxonomy__item" key={row.id}>
      <div className="interview-taxonomy__item-text">
        <div className="interview-taxonomy__item-head">
          <span className="interview-taxonomy__item-label">{row.label}</span>
          <Tag className="interview-taxonomy__track">{TRACK_LABEL[row.track as QuestionTrack] ?? trackText(row.track)}</Tag>
        </div>
        {row.note ? <p className="interview-taxonomy__note">{row.note}</p> : null}
        <span className="interview-taxonomy__id">{row.id}</span>
      </div>
      <div className="interview-taxonomy__item-ops">{primary}</div>
    </li>
  );

  return (
    <Drawer
      className="interview-taxonomy"
      title="分类管理"
      size="large"
      open={open}
      onClose={onClose}
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
      forceRender
    >
      <Text type="secondary" className="interview-taxonomy__hint">
        这里只管理你自己新增的分类。内置的 22 个分类不在此列，也不可改名或删除。新建的分类先是草稿，
        采纳后才出现在左侧分类栏。
      </Text>

      {api.error ? (
        <Alert
          className="interview-taxonomy__error"
          type="error"
          showIcon
          closable
          message={api.error}
          onClose={api.clearError}
        />
      ) : null}

      <Form<TaxonomyFormValues>
        className="interview-taxonomy__form"
        form={form}
        layout="vertical"
        initialValues={{ track }}
        onFinish={(values) => void submit(values)}
      >
        <div className="interview-taxonomy__row">
          <Form.Item
            name="label"
            label="分类名称"
            className="interview-taxonomy__row-main"
            rules={[{ required: true, whitespace: true, message: "分类名称不能为空" }]}
          >
            <Input maxLength={12} placeholder="最多 12 字，如「RSC 与服务端组件」" />
          </Form.Item>
          <Form.Item name="track" label="所属轨道" className="interview-taxonomy__row-side">
            <Select
              options={TRACKS.map((item) => ({ label: item.label, value: item.id }))}
            />
          </Form.Item>
        </div>
        <Form.Item name="note" label="一句话说明（可选）">
          <Input maxLength={60} placeholder="这块考什么，出题时会作为约束提示" />
        </Form.Item>
        <Button
          className="interview-taxonomy__create"
          type="primary"
          icon={<PlusOutlined />}
          loading={creating}
          onClick={() => form.submit()}
        >
          新建分类草稿
        </Button>
      </Form>

      {/* AI 推荐：产物是「建议」而不是分类本身 —— 采纳才落库（规范 §9 闸门 ①/②）。
          AI 总开关关着时整块不渲染：留一个灰按钮只会让人反复点。 */}
      {!ai.hidden ? (
        <section className="interview-taxonomy__section">
          <h4 className="interview-taxonomy__section-title">AI 推荐</h4>
          <div className="interview-taxonomy__ai">
            <Input
              className="interview-taxonomy__ai-seed"
              value={seed}
              allowClear
              maxLength={40}
              placeholder="想补的方向（可空），如「RSC 与服务端组件」"
              onChange={(event) => setSeed(event.target.value)}
            />
            <Button
              className="interview-taxonomy__ai-run"
              icon={<RobotOutlined />}
              loading={ai.suggesting}
              onClick={() => void ai.suggest(seed)}
            >
              让 AI 推荐
            </Button>
          </div>

          {ai.error ? (
            <Alert
              className="interview-taxonomy__ai-error"
              type="error"
              showIcon
              closable
              message={ai.error}
            />
          ) : null}

          {ai.suggestions.length === 0 ? (
            <Text type="secondary" className="interview-taxonomy__ai-hint">
              推荐会带 3 条示例题名：采纳后直接拿它们去出题，避免新建出一块 0 道题的空分类。
            </Text>
          ) : (
            <ul className="interview-taxonomy__ai-list">
              {ai.suggestions.map((suggestion) => (
                <li className="interview-taxonomy__ai-item" key={suggestion.key}>
                  <div className="interview-taxonomy__item-text">
                    <div className="interview-taxonomy__item-head">
                      <span className="interview-taxonomy__item-label">{suggestion.label}</span>
                      <Tag className="interview-taxonomy__track">
                        {TRACK_LABEL[suggestion.track]}
                      </Tag>
                    </div>
                    {suggestion.note ? (
                      <p className="interview-taxonomy__note">{suggestion.note}</p>
                    ) : null}
                    {suggestion.samples.length > 0 ? (
                      <p className="interview-taxonomy__samples">
                        示例题：{suggestion.samples.join(" / ")}
                      </p>
                    ) : null}
                    {suggestion.errors.length > 0 ? (
                      <ul className="interview-taxonomy__ai-item-errors">
                        {suggestion.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="interview-taxonomy__item-ops">
                    <Button
                      className="interview-taxonomy__ai-adopt"
                      type="link"
                      size="small"
                      icon={<CheckOutlined />}
                      disabled={suggestion.errors.length > 0}
                      loading={adoptingKey === suggestion.key}
                      onClick={() => void adoptSuggestion(suggestion)}
                    >
                      采纳并出题
                    </Button>
                    <Button
                      className="interview-taxonomy__ai-drop"
                      type="text"
                      size="small"
                      onClick={() => ai.discard(suggestion.key)}
                    >
                      忽略
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="interview-taxonomy__section">
        <h4 className="interview-taxonomy__section-title">草稿（不进侧栏）</h4>
        {drafted.length === 0 ? (
          <Empty
            className="interview-taxonomy__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有待确认的分类"
          />
        ) : (
          <ul className="interview-taxonomy__list">
            {drafted.map((row) =>
              rowOf(
                row,
                <Button
                  className="interview-taxonomy__adopt"
                  type="link"
                  size="small"
                  icon={<CheckOutlined />}
                  loading={api.pendingId === row.id}
                  onClick={() => void api.setStatus(row, "adopted")}
                >
                  采纳进侧栏
                </Button>,
              ),
            )}
          </ul>
        )}
      </section>

      <section className="interview-taxonomy__section">
        <h4 className="interview-taxonomy__section-title">已采纳（在侧栏显示）</h4>
        {adopted.length === 0 ? (
          <Empty
            className="interview-taxonomy__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有自定义分类"
          />
        ) : (
          <ul className="interview-taxonomy__list">
            {adopted.map((row) =>
              rowOf(
                row,
                <Button
                  className="interview-taxonomy__retire"
                  type="link"
                  size="small"
                  icon={<DownOutlined />}
                  loading={api.pendingId === row.id}
                  onClick={() => void api.setStatus(row, "draft")}
                >
                  退回草稿
                </Button>,
              ),
            )}
          </ul>
        )}
      </section>
    </Drawer>
  );
}
