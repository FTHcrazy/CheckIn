import { useEffect, useState } from "react";
import { Form } from "antd";

interface ProfileFormValues {
  email: string;
}

/**
 * 个人资料表单逻辑（原 BaseWindow UserPage 逻辑迁移）：
 * 载入当前用户邮箱 → 提交更新，组件只保留渲染职责。
 *
 * 额外记录 `initialEmail`（**已落库**的邮箱）：底部操作条要靠它判断「有没有改过」。
 * 用值比较而不是 `form.isFieldsTouched()` —— 用户改了又改回去时 touched 仍为真，
 * 会出现「一个字没变但保存按钮亮着」的假脏状态。
 */
export function useProfileForm() {
  const [form] = Form.useForm<ProfileFormValues>();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initialEmail, setInitialEmail] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadUser = async () => {
      try {
        const user = await window.electronAPI?.user.get();

        if (!cancelled) {
          const email = user?.email ?? "";
          form.setFieldsValue({ email });
          setInitialEmail(email);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载用户信息失败");
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };

    void loadUser();
    return () => {
      cancelled = true;
    };
  }, [form]);

  const handleSubmit = async (values: ProfileFormValues) => {
    setLoading(true);
    setError("");

    try {
      if (!window.electronAPI?.user.update) {
        throw new Error("当前环境不可用，请稍后重试");
      }

      const email = values.email.trim();
      await window.electronAPI.user.update(email);
      // 保存成功即成为新的基线，状态点随之从「有未保存的更改」回到「已保存」
      setInitialEmail(email);
      form.setFieldsValue({ email });

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { form, loading, initializing, initialEmail, error, handleSubmit };
}
