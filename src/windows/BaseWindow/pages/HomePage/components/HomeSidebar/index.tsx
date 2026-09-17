import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CalendarOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  EditOutlined,
  HomeOutlined,
  UserOutlined,
} from "@ant-design/icons";
import ThemeSwitcher from "@/shared/components/ThemeSwitcher";
import "./index.scss";

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
}

// 模块级常量：避免每次渲染都重建数组导致列表项无谓重渲染
const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "首页", icon: <HomeOutlined /> },
  { path: "/todo", label: "待办", icon: <CheckSquareOutlined /> },
  { path: "/memo", label: "备忘", icon: <EditOutlined /> },
  { path: "/daily", label: "日程", icon: <CalendarOutlined /> },
  { path: "/code", label: "代码", icon: <CodeOutlined /> },
  { path: "/user", label: "我的", icon: <UserOutlined /> },
];

/**
 * 首页专用图标导航栏（方案二布局）。
 *
 * 只负责主窗口内的模块跳转，窗口拖动与最小化/关闭仍由 WindowHeader 承担。
 */
export default function HomeSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <aside className="home-sidebar">
      <div className="home-sidebar__logo" title="CheckIn">
        C
      </div>

      <nav className="home-sidebar__nav">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              className={
                active ? "home-sidebar__item is-active" : "home-sidebar__item"
              }
              aria-current={active ? "page" : undefined}
              title={item.label}
              onClick={() => navigate(item.path)}
            >
              <span className="home-sidebar__icon">{item.icon}</span>
              <span className="home-sidebar__label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="home-sidebar__footer" title="切换主题">
        <ThemeSwitcher placement="bottomRight" />
      </div>
    </aside>
  );
}
