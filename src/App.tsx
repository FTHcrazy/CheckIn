import { useState } from 'react'
import { Button, Card, ConfigProvider, theme, Typography, Space, Tag } from 'antd'
import {
  ThunderboltOutlined,
  RocketOutlined,
  ToolOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import './styles/App.scss'

const { Title, Text, Paragraph } = Typography

function App() {
  const [count, setCount] = useState(0)

  const features = [
    {
      icon: <ThunderboltOutlined />,
      title: 'Vite 极速构建',
      desc: '基于 Vite 的闪电般开发体验，HMR 即时生效',
    },
    {
      icon: <RocketOutlined />,
      title: 'Electron 桌面应用',
      desc: '使用 Electron 构建跨平台桌面应用',
    },
    {
      icon: <ToolOutlined />,
      title: 'Ant Design 组件',
      desc: '丰富的企业级 UI 组件库，开箱即用',
    },
    {
      icon: <CodeOutlined />,
      title: 'TypeScript 类型安全',
      desc: '完整的 TypeScript 支持，提升开发效率',
    },
  ]

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
      }}
    >
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
          <Card className="welcome-card">
            <Title level={2} className="welcome-title">
              欢迎使用 CheckIn 桌面应用
            </Title>
            <Paragraph className="welcome-desc">
              这是一个基于 Electron + React + TypeScript + Ant Design + SCSS
              构建的桌面应用程序模板。
              你可以在此基础上开发你的桌面应用功能。
            </Paragraph>
            <Space size="middle">
              <Button type="primary" size="large" onClick={() => setCount((c) => c + 1)}>
                点击计数: {count}
              </Button>
              <Button size="large">次要按钮</Button>
            </Space>
          </Card>

          <div className="feature-grid">
            {features.map((feature, index) => (
              <Card key={index} className="feature-card" hoverable>
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
    </ConfigProvider>
  )
}

export default App
