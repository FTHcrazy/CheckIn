import { Button, Drawer, Empty, Typography } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import type { InterviewMuteHintDTO } from "@/shared/types/electron";
import type { GlossaryTerm } from "../../data/interview-glossary";
import "./index.scss";

const { Text } = Typography;

interface MutePanelProps {
  open: boolean;
  /** 库里的负例（右键「这里不是这个词」写下的） */
  items: readonly InterviewMuteHintDTO[];
  /** 词条 id → 词条；查不到（词条被删）时只显示键 */
  termOf: (id: string) => GlossaryTerm | undefined;
  pendingId: string | null;
  /** 撤销一条负例：那一处重新点亮 */
  onRestore: (id: string) => void;
  onClose: () => void;
}

/**
 * 「已解除的名词绑定」面板。
 *
 * 【为什么必须有这个入口】
 * 右键解除是**破坏性**的：解除之后那段文字不再是按钮，也就没法再右键它。
 * 没有撤销口的话，一次误点（或解除后才发现「其实这就是那个词」）就永久
 * 失去这一处 —— 只能去库里删行。这里把每次解除摆出来，一键恢复。
 *
 * 【显示什么】
 * 存的是「词条 id + 匹配键 + 左右各 6 字」，所以能原样还原当时的上下文：
 * `…前面 6 字 [命中] 后面 6 字…`。用户认得出「是这句话里的这个词」，
 * 而不是面对一串 id。
 */
export default function MutePanel({
  open,
  items,
  termOf,
  pendingId,
  onRestore,
  onClose,
}: MutePanelProps) {
  return (
    <Drawer
      className="interview-mute"
      title={`已解除的名词绑定${items.length > 0 ? ` · ${items.length}` : ""}`}
      size="large"
      open={open}
      onClose={onClose}
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
    >
      <Text type="secondary" className="interview-mute__hint">
        词条按文本匹配，中文里难免误命中（「字节流」里的「节流」）。右键可点名词选
        「这里不是这个词」后，那一处不再点亮 —— 词条本身和其它位置都不受影响。
        恢复后那一处会重新变成可点名词。
      </Text>

      {items.length === 0 ? (
        <Empty
          className="interview-mute__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="没有解除过任何名词绑定"
        />
      ) : (
        <ul className="interview-mute__list">
          {items.map((item) => {
            const term = termOf(item.termId);
            return (
              <li className="interview-mute__item" key={item.id}>
                <div className="interview-mute__text">
                  <span className="interview-mute__term">{term?.term ?? item.termId}</span>
                  <span className="interview-mute__context">
                    {item.left}
                    <b className="interview-mute__hit">{item.key}</b>
                    {item.right}
                  </span>
                  <span className="interview-mute__meta">
                    命中键「{item.key}」
                    {term && term.term.toLowerCase() !== item.key ? "（别名）" : ""}
                  </span>
                </div>
                <Button
                  className="interview-mute__restore"
                  type="link"
                  size="small"
                  icon={<UndoOutlined />}
                  loading={pendingId === item.id}
                  onClick={() => onRestore(item.id)}
                >
                  恢复
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
