import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';

type LoginFormValues = {
  email: string;
};

function getInitialEmail() {
  const params = new URLSearchParams(window.location.search);
  return params.get('email') ?? '';
}

export function LoginWindowApp() {
  const [form] = Form.useForm<LoginFormValues>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const initialEmail = getInitialEmail();
  const isWelcomeMode = Boolean(initialEmail);

  useEffect(() => {
    if (!isWelcomeMode) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.electronAPI?.send('toMain', { type: 'user-login-confirmed', email: initialEmail });
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [initialEmail, isWelcomeMode]);

  const handleSubmit = async (values: LoginFormValues) => {
    const email = values.email.trim();
    setLoading(true);
    setError('');

    try {
      if (!window.electronAPI?.db.run) {
        throw new Error('当前环境不可用，请稍后重试');
      }

      await window.electronAPI.db.run(
        "INSERT INTO user (id, email, updated_at) VALUES (1, ?, datetime('now', 'localtime')) ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = datetime('now', 'localtime')",
        [email],
      );

      window.electronAPI.send('toMain', { type: 'user-login-confirmed', email });
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    }
  };

  return (
    <div className="login-window">
      <Card className="login-card" bordered={false}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="login-header">
            <Typography.Title level={3} className="login-title">
              {isWelcomeMode ? '欢迎回来' : '登录 CheckIn'}
            </Typography.Title>
            <Typography.Text type="secondary">
              {isWelcomeMode ? '已登录账号' : '请输入用户邮箱，确认后将进入主窗口。'}
            </Typography.Text>
          </div>

          {isWelcomeMode ? (
            <div className="welcome-state">
              <MailOutlined className="welcome-icon" />
              <Typography.Text className="welcome-email">{initialEmail}</Typography.Text>
            </div>
          ) : (
            <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
              <Form.Item
                label="邮箱"
                name="email"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '请输入有效的邮箱地址' },
                ]}
              >
                <Input autoFocus allowClear placeholder="name@example.com" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  确认
                </Button>
              </Form.Item>
              {error ? <Alert type="error" showIcon message={error} /> : null}
            </Form>
          )}
        </Space>
      </Card>
    </div>
  );
}
