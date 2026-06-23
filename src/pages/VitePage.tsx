import { Button, Card, Typography, Result } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Title, Paragraph } = Typography

export default function VitePage() {
  const navigate = useNavigate()

  return (
    <div className="app-container">
      <main className="app-content">
        <Card>
          <Result
            icon={<ThunderboltOutlined style={{ color: '#1677ff' }} />}
            title="Vite 极速构建"
            subTitle="基于 Vite 的闪电般开发体验，HMR 即时生效"
            extra={[
              <Button key="back" onClick={() => navigate('/')}>
                返回首页
              </Button>,
            ]}
          />
          <Paragraph>
            Vite 是一个下一代前端构建工具，利用原生 ES 模块实现极速冷启动和即时热更新。
            在开发模式下，Vite 按需编译模块，无需打包整个应用，启动速度远超传统构建工具。
          </Paragraph>
          <Paragraph>
            <ul>
              <li>极速冷启动：基于原生 ESM，无需打包</li>
              <li>即时 HMR：模块级别的热更新，毫秒级响应</li>
              <li>丰富的插件生态：兼容 Rollup 插件</li>
              <li>优化的构建产物：基于 Rollup 的生产构建</li>
            </ul>
          </Paragraph>
        </Card>
      </main>
    </div>
  )
}
