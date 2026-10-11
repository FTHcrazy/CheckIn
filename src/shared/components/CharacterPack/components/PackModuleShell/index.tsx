import type { ReactNode } from "react";
import { Button } from "antd";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { useModuleSummary } from "../module-summary-context";
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
 * 经 context 投下来，窄档下九个模块压成九行时用来回答「这栏是不是空的」。
 * 模块自己不需要知道它从哪来，宽 / 中档下它是空串，不占位也不改版式。
 */
export default function PackModuleShell({
  title,
  hint,
  actions,
  collapsed,
  onToggle,
  children,
}: PackModuleShellProps) {
  const summary = useModuleSummary();
  return (
    <section className={`cpk-mod${collapsed ? " is-collapsed" : ""}`}>
      <header className="cpk-mod__head">
        <Button
          className="cpk-mod__toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? "展开" : "折叠"}
        >
          <span className="cpk-mod__caret">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </span>
          <span className="cpk-mod__title">{title}</span>
          {summary ? <span className="cpk-mod__summary">{summary}</span> : null}
        </Button>
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
