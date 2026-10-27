import { RollbackOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import "./index.scss";

/**
 * 主窗标题栏「返回上一页」入口。
 *
 * 原先每个子页面顶部都挂一条 52px 的导航卡片承载它（Page 内渲染 NavHeader），
 * 那条栏只有「返回」一个功能，却占掉了整块纵向空间、还把内容区往下压了 76px。
 * 现在把入口收进 WindowHeader 的 leading 插槽：位置从「页面内容之上」变成
 * 「窗口标题栏之内」，纵向空间全部还给页面。
 *
 * 只负责「返回」这一个动作：首页不显示由使用方（App 的 BaseWindowHeader）
 * 判定，组件本身不读业务路由表。
 */
export default function BackEntry() {
  const navigate = useNavigate();
  const { key } = useLocation();

  const handleBack = () => {
    // 以子页面地址直接启动 / 刷新窗口时，history 里并没有上一页
    // （react-router 给初始 location 的 key 恒为 "default"），
    // 此时 navigate(-1) 会退到空白页 —— 退回首页兜底。
    if (key === "default") {
      navigate("/");
      return;
    }
    navigate(-1);
  };

  return (
    <Button
      type="text"
      size="medium"
      className="back-entry"
      aria-label="返回上一页"
      icon={<RollbackOutlined />}
      onClick={handleBack}
    >
      返回首页
    </Button>
  );
}
