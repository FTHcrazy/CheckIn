import { useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { DownOutlined, PushpinFilled, PushpinOutlined, RightOutlined } from "@ant-design/icons";
import { useModuleChrome } from "../module-summary-context";
import "./index.scss";

interface PackModuleShellProps {
  title: string;
  /** 一句话说明（未配置引导 / 提示用） */
  hint?: string;
  /** 头部右侧的操作区（新增 / 设置等） */
  actions?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * 模块壳（可折叠）
 *
 * 折叠用 grid-template-rows 0fr↔1fr 过渡，而不是条件渲染 ——
 * 条件渲染会打断过渡（AGENTS.md 6.4）。
 *
 * 标题右侧可有一句派生摘要（如「12 种 · 共 46 件」）：它由外壳按窗口宽度
 * 经 context 投下来，窄档下十个模块压成十行时用来回答「这栏是不是空的」。
 * 模块自己不需要知道它从哪来，宽 / 中档下它是空串，不占位也不改版式。
 *
 * 点击涟漪（1.39.1）：标题是「占满头部一整行的透明按钮」，antd 自带的
 * wave 环（box-shadow 0 0 0 6px currentcolor + 2s 淡出）罩在上面只剩一个
 * 挂两秒的色框，观感是「点了闪一下怪东西」（OutlinePanel 1.34.0 同款回归）。
 * 这里在按钮上把 wave 关掉，换成自绘的小涟漪：从点击位置扩散、0.45s 收场，
 * 轻到不与折叠动画抢戏。
 */
export default function PackModuleShell({
  title,
  hint,
  actions,
  collapsed,
  onToggle,
  children,
}: PackModuleShellProps) {
  const { summary, pinned, onTogglePin } = useModuleChrome();
  /** 当前涟漪（key 换新重启动画；动画结束即卸载） */
  const [ripple, setRipple] = useState<{ key: number; x: number } | null>(null);

  const handleToggle = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    // 涟漪锚点取点击处在按钮内的横向位置（纵向恒居中）
    const rect = event.currentTarget.getBoundingClientRect();
    setRipple({ key: Date.now(), x: event.clientX - rect.left });
    onToggle();
  };

  return (
    <section className={`cpk-mod${collapsed ? " is-collapsed" : ""}${pinned ? " is-pinned" : ""}`}>
      <header className="cpk-mod__head">
        <Button
          className="cpk-mod__toggle"
          onClick={handleToggle}
          aria-expanded={!collapsed}
          title={collapsed ? "展开" : "折叠"}
        >
          <span className="cpk-mod__caret">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </span>
          <span className="cpk-mod__title">{title}</span>
          {summary ? <span className="cpk-mod__summary">{summary}</span> : null}
          {ripple ? (
            <span
              key={ripple.key}
              className="cpk-mod__ripple"
              style={{ left: ripple.x }}
              onAnimationEnd={() => setRipple(null)}
              aria-hidden
            />
          ) : null}
        </Button>
        {onTogglePin ? (
          <Tooltip title={pinned ? "取消钉选：重开行囊时收成摘要行" : "钉选常驻：打开行囊即展开本模块"}>
            <Button
              className="cpk-mod__pin"
              aria-label={pinned ? "取消钉选" : "钉选常驻"}
              aria-pressed={pinned}
              onClick={onTogglePin}
            >
              {pinned ? <PushpinFilled /> : <PushpinOutlined />}
            </Button>
          </Tooltip>
        ) : null}
        {actions ? <div className="cpk-mod__actions">{actions}</div> : null}
      </header>
      <div className="cpk-mod__wrap">
        <div className="cpk-mod__inner">
          {hint ? <p className="cpk-mod__hint">{hint}</p> : null}
          {children}
        </div>
      </div>
    </section>
  );
}
