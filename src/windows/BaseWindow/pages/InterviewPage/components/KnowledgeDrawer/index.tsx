import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Select, Tag, Tooltip, Typography } from "antd";
import { CheckOutlined, CopyOutlined, LinkOutlined } from "@ant-design/icons";
import {
  CATEGORIES_BY_TRACK,
  CATEGORY_BY_ID,
  TRACK_LABEL,
} from "../../data/interview-taxonomy";
import {
  knowledgeOfCategory,
  type KnowledgeStage,
  type KnowledgeTopic,
} from "../../data/interview-knowledge";
import { diagramById } from "../../data/interview-diagrams";
import { openExternalUrl } from "@/shared/services/shell";
import type { CategoryKey, QuestionTrack } from "../../data/interview-types";
import TermText from "../TermText";
import DiagramFigure from "../DiagramFigure";
import "./index.scss";

const { Text } = Typography;

interface KnowledgeDrawerProps {
  open: boolean;
  track: QuestionTrack;
  /** 当前侧栏选中的分类，打开抽屉时作为默认范围 */
  categoryId: CategoryKey;
  onClose: () => void;
}

/** 阶段 → 标签配色（复用已有语义色，不新造 token） */
const STAGE_CLASS: Record<KnowledgeStage, string> = {
  入门: "is-basic",
  进阶: "is-medium",
  深入: "is-hard",
};

interface ScopeOption {
  value: CategoryKey;
  label: string;
}

interface KnowledgeGroup {
  key: string;
  label: string;
  topics: readonly KnowledgeTopic[];
}

/** 主题配图：id 找不到时静默不渲染，避免一条错数据把整个抽屉搞白 */
function KnowledgeDiagram({ id }: { id: string }) {
  const diagram = diagramById(id);
  if (!diagram) return null;
  return (
    <div className="interview-kc__diagram">
      <DiagramFigure diagram={diagram} compact />
    </div>
  );
}

/**
 * 知识体系抽屉。
 *
 * 题库回答「这道题怎么答」，这里回答「这块该按什么顺序学、上下游是什么」。
 * 主题数据是静态常量，组件只做分组与链接打开；打开链接一律交给主进程，
 * 渲染层不做任何导航（否则当前窗口会被浏览器页面顶掉）。
 */
export default function KnowledgeDrawer({
  open,
  track,
  categoryId,
  onClose,
}: KnowledgeDrawerProps) {
  const [scope, setScope] = useState<CategoryKey>(categoryId);
  /** 刚复制成功的链接，用于把复制按钮临时变成对勾 */
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // 每次打开都跟随侧栏当前分类，避免上次选的范围残留
  useEffect(() => {
    if (open) {
      setScope(categoryId);
      setCopiedUrl(null);
    }
  }, [open, categoryId, track]);

  const options = useMemo<ScopeOption[]>(
    () => [
      { value: "all", label: `${TRACK_LABEL[track]} · 全部分类` },
      ...CATEGORIES_BY_TRACK[track].map((node) => ({
        value: node.id,
        label: node.label,
      })),
    ],
    [track],
  );

  const groups = useMemo<KnowledgeGroup[]>(() => {
    if (scope === "all") {
      return CATEGORIES_BY_TRACK[track]
        .map((node) => ({
          key: node.id,
          label: node.label,
          topics: knowledgeOfCategory(node.id),
        }))
        .filter((group) => group.topics.length > 0);
    }
    return [
      {
        key: scope,
        label: CATEGORY_BY_ID[scope].label,
        topics: knowledgeOfCategory(scope),
      },
    ];
  }, [scope, track]);

  const copyLink = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
    } catch {
      setCopiedUrl(null);
    }
  };

  return (
    <Drawer
      className="interview-kc"
      title={`知识体系 · ${TRACK_LABEL[track]}`}
      size="large"
      open={open}
      onClose={onClose}
      // 抽屉根节点默认 inset:0，会把 34px 的窗口标题栏一起盖住。后果不止是难看：
      // 面板顶部的 × 正好落在标题栏的拖动带里（系统命中测试直接判成 HTCAPTION，
      // 与 z-index 无关），点了没有任何反应；窗口的最小化 / 关闭按钮也被埋掉。
      // 按标题栏高度整体下移，只占内容区。
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
    >
      <div className="interview-kc__bar">
        <Text type="secondary" className="interview-kc__hint">
          按「入门 → 进阶 → 深入」排序，并标出上下游；链接为官方文档。点标题用系统浏览器打开，点右侧图标复制。
        </Text>
        <Select<CategoryKey>
          className="interview-kc__select"
          value={scope}
          options={options}
          onChange={(value) => setScope(value)}
        />
      </div>

      {groups.length === 0 ? (
        <Text type="secondary">这个分类还没有整理知识体系。</Text>
      ) : (
        groups.map((group) => (
          <section className="interview-kc__group" key={group.key}>
            <h3 className="interview-kc__group-title">{group.label}</h3>
            {group.topics.map((topic) => (
              <article className="interview-kc__topic" key={topic.id}>
                <div className="interview-kc__topic-head">
                  <Tag className={`interview-kc__stage ${STAGE_CLASS[topic.stage]}`}>
                    {topic.stage}
                  </Tag>
                  <h4 className="interview-kc__topic-title">{topic.title}</h4>
                </div>
                <p className="interview-kc__summary">
                  <TermText text={topic.summary} />
                </p>
                <ul className="interview-kc__points">
                  {topic.points.map((point) => (
                    <li key={point}>
                      <TermText text={point} />
                    </li>
                  ))}
                </ul>
                {topic.diagramId ? <KnowledgeDiagram id={topic.diagramId} /> : null}
                {topic.upstream || topic.downstream ? (
                  <div className="interview-kc__flow">
                    {topic.upstream ? <span>上游：{topic.upstream}</span> : null}
                    {topic.downstream ? <span>后续：{topic.downstream}</span> : null}
                  </div>
                ) : null}
                <div className="interview-kc__links">
                  {topic.links.map((link) => (
                    <span className="interview-kc__link-row" key={link.url}>
                      <Button
                        className="interview-kc__link"
                        type="link"
                        size="small"
                        icon={<LinkOutlined />}
                        title={link.url}
                        onClick={() => void openExternalUrl(link.url)}
                      >
                        {link.label}
                      </Button>
                      <Tooltip title={copiedUrl === link.url ? "已复制" : "复制链接"}>
                        <Button
                          className="interview-kc__copy"
                          type="text"
                          size="small"
                          icon={
                            copiedUrl === link.url ? <CheckOutlined /> : <CopyOutlined />
                          }
                          aria-label={`复制链接：${link.label}`}
                          onClick={() => void copyLink(link.url)}
                        />
                      </Tooltip>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </section>
        ))
      )}
    </Drawer>
  );
}
