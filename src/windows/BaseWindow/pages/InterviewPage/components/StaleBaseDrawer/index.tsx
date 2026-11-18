import { Button, Drawer, Empty, Tag, Typography } from "antd";
import { CheckOutlined, SwapOutlined } from "@ant-design/icons";
import { QUESTION_BY_ID } from "../../data/interview-bank";
import "./index.scss";

const { Text } = Typography;

/** 一条「基线已更新」记录（合并视图的 `staleBase` 投影） */
export interface StaleBaseItem {
  id: string;
  baseStamp: string | null;
}

interface StaleBaseDrawerProps {
  open: boolean;
  items: readonly StaleBaseItem[];
  pendingId: string | null;
  /** 沿用我的（写 ack 指纹，提示消失，内容不动） */
  onAck: (id: string) => void;
  /** 用新版覆盖（删覆盖行，内容回落到新版基线） */
  onUseBaseline: (id: string) => void;
  onClose: () => void;
  /** 恢复中的条目：来自合并视图的题目，用来取展示名 */
  titleOf: (id: string) => string;
}

/**
 * 「N 道你改过的题在新版有更新」的批量入口（规范 §5.4）。
 *
 * 为什么要有这一屏：单张卡片上的角标只有翻到那道题才会看见，而升级后
 * 「我改过的 12 道题里有 3 道被官方修订了」这件事必须能被一次看全。
 *
 * 两个动作与卡片上的完全同源（都走 `useQuestionOverride` 的 ack / revert），
 * 不在这里另写一套写库逻辑 —— 两条路径各写一份，迟早一边记得刷新、
 * 另一边忘了，用户看到的就是「点了没用」。
 */
export default function StaleBaseDrawer({
  open,
  items,
  pendingId,
  onAck,
  onUseBaseline,
  onClose,
  titleOf,
}: StaleBaseDrawerProps) {
  return (
    <Drawer
      className="interview-stale"
      title={`基线已更新${items.length > 0 ? ` · ${items.length}` : ""}`}
      size="large"
      open={open}
      onClose={onClose}
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
    >
      <Text type="secondary" className="interview-stale__hint">
        这些题你改过，内置版本在新版也修订过。现在显示的是你的版本。「沿用我的」只是不再提醒，
        内容不动；「用新版覆盖」会丢掉你的改动，恢复成新版默认答案（之后仍可再改）。
      </Text>

      {items.length === 0 ? (
        <Empty
          className="interview-stale__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="你改过的题和内置版本一致，没有需要处理的"
        />
      ) : (
        <ul className="interview-stale__list">
          {items.map((item) => {
            const baseline = QUESTION_BY_ID[item.id] ?? null;
            return (
              <li className="interview-stale__item" key={item.id}>
                <div className="interview-stale__text">
                  <span className="interview-stale__title">
                    {titleOf(item.id) || baseline?.title || item.id}
                  </span>
                  <span className="interview-stale__meta">
                    <Tag className="interview-stale__tag">
                      你改的版本基于 {item.baseStamp ?? "较早版本"}
                    </Tag>
                    新版已修订这道题的默认答案
                  </span>
                </div>
                <div className="interview-stale__ops">
                  <Button
                    className="interview-stale__ack"
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    loading={pendingId === item.id}
                    onClick={() => onAck(item.id)}
                  >
                    沿用我的
                  </Button>
                  <Button
                    className="interview-stale__replace"
                    type="link"
                    size="small"
                    danger
                    icon={<SwapOutlined />}
                    loading={pendingId === item.id}
                    onClick={() => onUseBaseline(item.id)}
                  >
                    用新版覆盖
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
