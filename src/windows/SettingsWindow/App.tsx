import { SettingOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import { IS_NOVEL_EDITION } from "@/shared/edition";
import AppearanceSection from "./components/AppearanceSection";
import ProfileSection from "./components/ProfileSection";
import AccountSection from "./components/AccountSection";
import ShortcutSection from "./components/ShortcutSection";
import DiagnosticSection from "./components/DiagnosticSection";

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
 * - components/ShortcutSection    快捷键（**仅开发版与小说版**，见下方门控）
 * - components/DiagnosticSection  诊断（本地日志级别 / 打开日志目录）
 * - hooks/useProfileForm          表单逻辑
 * - hooks/useAccountSession       会话展示与退出动作
 *
 * 快捷键分区的门控规则（1.47.0，需求明确）：只有 **dev 构建** 或 **novel 版**
 * 才展示。full / lite 正式版里小说窗口是主窗的一个子窗口，快捷键属专家配置，
 * 不该在通用设置里占主位；主进程侧的应用级快捷键注册用同一套判定
 * （`electron/handlers/shortcut-handlers.ts` 的 `SHORTCUTS_ENABLED`）。
 */
const SHOW_SHORTCUTS = import.meta.env.DEV || IS_NOVEL_EDITION;

export default function SettingsWindowApp() {
  return (
    <div className="window-shell">
      <WindowHeader title="设置" icon={<SettingOutlined />} />
      <div className="window-shell__body">
        <div className="settings-page">
          <AppearanceSection />
          {SHOW_SHORTCUTS ? <ShortcutSection /> : null}
          <ProfileSection />
          <AccountSection />
          <DiagnosticSection />
        </div>
      </div>
    </div>
  );
}
