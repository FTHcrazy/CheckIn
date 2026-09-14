import { useEffect, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import {
  ConfigProvider,
  notification,
  App as AntdApp,
} from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { antdProviderProps } from "@/shared/styles/antd-theme";
import type { ActivityNotifyData } from "@/shared/ipc/activityNotifyBridge";
import HomePage from "./pages/HomePage";
import DailyPage from "./pages/DailyPage/DailyPage";
import CodePage from "./pages/CodePage/CodePage";
import UserPage from "./pages/UserPage/UserPage";
import MemoPage from "./pages/MemoPage/MemoPage";
import TodoPage from "./pages/TodoPage/TodoPage";

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
      console.log("[App] 收到活动通知:", name);
      navRef.current("/daily");
      apiRef.current.info({
        message: "活动提醒",
        description: `${name} (${start} - ${end})`,
        icon: <ClockCircleOutlined style={{ color: color || "#1677ff" }} />,
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
    <ConfigProvider {...antdProviderProps}>
      <AntdApp>
        <ActivityNotifier />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/code" element={<CodePage />} />
          <Route path="/user" element={<UserPage />} />
          <Route path="/memo" element={<MemoPage />} />
          <Route path="/todo" element={<TodoPage />} />
        </Routes>
      </AntdApp>
    </ConfigProvider>
  );
}
