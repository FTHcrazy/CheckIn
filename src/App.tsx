import { Routes, Route, useNavigate } from "react-router-dom";
import { Card, ConfigProvider, theme, Typography, Space, Tag } from "antd";
import { ThunderboltOutlined, RocketOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import "./styles/App.scss";

import DailyPage from "./pages/DailyPage";
import CodePage from "./pages/CodePage";

const { Title, Text } = Typography;

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
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/daily" element={<DailyPage />} />
        <Route path="/code" element={<CodePage />} />
      </Routes>
    </ConfigProvider>
  );
}
