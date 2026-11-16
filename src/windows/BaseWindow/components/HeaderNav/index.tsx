import BackEntry from "../BackEntry";
import "./index.scss";

interface HeaderNavProps {
  /** 当前子页面名称（来自 App 的路由 ↔ 标题表） */
  title: string;
}

/**
 * 窗口标题栏左侧导航区：返回入口 + 分隔线 + 当前页面名称。
 *
 * 为什么不是「只放一颗返回按钮」：34px 的标题栏里孤零零一颗小按钮，
 * 左侧会剩下一大片空白，看起来像「没做完的工具栏」，也读不出「我现在在哪」。
 * 补上页面名称后，这一区变成「动作 │ 位置」的完整信息对——返回有了对象
 * （从哪个页面返回），右侧的设置与窗口按钮也有了左边的重量来平衡。
 *
 * 只在子页面渲染（首页由 App 判定后不传），所以内部不再判空。
 */
export default function HeaderNav({ title }: HeaderNavProps) {
  return (
    <>
      <BackEntry />
      <span className="header-nav__divider" aria-hidden="true" />
      <span className="header-nav__title">{title}</span>
    </>
  );
}
