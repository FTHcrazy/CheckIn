import { SettingOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import AppearanceSection from "./components/AppearanceSection";
import ProfileSection from "./components/ProfileSection";
import AccountSection from "./components/AccountSection";

/**
 * SettingsWindow —— 全局设置窗口（全版本开放入口）。
 *
 * 即关即销：所有设置项即时生效（主题经 localStorage + 跨窗口广播同步，
 * 账号操作直接走 IPC），窗口本身不持有任何需要保存的草稿状态。
 *
 * 本文件只做窗口壳组装（标题栏 + 分区清单），分区逻辑与样式各自归位：
 * - components/AppearanceSection  外观（主题色）
 * - components/ProfileSection     个人资料（邮箱编辑，原 BaseWindow UserPage 迁移）
 * - components/AccountSection     账号（邮箱展示 / 退出登录）
 * - hooks/useProfileForm          表单逻辑
 * - hooks/useAccountSession       会话展示与退出动作
 *
 * 后续新增设置（字体 / 快捷键等）按「一个 section 组件 + 一个 hook」增量追加。
 */
export default function SettingsWindowApp() {
  return (
    <div className="window-shell">
      <WindowHeader title="设置" icon={<SettingOutlined />} />
      <div className="window-shell__body">
        <div className="settings-page">
          <AppearanceSection />
          <ProfileSection />
          <AccountSection />
        </div>
      </div>
    </div>
  );
}
