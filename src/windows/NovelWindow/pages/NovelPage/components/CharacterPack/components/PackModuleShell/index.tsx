import type { ReactNode } from "react";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
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
 */
export default function PackModuleShell({
  title,
  hint,
  actions,
  collapsed,
  onToggle,
  children,
}: PackModuleShellProps) {
  return (
    <section className={`cpk-mod${collapsed ? " is-collapsed" : ""}`}>
      <header className="cpk-mod__head">
        <button
          type="button"
          className="cpk-mod__toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? "展开" : "折叠"}
        >
          <span className="cpk-mod__caret">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </span>
          <span className="cpk-mod__title">{title}</span>
        </button>
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
