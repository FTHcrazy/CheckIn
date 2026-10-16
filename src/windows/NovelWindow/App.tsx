import { useCallback, useEffect, useState } from "react";
import {
  BookOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Badge, Button, Tooltip } from "antd";
import HelpCenter from "@/shared/components/HelpCenter";
import WindowHeader from "@/shared/components/WindowHeader";
import { HELP_COPY, type GuideView } from "@/shared/novel/guide-copy";
import { NOVEL_HELP_DOC } from "@/shared/novel/guide-doc";
import { IS_NOVEL_EDITION } from "@/shared/edition";
// 根级样式由 main.tsx 引入（两者都引会重复插入同一份 CSS）
import BookshelfPage from "./pages/BookshelfPage/BookshelfPage";
import NovelPage, { type OpenWorkRequest } from "./pages/NovelPage/NovelPage";
import { selectHelpBadgeVisible, useGuideStore } from "./store/useGuideStore";

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

/**
 * 帮助入口（L3 常驻）：标题栏「？」，带未看完引导的红点（B-01）
 *
 * 红点是「引导是一次性的，帮助是长期的」的落点：Tour 关掉后功能仍需找得到，
 * 红点负责把跳过的作者拉回帮助中心。
 */
function HelpEntryButton() {
  const badgeVisible = useGuideStore(selectHelpBadgeVisible);
  const openHelp = useGuideStore((state) => state.openHelp);
  return (
    <Badge dot={badgeVisible}>
      <Tooltip title={HELP_COPY.badgeTip} placement="bottom">
        <Button
          className="novel-window-header-btn"
          aria-label={HELP_COPY.badgeTip}
          onClick={openHelp}
        >
          <QuestionCircleOutlined />
        </Button>
      </Tooltip>
    </Badge>
  );
}

export default function NovelWindowApp() {
  const [view, setView] = useState<"shelf" | "editor">("shelf");
  const [editorMounted, setEditorMounted] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenWorkRequest | null>(null);
  // 编辑器空书架空态的「导入书籍」请求（幂等 token）：转交书架发起导入
  const [importRequest, setImportRequest] = useState<number | null>(null);

  /** 书架 → 编辑器：懒挂载 + 派发打开请求 + 切视图 */
  const openWork = useCallback((workId: string, chapterId?: string) => {
    setEditorMounted(true);
    setOpenRequest({ workId, chapterId, token: Date.now() });
    setView("editor");
  }, []);

  const consumeOpenRequest = useCallback(() => setOpenRequest(null), []);

  const backToShelf = useCallback(() => setView("shelf"), []);

  /**
   * 引导「下一步」跨视图回书架时的切视图收口（第 5 → 第 6 步，1.4x）。
   * 只有窗口根同时持有两个视图的显隐开关，故由这里实现并注入编辑器页。
   */
  const goToView = useCallback((target: GuideView) => setView(target), []);

  /** 编辑器 → 书架：请求发起导入。切回书架让导入进度（顶栏按钮 loading）可见 */
  const requestImport = useCallback(() => {
    setView("shelf");
    setImportRequest(Date.now());
  }, []);

  const consumeImportRequest = useCallback(() => setImportRequest(null), []);

  // ── 新手引导与帮助中心（L1/L3 编排在这一层：它要同时看见两个视图）──
  const hydrateGuide = useGuideStore((state) => state.hydrate);
  const helpOpen = useGuideStore((state) => state.helpOpen);
  const openHelp = useGuideStore((state) => state.openHelp);
  const closeHelp = useGuideStore((state) => state.closeHelp);
  const replayGuide = useGuideStore((state) => state.replay);
  const guideDone = useGuideStore((state) => state.record.state === "done");
  const guideHydrated = useGuideStore((state) => state.hydrated);
  const startGuide = useGuideStore((state) => state.start);

  // 首次读取引导状态：必须在渲染 Tour 之前完成，否则会拿默认记录误判为未开始
  useEffect(() => {
    void hydrateGuide();
  }, [hydrateGuide]);

  // F1 打开了帮助中心（挂在窗口层：书架页与编辑器页都要能唤出）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F1" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      openHelp();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openHelp]);

  /**
   * 引导启动收口在这一层：只有它同时知道「当前是哪个视图」。
   * 第 1 步属书架页、第 2-5 步属编辑器页，两个 Tour 实例各自只渲染属于自己的那一步，
   * 跨视图时由上一步的 Tour 结束、下一步的 Tour 接管（目标不可见会自动暂停等待，
   * 视图重新可见时由这里的 start() 改拍续播）。
   */
  useEffect(() => {
    if (!guideHydrated) return;
    startGuide(view === "editor" ? 2 : 1);
  }, [guideHydrated, view, startGuide]);

  /** 重看引导：按当前视图定位起始步（在编辑器里重看不该跳回书架第 1 步） */
  const handleReplayGuide = useCallback(() => {
    replayGuide(view === "editor" ? 2 : 1);
  }, [replayGuide, view]);

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
          title="Novel 随笔"
          icon={<BookOutlined />}
          badge={view === "shelf" ? <span className="novel-badge">书架</span> : null}
          actions={
            <>
              <HelpEntryButton />
              {IS_NOVEL_EDITION ? <SettingsEntryButton /> : null}
            </>
          }
        />
        <div className="window-shell__body">
          <div className="novel-views">
            <div
              className={`novel-view${view === "shelf" ? "" : " is-hidden"}`}
              aria-hidden={view !== "shelf"}
            >
              <BookshelfPage
                visible={view === "shelf"}
                onOpenWork={openWork}
                importRequest={importRequest}
                onImportRequestConsumed={consumeImportRequest}
              />
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
                  onImportBook={requestImport}
                  visible={view === "editor"}
                  onGoToView={goToView}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <HelpCenter
        open={helpOpen}
        doc={NOVEL_HELP_DOC}
        onClose={closeHelp}
        onReplayGuide={handleReplayGuide}
        guideDone={guideDone}
      />
    </AntdApp>
  );
}
