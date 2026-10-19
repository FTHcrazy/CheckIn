import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";
import { rendererLog } from "@/shared/log/renderer-logger";
import "./index.scss";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 出错时用于区分是哪个窗口（写进 meta，不影响落盘目录） */
  windowName: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 渲染层错误边界。
 *
 * React 的渲染期异常**不会**冒泡到 `window.onerror`：没有边界时 React 18 会
 * 直接卸载整棵树 —— 用户看到白屏，日志里一片空白。这类错误恰恰最难复现，
 * 所以统一在这里 `componentDidCatch` 落库（含 componentStack），并给出一个
 * 可自救的出口（重载界面）。
 *
 * 只包一层（根节点）：单个面板出错就让整窗口重载，比"半残界面继续跑"更容易
 * 排查 —— 后续若某个面板需要局部容错，再给该面板单独加边界。
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    rendererLog.error("react", `组件树渲染异常：${error.message}`, {
      window: this.props.windowName,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="err-boundary">
        <p className="err-boundary__title">界面出了点问题</p>
        <p className="err-boundary__hint">
          错误已写入本地日志（设置 → 诊断 → 打开日志目录），重载界面通常可以继续。
        </p>
        <pre className="err-boundary__detail">{error.message}</pre>
        <Button className="err-boundary__retry" onClick={() => window.location.reload()}>
          重载界面
        </Button>
      </div>
    );
  }
}
