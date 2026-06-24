import { Button, Card, Typography, Result } from 'antd'
import { ToolOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Paragraph } = Typography

export default function AntdPage() {
  const navigate = useNavigate()

  return (
    <div className="app-container">
      <main className="app-content">
        <Card>
          <Result
            icon={<ToolOutlined style={{ color: '#722ed1' }} />}
            title="Ant Design 组件"
            subTitle="丰富的企业级 UI 组件库，开箱即用"
            extra={[
              <Button key="back" onClick={() => navigate('/')}>
                返回首页
              </Button>,
            ]}
          />
          <Paragraph>
            Ant Design 是蚂蚁集团出品的企业级 UI 设计语言和 React 组件库。
            提供了一套完整的设计规范和高品质的组件实现，广泛应用于中后台产品。
          </Paragraph>
          <Paragraph>
            <ul>
              <li>80+ 高质量组件：表单、表格、图表、导航等</li>
              <li>完善的设计规范：统一的视觉语言和交互体验</li>
              <li>国际化支持：多语言语言包</li>
              <li>主题定制：灵活的 Design Token 系统</li>
            </ul>
          </Paragraph>
        </Card>
      </main>
    </div>
  )
}
