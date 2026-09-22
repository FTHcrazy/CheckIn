import { lazy, Suspense, useEffect, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { notification, App as AntdApp, Spin } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { ThemeProvider } from "@/shared/theme";
import type { ActivityNotifyData } from "@/shared/ipc/activityNotifyBridge";
import WindowHeader from "@/shared/components/WindowHeader";
import HomePage from "./pages/HomePage";
import "./app-routes.scss";

// 路由级懒加载：首屏只加载 HomePage，其余页面在跳转时按需拉取，
// 避免开发模式下全量模块预转换/生产模式首屏 chunk 过大导致的卡顿。
const DailyPage = lazy(() => import("./pages/DailyPage/DailyPage"));
const CodePage = lazy(() => import("./pages/CodePage/CodePage"));
const UserPage = lazy(() => import("./pages/UserPage/UserPage"));
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

export default function App() {
  return (
    // ThemeProvider 内部已包含 ConfigProvider，并额外负责 data-theme 落盘与跨窗口同步
    <ThemeProvider>
      <AntdApp>
        {/* 圆角窗口外壳：负责圆角裁剪与描边，内容全部装在其中 */}
        <div className="window-shell">
          {/* 窗口级标题栏：拖动区 + 最小化/最大化/关闭，替代 NavHeader 的窗口职责 */}
          <WindowHeader />
          <div className="window-shell__body">
            <ActivityNotifier />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/daily" element={<DailyPage />} />
                <Route path="/code" element={<CodePage />} />
                <Route path="/user" element={<UserPage />} />
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
