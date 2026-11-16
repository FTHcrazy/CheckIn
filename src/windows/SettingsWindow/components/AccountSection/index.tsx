import { UserOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useAccountSession } from "../../hooks/useAccountSession";

/**
 * 账号分区：当前登录邮箱展示 + 退出登录。
 *
 * 危险动作按钮用组件库 `Button` 承载（AGENTS §6.1.2：禁止原生 `<button>`），
 * 造型走窗口级原语 `settings-btn--danger`（清零点 + 组件变量写在同一个
 * `.xxx.ant-btn` 选择器里）—— 原生按钮在暗色主题下不跟随 antd 的 darkAlgorithm，
 * 也没有组件库给的焦点环与禁用语义。
 *
 * 这一页没有「保存」：退出登录是动作不是配置，所以**不放底部操作条**，
 * 危险动作留在行内，避免常驻条被误点。
 */
export default function AccountSection() {
  const { email, handleLogout } = useAccountSession();

  return (
    <section className="settings-section">
      <div className="settings-section__body">
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">
              <UserOutlined className="settings-item__icon" />
              {email ?? "未登录"}
            </span>
            <span className="settings-item__hint">退出后需重新登录才能继续使用</span>
          </div>
          <Button className="settings-btn settings-btn--danger" onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </div>
    </section>
  );
}
