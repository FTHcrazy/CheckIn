import { useEffect, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import {
  Card,
  ConfigProvider,
  theme,
  Typography,
  Space,
  Tag,
  notification,
  App as AntdApp,
} from "antd";
import {
  ThunderboltOutlined,
  RocketOutlined,
  ClockCircleOutlined,
  UserOutlined,
  EditOutlined,
  CheckSquareOutlined,
} from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import "./styles/App.scss";

import DailyPage from "./pages/DailyPage/DailyPage";
import CodePage from "./pages/CodePage/CodePage";
import UserPage from "./pages/UserPage";
import MemoPage from "./pages/MemoPage/MemoPage";
import TodoPage from "./pages/TodoPage/TodoPage";

const { Title, Text } = Typography;

// ── 全局 IPC 注册（模块加载时只执行一次） ──
interface ActivityNotifyData {
  name: string;
  start: string;
  end: string;
  color: string;
}

window.electronAPI?.receive("activity-notify", (data: unknown) => {
  console.log("[IPC] 收到活动通知，派发事件");
  window.dispatchEvent(
    new CustomEvent("activity-notify", { detail: data as ActivityNotifyData }),
  );
});

function Home() {
  const navigate = useNavigate();

  const features = [
    {
      icon: <ThunderboltOutlined />,
      title: "日期活动",
      desc: "记得打卡",
      path: "/daily",
    },
    {
      icon: <RocketOutlined />,
      title: "代码记录查看",
      desc: "计算日代码行",
      path: "/code",
    },
    {
      icon: <EditOutlined />,
      title: "备忘列表",
      desc: "新增和编辑 Markdown 备忘文件",
      path: "/memo",
    },
    {
      icon: <CheckSquareOutlined />,
      title: "TODO LIST",
      desc: "待办事项管理，支持子任务",
      path: "/todo",
    },
    {
      icon: <UserOutlined />,
      title: "修改用户信息",
      desc: "修改邮箱并同步到本地",
      path: "/user",
    },
  ];

  return (
    <div className="app-container">
      <header className="app-header">
        <Space size="middle">
          <span className="logo">CheckIn</span>
          <Tag color="blue">Electron</Tag>
          <Tag color="green">React</Tag>
          <Tag color="purple">TypeScript</Tag>
        </Space>
      </header>

      <main className="app-content">
        <div className="feature-grid">
          {features.map((feature) => (
            <Card
              key={feature.path}
              className="feature-card"
              hoverable
              onClick={() => navigate(feature.path)}
            >
              <div className="feature-icon">{feature.icon}</div>
              <Title level={4} className="feature-title">
                {feature.title}
              </Title>
              <Text type="secondary" className="feature-desc">
                {feature.desc}
              </Text>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

/** 全局活动通知监听 */
function ActivityNotifier() {
  const navigate = useNavigate();
  const [api, contextHolder] = notification.useNotification();
  const apiRef = useRef(api);
  const navRef = useRef(navigate);
  apiRef.current = api;
  navRef.current = navigate;

  useEffect(() => {
    const handler = (e: Event) => {
      const { name, start, end, color } = (e as CustomEvent).detail as {
        name: string;
        start: string;
        end: string;
        color: string;
      };
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
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
        },
      }}
    >
      <AntdApp>
        <ActivityNotifier />
        <Routes>
          <Route path="/" element={<Home />} />
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
