import { Button, Card, Typography, Result } from 'antd'
import { RocketOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Paragraph } = Typography

export default function ElectronPage() {
  const navigate = useNavigate()

  return (
    <div className="app-container">
      <main className="app-content">
        <Card>
          <Result
            icon={<RocketOutlined style={{ color: '#52c41a' }} />}
            title="Electron 桌面应用"
            subTitle="使用 Electron 构建跨平台桌面应用"
            extra={[
              <Button key="back" onClick={() => navigate('/')}>
                返回首页
              </Button>,
            ]}
          />
          <Paragraph>
            Electron 使用 Web 技术（HTML、CSS、JavaScript）构建跨平台桌面应用。
            它结合了 Chromium 渲染引擎和 Node.js 运行时，让你可以用前端技术开发原生桌面应用。
          </Paragraph>
          <Paragraph>
            <ul>
              <li>跨平台：支持 Windows、macOS、Linux</li>
              <li>原生能力：文件系统、系统通知、托盘图标等</li>
              <li>自动更新：内置应用更新机制</li>
              <li>丰富的 API：IPC 通信、原生菜单、快捷键等</li>
            </ul>
          </Paragraph>
        </Card>
      </main>
    </div>
  )
}
