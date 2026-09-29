import { useEffect, useState } from "react";
import { SettingOutlined, UserOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import ThemeSwitcher from "@/shared/components/ThemeSwitcher";
import "./index.scss";

/**
 * SettingsWindow —— 全局设置窗口（当前仅 novel 版构建并开放入口）。
 *
 * 即关即销：所有设置项即时生效（主题经 localStorage + 跨窗口广播同步，
 * 账号操作直接走 IPC），窗口本身不持有任何需要保存的草稿状态。
 *
 * 条目采用分区结构，后续新增设置（字体 / 快捷键等）按「一个 section +
 * 一个条目组件」增量追加，不动窗口骨架。
 */

function AppearanceSection() {
  return (
    <section className="settings-section">
      <h2 className="settings-section__title">外观</h2>
      <div className="settings-section__body">
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">主题色</span>
            <span className="settings-item__hint">所有窗口实时同步换肤</span>
          </div>
          <ThemeSwitcher variant="button" placement="left" />
        </div>
      </div>
    </section>
  );
}

function AccountSection() {
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

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">账号</h2>
      <div className="settings-section__body">
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">
              <UserOutlined className="settings-item__icon" />
              {email ?? "未登录"}
            </span>
            <span className="settings-item__hint">退出后需重新登录才能继续使用</span>
          </div>
          <button
            type="button"
            className="settings-item__action settings-item__action--danger"
            onClick={handleLogout}
          >
            退出登录
          </button>
        </div>
      </div>
    </section>
  );
}

export default function SettingsWindowApp() {
  return (
    <div className="window-shell">
      <WindowHeader title="设置" icon={<SettingOutlined />} />
      <div className="window-shell__body">
        <div className="settings-page">
          <AppearanceSection />
          <AccountSection />
        </div>
      </div>
    </div>
  );
}
