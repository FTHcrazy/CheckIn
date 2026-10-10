import { useCallback, useEffect, useState } from "react";
import { BookOutlined, SettingOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Tooltip } from "antd";
import WindowHeader from "@/shared/components/WindowHeader";
import { IS_NOVEL_EDITION } from "@/shared/edition";
// 根级样式由 main.tsx 引入（两者都引会重复插入同一份 CSS）
import BookshelfPage from "./pages/BookshelfPage/BookshelfPage";
import NovelPage, { type OpenWorkRequest } from "./pages/NovelPage/NovelPage";

/**
 * NovelWindow —— CheckIn 小说窗口
 *
 * 双视图：书架主页（默认）↔ 编辑器。编辑器懒挂载——首次进入才 mount，
 * 之后常驻并用 display 切换显隐，保住未落库的键入内容（崩溃恢复另由
 * 会话标记驱动）。打开作品经 OpenWorkRequest（幂等 token）传递，由
 * NovelPage 消费后回调置空。
 *
 * 窗口形态随构建版本分叉（见 electron/edition.ts）：
 * - full 版：即关即销的子窗口，从主窗口侧边栏入口唤起
 * - novel 版：主窗口，登录后唤起、关闭进托盘；标题栏带设置入口
 *   （SettingsWindow 承载外观 / 账号等全局设置）
 *
 * 注意：PRD §2「零打断原则」明确移除了 Esc 关窗——编辑场景 Esc 属高频误触，
 * Esc 现在只用于退出专注模式（实现在 useNovelShortcuts）。
 */

/** novel 版主窗标题栏的设置入口：发起打开 SettingsWindow 请求（即关即销） */
function SettingsEntryButton() {
  return (
    <Tooltip title="设置" placement="bottom">
      <Button
        className="novel-window-header-btn"
        aria-label="设置"
        onClick={() => window.electronAPI?.send("settings-window-open", null)}
      >
        <SettingOutlined />
      </Button>
    </Tooltip>
  );
}

export default function NovelWindowApp() {
  const [view, setView] = useState<"shelf" | "editor">("shelf");
  const [editorMounted, setEditorMounted] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenWorkRequest | null>(null);

  /** 书架 → 编辑器：懒挂载 + 派发打开请求 + 切视图 */
  const openWork = useCallback((workId: string, chapterId?: string) => {
    setEditorMounted(true);
    setOpenRequest({ workId, chapterId, token: Date.now() });
    setView("editor");
  }, []);

  const consumeOpenRequest = useCallback(() => setOpenRequest(null), []);

  const backToShelf = useCallback(() => setView("shelf"), []);

  // 编辑器从 display:none 恢复可见后派发 resize，让 CodeMirror 按新视口重测量
  useEffect(() => {
    if (view !== "editor") return;
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => cancelAnimationFrame(raf);
  }, [view]);

  return (
    <AntdApp className="novel-app-root">
      <div className="window-shell">
        <WindowHeader
          title="CheckIn 小说"
          icon={<BookOutlined />}
          badge={view === "shelf" ? <span className="novel-badge">书架</span> : null}
          actions={IS_NOVEL_EDITION ? <SettingsEntryButton /> : null}
        />
        <div className="window-shell__body">
          <div className="novel-views">
            <div
              className={`novel-view${view === "shelf" ? "" : " is-hidden"}`}
              aria-hidden={view !== "shelf"}
            >
              <BookshelfPage visible={view === "shelf"} onOpenWork={openWork} />
            </div>
            {editorMounted && (
              <div
                className={`novel-view${view === "editor" ? "" : " is-hidden"}`}
                aria-hidden={view !== "editor"}
              >
                <NovelPage
                  openRequest={openRequest}
                  onOpenRequestConsumed={consumeOpenRequest}
                  onBackToShelf={backToShelf}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </AntdApp>
  );
}
