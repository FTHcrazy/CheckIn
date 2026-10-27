import React from "react";
import "./index.scss";

interface PageProps {
  children?: React.ReactNode;
}
/**
 * 页面容器：只负责「铺满 .window-shell__body 并纵向排布」。
 *
 * 页头不在这里渲染——「返回上一页」已上移到窗口标题栏（WindowHeader 的
 * leading 插槽），所以页面内容从窗口标题栏下方直接开始，不再为导航条留白。
 */
export default function Page(props: PageProps) {
  return <div className="page">{props.children}</div>;
}
