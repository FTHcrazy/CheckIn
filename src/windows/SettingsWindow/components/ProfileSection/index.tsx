import { Alert, App, Button, Form, Input } from "antd";
import { useProfileForm } from "../../hooks/useProfileForm";
import "./index.scss";

/** 个人资料分区：修改用户邮箱（自 BaseWindow UserPage 迁移） */
export default function ProfileSection() {
  const { message } = App.useApp();
  const { form, loading, initializing, error, handleSubmit } = useProfileForm();

  const onFinish = async (values: { email: string }) => {
    const saved = await handleSubmit(values);
    if (saved) {
      message.success("用户信息已保存");
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">个人资料</h2>
      <div className="settings-section__body">
        <div className="settings-profile">
          {error ? <Alert type="error" showIcon message={error} /> : null}

          <Form form={form} layout="vertical" onFinish={onFinish}>
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

            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading || initializing} block>
                保存
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </section>
  );
}
