import ThemeSwitcher from "@/shared/components/ThemeSwitcher";

/**
 * 外观分区：主题色切换（经既有广播机制全窗口同步换肤）。
 *
 * 不再自带分区标题条 —— 改版后每页有固定的页头（见 App.tsx 的
 * `settings-page__head`），卡片里再写一遍「外观」就是同一句话说两次。
 * 卡片只负责承载那一行设置。
 */
export default function AppearanceSection() {
  return (
    <section className="settings-section">
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
