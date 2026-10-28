import { Button, Tooltip } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import "./index.scss";

interface ContinueFabProps {
  /** 点击续写（上层负责二次确认，见 useNovelPage.requestContinuation） */
  onContinue: () => void;
  /** AI 是否可用（M8 门控）：false 时禁用并说明原因 */
  aiAvailable?: boolean;
  /** 不可用的一句话说明 */
  aiUnavailableText?: string;
  /** 已经在续写中：按钮显示进度态且不可重复点 */
  busy?: boolean;
}

/**
 * AI 续写悬浮按钮（REQ-061）
 *
 * 从顶栏搬下来的入口。原因有两个：
 *
 * 1. **顶栏挤**：右侧已有行囊 / 快照 / 设定 / 排版 / 导出等一排图标，
 *    再加一颗闪电就分不清哪颗是「写作时高频」的；
 * 2. **语义更近**：续写是「对着正文、在光标处接着写」，按钮贴着正文区右下角
 *    比贴窗口顶栏更符合直觉（和状态栏的「本章 / 今日」信息同属一层）。
 *
 * 纯展示 + 回调：确认、请求、插入都在 `useNovelPage` 里编排。
 */
export default function ContinueFab({
  onContinue,
  aiAvailable = true,
  aiUnavailableText = "",
  busy = false,
}: ContinueFabProps) {
  return (
    <Tooltip
      title={
        !aiAvailable
          ? aiUnavailableText
          : busy
            ? "正在续写…"
            : "AI 续写（光标处顺着前文接着写）"
      }
      placement="left"
    >
      <Button
        className="nv-contfab"
        onClick={onContinue}
        disabled={!aiAvailable}
        loading={busy}
        aria-label="AI 续写"
      >
        {!busy && <ThunderboltOutlined />}
        <span className="nv-contfab__text">续写</span>
      </Button>
    </Tooltip>
  );
}
