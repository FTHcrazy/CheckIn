import { useEffect, useState } from "react";
import { Alert, Button, Card, Form, Input, Space, Typography, message } from "antd";
import Page from "../../components/Page";

interface UserRecord {
  email?: string;
}

function UserPage() {
  const [form] = Form.useForm<{ email: string }>();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadUser = async () => {
      try {
        const user = (await window.electronAPI?.db.get(
          "SELECT email FROM user WHERE id = 1 LIMIT 1",
        )) as UserRecord | undefined;

        form.setFieldsValue({ email: user?.email ?? "" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载用户信息失败");
      } finally {
        setInitializing(false);
      }
    };

    void loadUser();
  }, [form]);

  const handleSubmit = async (values: { email: string }) => {
    const email = values.email.trim();
    setLoading(true);
    setError("");

    try {
      if (!window.electronAPI?.db.run) {
        throw new Error("当前环境不可用，请稍后重试");
      }

      await window.electronAPI.db.run(
        "UPDATE user SET email = ?, updated_at = datetime('now', 'localtime') WHERE id = 1",
        [email],
      );

      message.success("用户信息已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page>
      <div style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
        <Card title="修改用户信息" variant="borderless">
          <Space orientation="vertical" size="large" style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary">
              这里可以修改当前用户的邮箱信息，保存后会同步到本地的 user 表。
            </Typography.Paragraph>

            {error ? <Alert type="error" showIcon message={error} /> : null}

            <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
              <Form.Item
                label="邮箱"
                name="email"
                rules={[
                  { required: true, message: "请输入邮箱" },
                  { type: "email", message: "请输入有效的邮箱地址" },
                ]}
              >
                <Input placeholder="name@example.com" allowClear />
              </Form.Item>

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading || initializing} block>
                  保存
                </Button>
              </Form.Item>
            </Form>
          </Space>
        </Card>
      </div>
    </Page>
  );
}

export default UserPage;
