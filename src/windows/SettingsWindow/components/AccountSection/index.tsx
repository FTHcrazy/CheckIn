import { UserOutlined } from "@ant-design/icons";
import { useAccountSession } from "../../hooks/useAccountSession";
import "./index.scss";

/** 账号分区：当前登录邮箱展示 + 退出登录 */
export default function AccountSection() {
  const { email, handleLogout } = useAccountSession();

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
