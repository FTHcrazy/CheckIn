import { SettingOutlined } from "@ant-design/icons";
import "./index.scss";

/**
 * BaseWindow 标题栏「设置」入口。
 *
 * 点击后经主进程唤起全局 SettingsWindow（单实例：已开则聚焦）。
 * 仅作为 WindowHeader 的 actions 插槽使用，不承载任何设置逻辑本身。
 */
export default function SettingsEntry() {
  return (
    <button
      type="button"
      className="settings-entry"
      title="设置"
      aria-label="打开设置"
      onClick={() => window.electronAPI?.send("settings-window-open", null)}
    >
      <SettingOutlined className="settings-entry__icon" />
    </button>
  );
}
