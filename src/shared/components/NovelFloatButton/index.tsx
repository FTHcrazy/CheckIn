import { BookOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import "./index.scss";

interface NovelFloatButtonProps {
  /**
   * float：窗口右下角悬浮圆钮（默认）
   * inline：嵌入侧边栏的方形图标钮，不脱离文档流
   */
  variant?: "float" | "inline";
}

/**
 * NovelFloatButton —— 打开小说窗口（NovelWindow）的入口
 *
 * 窗口的创建/销毁由主进程负责，渲染层只发起请求。
 * 默认悬浮在右下角；首页侧边栏改用 `variant="inline"` 内嵌，避免两个悬浮入口并存。
 * novel 版构建下小说窗口是主窗口，本入口不会出现在任何界面中。
 */
export default function NovelFloatButton({
  variant = "float",
}: NovelFloatButtonProps) {
  const handleOpen = () => {
    window.electronAPI?.send("novel-window-open", { type: "open" });
  };

  const isInline = variant === "inline";

  return (
    <Tooltip
      title="打开小说窗口"
      placement={isInline ? "right" : "left"}
    >
      <button
        type="button"
        className={
          isInline ? "novel-btn novel-btn--inline" : "novel-btn novel-btn--float"
        }
        aria-label="打开小说窗口"
        onClick={handleOpen}
      >
        <BookOutlined className="novel-btn__icon" />
      </button>
    </Tooltip>
  );
}
