import { EditOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import NovelPage from "./pages/NovelPage/NovelPage";
import "./index.scss";

/**
 * WorkerWindow —— CheckIn 小说编辑器窗口
 *
 * 窗口级职责只做两件事：提供标题栏（拖动 / 最小化 / 最大化 / 关闭）与挂载主页面。
 * 业务全部下沉到 pages/NovelPage，按 AGENTS.md 的窗口隔离与页面模块规范组织。
 *
 * 注意：PRD §2「零打断原则」明确移除了 Esc 关窗——编辑场景 Esc 属高频误触，
 * Esc 现在只用于退出专注模式（实现在 useNovelShortcuts）。
 */
export default function WorkerWindowApp() {
  return (
    <div className="window-shell">
      <WindowHeader title="小说编辑器" icon={<EditOutlined />} />
      <div className="window-shell__body">
        <NovelPage />
      </div>
    </div>
  );
}
