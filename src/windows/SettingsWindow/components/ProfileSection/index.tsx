import { Alert, App, Button, Form, Input } from "antd";
import { useProfileForm } from "../../hooks/useProfileForm";
import SettingsActionBar from "../SettingsActionBar";
import "./index.scss";

/**
 * 个人资料分区：修改用户邮箱（自 BaseWindow UserPage 迁移）。
 *
 * 表单宽度收在 400px 内：邮箱是很短的字段，铺满卡片会让「输入框」比「要填的
 * 内容」宽一倍，反而不知道该填多少。
 *
 * 保存按钮已从表单里移到页面底部操作条（与 AI 配置页同一范式）：卡片里不再
 * 挂按钮，**没有改动时按钮是灰的**，用户不用猜「点了会不会重复提交」。
 * 表单本身仍由 `form.submit()` 触发，校验规则照旧生效。
 */
export default function ProfileSection() {
  const { message } = App.useApp();
  const { form, loading, initializing, initialEmail, error, handleSubmit } = useProfileForm();

  /**
   * 邮箱当前值：用 `Form.useWatch` 而不是受控 state，避免表单值与组件 state
   * 两份真相。它也是「有没有改过」的唯一判据（见 useProfileForm 的说明）。
   */
  const email = Form.useWatch<string>("email", form);
  const isDirty = !initializing && (email ?? "").trim() !== initialEmail.trim();

  const onFinish = async (values: { email: string }) => {
    const saved = await handleSubmit(values);
    if (saved) {
      message.success("已保存");
    }
  };

  return (
    <>
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
            </Form>
          </div>
        </div>
      </section>

      <SettingsActionBar state={initializing ? undefined : isDirty ? "dirty" : "saved"}>
        {/* 只让「保存中」转圈；初始载入用禁用表示还没准备好，两件事不该长一样 */}
        <Button
          className="settings-btn--primary"
          type="primary"
          loading={loading}
          disabled={initializing || !isDirty}
          onClick={() => form.submit()}
        >
          保存
        </Button>
      </SettingsActionBar>
    </>
  );
}
