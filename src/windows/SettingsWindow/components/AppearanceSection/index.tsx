import ThemeSwitcher from "@/shared/components/ThemeSwitcher";

/** 外观分区：主题色切换（经既有广播机制全窗口同步换肤） */
export default function AppearanceSection() {
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
