import { lazy, Suspense, useEffect, useRef } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { notification, App as AntdApp, Spin } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { ThemeProvider } from "@/shared/theme";
import type { ActivityNotifyData } from "@/shared/ipc/activityNotifyBridge";
import WindowHeader from "@/shared/components/WindowHeader";
import HeaderNav from "./components/HeaderNav";
import SettingsEntry from "./components/SettingsEntry";
import MapEntry from "./components/MapEntry";
import HomePage from "./pages/HomePage";
import "./app-routes.scss";

// 路由级懒加载：首屏只加载 HomePage，其余页面在跳转时按需拉取，
// 避免开发模式下全量模块预转换/生产模式首屏 chunk 过大导致的卡顿。
const DailyPage = lazy(() => import("./pages/DailyPage/DailyPage"));
const CodePage = lazy(() => import("./pages/CodePage/CodePage"));
const MemoPage = lazy(() => import("./pages/MemoPage/MemoPage"));
const TodoPage = lazy(() => import("./pages/TodoPage/TodoPage"));
const NewsPage = lazy(() => import("./pages/NewsPage/NewsPage"));
const LedgerPage = lazy(() => import("./pages/LedgerPage/LedgerPage"));

/** 懒加载路由的占位，保持与页面一致的高度避免布局跳动 */
function RouteFallback() {
  return (
    <div className="app-route-fallback">
      <Spin size="large" />
    </div>
  );
}

/** 全局活动通知监听 */
function ActivityNotifier() {
  const navigate = useNavigate();
  const [api, contextHolder] = notification.useNotification();
  const apiRef = useRef(api);
  const navRef = useRef(navigate);

  useEffect(() => {
    apiRef.current = api;
    navRef.current = navigate;
  }, [api, navigate]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { name, start, end, color } =
        (e as CustomEvent).detail as ActivityNotifyData;
      navRef.current("/daily");
      apiRef.current.info({
        message: "活动提醒",
        description: `${name} (${start} - ${end})`,
        icon: (
          <ClockCircleOutlined
            style={{ color: color || "var(--app-primary)" }}
          />
        ),
        placement: "topRight",
        duration: 30,
      });
    };
    window.addEventListener("activity-notify", handler);
    return () => window.removeEventListener("activity-notify", handler);
  }, []);

  return <>{contextHolder}</>;
}

/**
 * 子页面在窗口标题栏左侧显示的名称（**与下方 Routes 一一对应，
 * 新增路由时要同步补一行**，缺了只是标题栏不显示名称，不会报错）。
 * 命名对齐首页侧栏与功能卡，避免同一页面出现两个叫法。
 */
const PAGE_TITLES: Record<string, string> = {
  "/todo": "待办清单",
  "/daily": "日期活动",
  "/memo": "备忘笔记",
  "/ledger": "记账本",
  "/code": "代码记录",
  "/news": "资讯",
};

/**
 * 主窗标题栏。
 *
 * 左侧 `leading`：返回入口 + 当前页面名称，回首页时不给——首页既没有上一页，
 * 也不需要「我在哪」的提示，摆上去只会制造无效点击；右侧 `actions`：地图与
 * 全局设置入口（分别唤起 MapWindow / SettingsWindow，均单实例）。
 * 路由判定留在窗口层——WindowHeader 被多个窗口共用，其中有些并不挂 Router。
 */
function BaseWindowHeader() {
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname];

  return (
    <WindowHeader
      leading={title ? <HeaderNav title={title} /> : null}
      actions={
        <>
          <MapEntry />
          <SettingsEntry />
        </>
      }
    />
  );
}

export default function App() {
  return (
    // ThemeProvider 内部已包含 ConfigProvider，并额外负责 data-theme 落盘与跨窗口同步
    <ThemeProvider>
      <AntdApp>
        {/* 圆角窗口外壳：负责圆角裁剪与描边，内容全部装在其中 */}
        <div className="window-shell">
          {/* 窗口级标题栏：拖动区 + 最小化/最大化/关闭 + 左侧返回入口与右侧设置入口。
              页内不再保留任何顶部导航条，纵向空间全部还给内容区 */}
          <BaseWindowHeader />
          <div className="window-shell__body">
            <ActivityNotifier />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/daily" element={<DailyPage />} />
                <Route path="/code" element={<CodePage />} />
                <Route path="/memo" element={<MemoPage />} />
                <Route path="/todo" element={<TodoPage />} />
                <Route path="/news" element={<NewsPage />} />
                <Route path="/ledger" element={<LedgerPage />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      </AntdApp>
    </ThemeProvider>
  );
}
