import { useEffect, useState } from "react";
import { Form } from "antd";

interface ProfileFormValues {
  email: string;
}

/**
 * 个人资料表单逻辑（原 BaseWindow UserPage 逻辑迁移）：
 * 载入当前用户邮箱 → 提交更新，组件只保留渲染职责。
 */
export function useProfileForm() {
  const [form] = Form.useForm<ProfileFormValues>();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadUser = async () => {
      try {
        const user = await window.electronAPI?.user.get();

        if (!cancelled) {
          form.setFieldsValue({ email: user?.email ?? "" });
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

      await window.electronAPI.user.update(values.email.trim());

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { form, loading, initializing, error, handleSubmit };
}
