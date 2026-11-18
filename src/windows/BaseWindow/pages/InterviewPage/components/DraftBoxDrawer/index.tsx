import { Alert, Button, Drawer, Empty, Tag, Typography } from "antd";
import { CheckOutlined, DeleteOutlined } from "@ant-design/icons";
import type { InterviewItemDetailDTO } from "@/shared/types/electron";
import type { InterviewKind } from "@/shared/interview/payload-shape";
import { categoryPath } from "../../data/interview-filter-utils";
import type { CategoryNode } from "../../data/interview-taxonomy";
import type { InterviewCategoryId } from "../../data/interview-types";
import "./index.scss";

const { Text } = Typography;

/** 产物类型的中文名（与 AI 抽屉同一套说法） */
const KIND_LABEL: Record<InterviewKind, string> = {
  question: "题目",
  glossary: "词条",
  diagram: "图解",
};

interface DraftBoxDrawerProps {
  open: boolean;
  items: readonly InterviewItemDetailDTO[];
  /** 合并后的分类表：草稿可能挂在 `u-c-*` 下，路径要走同一份白名单 */
  categories: readonly CategoryNode[];
  pendingId: string | null;
  /** 最近一次写失败的原因（人话；主进程原样返回） */
  error: string | null;
  onClearError: () => void;
  /** 采纳进题库 */
  onAdopt: (item: InterviewItemDetailDTO) => void;
  /** 丢弃（彻底删除） */
  onDiscard: (item: InterviewItemDetailDTO) => void;
  onClose: () => void;
}

/** 毫秒时间戳 → `YYYY-MM-DD`（本地日；列表里不需要时分秒） */
function dayOf(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 类型收窄：DTO 的 `kind` 是裸 string（库里是 TEXT 列） */
function kindLabel(kind: string): string {
  return KIND_LABEL[kind as InterviewKind] ?? kind;
}

/**
 * 草稿箱。
 *
 * 为什么需要它：合并视图**只收 `adopted`**，于是 `status='draft'` 的条目在界面上
 * 一处也看不见 —— AI 生成的候选一旦采纳失败（键冲突、主进程结构校验没过），
 * 内容就落进了一个没有入口的黑洞。这里补上唯一的出口：看一眼、采纳、或丢掉。
 *
 * 没有「编辑草稿」：编辑要先过结构校验，而草稿往往正是「结构还差一截」的东西。
 * 想改就采纳后去卡片上改（那道流程有完整的表单与校验）。
 */
export default function DraftBoxDrawer({
  open,
  items,
  categories,
  pendingId,
  error,
  onClearError,
  onAdopt,
  onDiscard,
  onClose,
}: DraftBoxDrawerProps) {
  return (
    <Drawer
      className="interview-drafts"
      title={`草稿箱${items.length > 0 ? ` · ${items.length}` : ""}`}
      size="large"
      open={open}
      onClose={onClose}
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
    >
      <Text type="secondary" className="interview-drafts__hint">
        这些内容已经写进本地库，但还没有进题库（不参与搜索、不计入分类角标）。采纳后立刻出现在题库里；
        丢弃是彻底删除，不进回收站。
      </Text>

      {error ? (
        <Alert
          className="interview-drafts__error"
          type="error"
          showIcon
          closable
          title={error}
          onClose={onClearError}
        />
      ) : null}

      {items.length === 0 ? (
        <Empty
          className="interview-drafts__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="没有待处理的草稿"
        />
      ) : (
        <ul className="interview-drafts__list">
          {items.map((item) => {
            // DTO 的 `categoryId` 是裸 string（库里是 TEXT 列），分类路径要按宽松 id 查表
            const path = categoryPath(
              (item.categoryId ?? "") as InterviewCategoryId,
              categories,
            ).join(" / ");
            return (
              <li className="interview-drafts__item" key={item.id}>
                <div className="interview-drafts__text">
                  <div className="interview-drafts__head">
                    <Tag className="interview-drafts__kind">{kindLabel(item.kind)}</Tag>
                    <span className="interview-drafts__title">{item.title || item.id}</span>
                  </div>
                  <span className="interview-drafts__meta">
                    {path}
                    {item.updatedAt ? ` · ${dayOf(item.updatedAt)}` : ""}
                    {item.origin === "ai" ? " · AI 生成" : ""}
                  </span>
                  {item.errors.length > 0 ? (
                    <ul className="interview-drafts__errors">
                      {item.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="interview-drafts__ops">
                  <Button
                    className="interview-drafts__adopt"
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    loading={pendingId === item.id}
                    onClick={() => onAdopt(item)}
                  >
                    采纳
                  </Button>
                  <Button
                    className="interview-drafts__discard"
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={pendingId === item.id}
                    onClick={() => onDiscard(item)}
                  >
                    丢弃
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
