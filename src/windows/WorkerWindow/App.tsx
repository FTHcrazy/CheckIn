import { useCallback, useEffect, useState } from "react";
import { BookOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import BookshelfPage from "./pages/BookshelfPage/BookshelfPage";
import NovelPage, { type OpenWorkRequest } from "./pages/NovelPage/NovelPage";
import "./index.scss";

/**
 * WorkerWindow —— CheckIn 小说窗口
 *
 * 双视图：书架主页（默认）↔ 编辑器。编辑器懒挂载——首次进入才 mount，
 * 之后常驻并用 display 切换显隐，保住未落库的键入内容（崩溃恢复另由
 * 会话标记驱动）。打开作品经 OpenWorkRequest（幂等 token）传递，由
 * NovelPage 消费后回调置空。
 *
 * 注意：PRD §2「零打断原则」明确移除了 Esc 关窗——编辑场景 Esc 属高频误触，
 * Esc 现在只用于退出专注模式（实现在 useNovelShortcuts）。
 */
export default function WorkerWindowApp() {
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
    <div className="window-shell">
      <WindowHeader
        title="CheckIn 小说"
        icon={<BookOutlined />}
        badge={view === "shelf" ? <span className="worker-badge">书架</span> : null}
      />
      <div className="window-shell__body">
        <div className="worker-views">
          <div
            className={`worker-view${view === "shelf" ? "" : " is-hidden"}`}
            aria-hidden={view !== "shelf"}
          >
            <BookshelfPage visible={view === "shelf"} onOpenWork={openWork} />
          </div>
          {editorMounted && (
            <div
              className={`worker-view${view === "editor" ? "" : " is-hidden"}`}
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
  );
}
