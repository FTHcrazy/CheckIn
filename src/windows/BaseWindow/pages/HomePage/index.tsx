import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BorderBeam, Card, Space, Tag, Typography } from "antd";
import {
  ThunderboltOutlined,
  RocketOutlined,
  UserOutlined,
  EditOutlined,
  CheckSquareOutlined,
} from "@ant-design/icons";
import "./index.scss";

const { Title, Text } = Typography;

interface Feature {
  icon: ReactNode;
  title: string;
  desc: string;
  path: string;
}

const features: Feature[] = [
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

export default function HomePage() {
  const navigate = useNavigate();

  // BorderBeam 是持续运行的 CSS 动画，5 张卡片常驻会让页面一直占用合成线程。
  // 改为指针进入卡片时才挂载，指针离开即卸载，空闲时页面零动画开销。
  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    const beam = event.currentTarget.querySelector<HTMLElement>(".ant-border-beam");
    if (!beam) return;
    beam.style.animationPlayState = "running";
    beam.style.opacity = "1";
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    const beam = event.currentTarget.querySelector<HTMLElement>(".ant-border-beam");
    if (!beam) return;
    beam.style.animationPlayState = "paused";
    beam.style.opacity = "0";
  };

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
            <BorderBeam
              key={feature.path}
              count={2}
              lineWidth={2}
              color={[
                { color: "#2f54eb", percent: 0 },
                { color: "#722ed1", percent: 44 },
                { color: "#ff85c0", percent: 100 },
              ]}
            >
              <Card
                className="feature-card"
                hoverable
                onClick={() => navigate(feature.path)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
              >
                <div className="feature-icon">{feature.icon}</div>
                <Title level={4} className="feature-title">
                  {feature.title}
                </Title>
                <Text type="secondary" className="feature-desc">
                  {feature.desc}
                </Text>
              </Card>
            </BorderBeam>
          ))}
        </div>
      </main>
    </div>
  );
}
