import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AccountBookOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  EditOutlined,
  HomeOutlined,
  ReadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import ThemeSwitcher from "@/shared/components/ThemeSwitcher";
import WorkerFloatButton from "@/shared/components/WorkerFloatButton";
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
  { path: "/ledger", label: "记账", icon: <AccountBookOutlined /> },
  { path: "/code", label: "代码", icon: <CodeOutlined /> },
  { path: "/news", label: "资讯", icon: <ReadOutlined /> },
  { path: "/user", label: "我的", icon: <UserOutlined /> },
];

/**
 * 首页专用图标导航栏（方案二布局）。
 *
 * 圆角浮动形态：不贴窗口边缘、自带大圆角与投影，浮在 --app-bg 之上。
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

      <div className="home-sidebar__footer">
        {/* 精简构建（CHECKIN_LITE=1）不含 WorkerWindow：入口按钮与分隔线一并隐藏 */}
        {!__CHECKIN_LITE__ && (
          <>
            <WorkerFloatButton variant="inline" />
            <span className="home-sidebar__divider" aria-hidden="true" />
          </>
        )}
        <ThemeSwitcher placement="right" />
      </div>
    </aside>
  );
}
