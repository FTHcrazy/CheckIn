import { Button, Card, Typography, Result } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Paragraph } = Typography

export default function TypeScriptPage() {
  const navigate = useNavigate()

  return (
    <div className="app-container">
      <main className="app-content">
        <Card>
          <Result
            icon={<CodeOutlined style={{ color: '#fa8c16' }} />}
            title="TypeScript 类型安全"
            subTitle="完整的 TypeScript 支持，提升开发效率"
            extra={[
              <Button key="back" onClick={() => navigate('/')}>
                返回首页
              </Button>,
            ]}
          />
          <Paragraph>
            TypeScript 是 JavaScript 的超集，添加了静态类型检查。
            它能在编译时发现潜在错误，提供更好的 IDE 支持，并让代码更易于维护和理解。
          </Paragraph>
          <Paragraph>
            <ul>
              <li>静态类型检查：编译时捕获类型错误</li>
              <li>智能提示：IDE 自动补全和代码导航</li>
              <li>重构安全：类型系统保障重构正确性</li>
              <li>渐进式采用：可与 JavaScript 混合使用</li>
            </ul>
          </Paragraph>
        </Card>
      </main>
    </div>
  )
}
