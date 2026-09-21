import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./index.scss";

type WindowAction = "minimize" | "maximize-toggle" | "close";

interface WindowHeaderProps {
  /** 左侧标题（可选）；不传则左侧仅作为拖动留白 */
  title?: string;
  /** 标题左侧图标（可选），随 title 一起显示 */
  icon?: ReactNode;
  /** 标题右侧徽标插槽（可选，如书架页的「书架」视角 chip）；不传不渲染 */
  badge?: ReactNode;
}

/**
 * 无边框圆角窗口的通用标题栏（窗口级组件，挂在 .window-shell 内、__body 之前）。
 *
 * 职责：
 * - 提供整条拖动区（窗口级职责，禁止挂到页面级组件上）
 * - 右侧最小化 / 最大化(还原) / 关闭三个控制按钮
 * - 最大化状态由主进程推送（window-maximize-state），挂载时先主动查询一次；
 *   同时在 <html> 上同步 is-window-maximized 类，供 window-shell 切换方角样式
 *
 * IPC 约定：window-control 的 payload 是动作字符串本身
 * （"minimize" | "maximize-toggle" | "close"），不是包了一层的对象。
 * close 走 win.close()，由各窗口自己的 close 语义决定行为。
 */
export default function WindowHeader({ title, icon, badge }: WindowHeaderProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubscribe = api.receive("window-maximize-state", (value: unknown) => {
      const maximized = Boolean(value);
      setIsMaximized(maximized);
      document.documentElement.classList.toggle("is-window-maximized", maximized);
    });
    // 覆盖「窗口已在最大化状态下刷新/重载」的初始状态同步
    api.send("window-maximize-query", null);

    return () => {
      unsubscribe();
      document.documentElement.classList.remove("is-window-maximized");
    };
  }, []);

  const handleControl = (action: WindowAction) => {
    window.electronAPI?.send("window-control", action);
  };

  return (
    <div className="window-header">
      {(title || icon) && (
        <div className="window-header__title">
          {icon}
          {title && <span className="window-header__title-text">{title}</span>}
        </div>
      )}
      {badge && <div className="window-header__badge">{badge}</div>}
      <div className="window-header__controls">
        <button
          type="button"
          className="window-header__btn"
          aria-label="最小化"
          onClick={() => handleControl("minimize")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="window-header__btn"
          aria-label={isMaximized ? "还原" : "最大化"}
          onClick={() => handleControl("maximize-toggle")}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3 3V1h6v6H7" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="window-header__btn window-header__btn--close"
          aria-label="关闭"
          onClick={() => handleControl("close")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
