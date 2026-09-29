import { useEffect, useState } from "react";

/**
 * 账号区逻辑：展示当前登录邮箱 + 退出登录动作。
 * 退出编排由主进程完成（auth-logout），这里只负责触发。
 */
export function useAccountSession() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.user
      .get()
      .then((user) => {
        if (!cancelled) setEmail(user?.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    // 主进程负责编排：清除缓存用户 → 销毁主窗/设置窗 → 回到登录窗
    window.electronAPI?.send("auth-logout", null);
  };

  return { email, handleLogout };
}
