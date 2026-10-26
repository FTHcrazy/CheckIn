import { Alert, App, Button, Form, Input } from "antd";
import { useProfileForm } from "../../hooks/useProfileForm";
import "./index.scss";

/**
 * 个人资料分区：修改用户邮箱（自 BaseWindow UserPage 迁移）。
 *
 * 表单宽度收在 400px 内：邮箱是很短的字段，铺满 640px 的卡片会让「输入框」
 * 比「要填的内容」宽一倍，反而不知道该填多少。保存按钮跟在字段下方左对齐，
 * 不再用 block 铺满整行（改版后卡片变宽，整行按钮会像一条色带）。
 */
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
      <div className="settings-section__body">
        <div className="settings-profile">
          {error ? <Alert type="error" showIcon message={error} /> : null}

          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            disabled={initializing}
            className="settings-profile__form"
          >
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
              {/* 只让「保存中」转圈；初始载入用禁用表示还没准备好，两件事不该长一样 */}
              <Button type="primary" htmlType="submit" loading={loading} disabled={initializing}>
                保存
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </section>
  );
}
