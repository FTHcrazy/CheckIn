import type { ReactNode } from "react";
import { Button } from "antd";
import "./index.scss";

/** 导航项：id 与 App.tsx 的页面 id 同源，避免两处各写一份字符串 */
export interface SettingsNavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

/** 导航分组：「通用 / 账户 / 高级」三段，把 6 个入口读成三层而不是一长条 */
export interface SettingsNavGroup {
  title: string;
  items: SettingsNavItem[];
}

interface SettingsNavProps {
  groups: SettingsNavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * 设置窗口左栏：分组导航（窗口私有组件）。
 *
 * 为什么从「单列长滚动」改成左栏导航：
 * 1. 6 个分区纵向堆叠时总高度远超窗口，用户要滚半天才知道有哪些设置项，
 *    而且滚动位置与「我在改哪一类」没有关系 —— 导航把「去哪」与「改什么」分开；
 * 2. AI 配置页内容天生比其它页长（服务商 / 地址 / 模型 / Key / 高级参数），
 *    混在同一条流里会把后半截设置项挤到几千像素之外；
 * 3. 固定尺寸窗口（900×680）下，只有「左栏固定 + 右栏各自滚动」能同时保证
 *    导航永远可见、页面内容不溢出。
 *
 * 无障碍：`<nav>` 语义 + `aria-current="page"` 标当前页；键盘走原生 Tab，
 * 每颗都是 antd Button（复用 focus 环与禁用语义），造型靠 `ant-button-reset` 清零。
 */
export default function SettingsNav({ groups, activeId, onSelect }: SettingsNavProps) {
  return (
    <nav className="settings-nav" aria-label="设置分类">
      {groups.map((group) => (
        <div className="settings-nav__group" key={group.title}>
          <div className="settings-nav__group-title">{group.title}</div>
          {group.items.map((item) => {
            const active = item.id === activeId;
            return (
              <Button
                key={item.id}
                className={`settings-nav__item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span className="settings-nav__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="settings-nav__label">{item.label}</span>
              </Button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
