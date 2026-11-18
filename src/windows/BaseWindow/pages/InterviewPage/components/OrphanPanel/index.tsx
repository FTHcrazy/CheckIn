import { Button, Drawer, Empty, Typography } from "antd";
import { ImportOutlined, DeleteOutlined } from "@ant-design/icons";
import type { MergeResult } from "../../persistence/merge-interview-bank";
import "./index.scss";

const { Text } = Typography;

type Orphan = MergeResult["orphaned"][number];

interface OrphanPanelProps {
  open: boolean;
  items: readonly Orphan[];
  pendingId: string | null;
  /** 转存为我的新建题（发新 `u-` id，收藏语义会重置） */
  onAdopt: (id: string) => void;
  /** 丢弃：删掉覆盖行，内容不再保留 */
  onDiscard: (id: string) => void;
  onClose: () => void;
}

/**
 * 孤儿覆盖处理面板（规范 §5.2 步骤 6）。
 *
 * 什么会变成孤儿：你改过某道默认题，后来新版本把这道题从基线里删了。
 * 这时你的版本**还在库里**，但没有任何基线可以挂 —— 合并视图不渲染它。
 *
 * 为什么不当场自动处理：转存要换 id（`u-q-*`），而 id 是收藏
 * （`localStorage` 的 `string[]`）与 `expandedId` 的锚，换了就等于那道题的
 * 收藏记录作废。所以只能由用户点：**转存**（保留内容，收藏失效）或
 * **丢弃**（承认这份改动不要了）。
 */
export default function OrphanPanel({
  open,
  items,
  pendingId,
  onAdopt,
  onDiscard,
  onClose,
}: OrphanPanelProps) {
  return (
    <Drawer
      className="interview-orphan"
      title={`失效的修改${items.length > 0 ? ` · ${items.length}` : ""}`}
      size="large"
      open={open}
      onClose={onClose}
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
    >
      <Text type="secondary" className="interview-orphan__hint">
        这些默认题在新版本里已经删掉了，但你对它们的修改还留在本地。转存会变成一道你自己新建的题
        （题目的收藏记录会失效）；丢弃则连同修改一起删除，不可恢复。
      </Text>

      {items.length === 0 ? (
        <Empty
          className="interview-orphan__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="没有失效的修改"
        />
      ) : (
        <ul className="interview-orphan__list">
          {items.map((item) => (
            <li className="interview-orphan__item" key={item.id}>
              <div className="interview-orphan__text">
                <span className="interview-orphan__title">{item.title || item.id}</span>
                <span className="interview-orphan__meta">
                  {item.id}
                  {item.baseStamp ? ` · 你改的版本基于 ${item.baseStamp}` : ""}
                </span>
              </div>
              <div className="interview-orphan__ops">
                <Button
                  className="interview-orphan__adopt"
                  type="link"
                  size="small"
                  icon={<ImportOutlined />}
                  loading={pendingId === item.id}
                  onClick={() => onAdopt(item.id)}
                >
                  转存为我的题
                </Button>
                <Button
                  className="interview-orphan__discard"
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={pendingId === item.id}
                  onClick={() => onDiscard(item.id)}
                >
                  丢弃
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
