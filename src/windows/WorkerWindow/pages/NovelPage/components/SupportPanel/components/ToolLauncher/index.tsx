import {
  ApartmentOutlined,
  EnvironmentOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import "./index.scss";

interface ToolLauncherProps {
  /** 打开起名器二级面板 */
  onOpenNaming: () => void;
}

interface ToolItem {
  id: string;
  icon: ReactNode;
  color: string;
  weak: string;
  name: string;
  state: string;
  desc: string;
  onOpen?: () => void;
}

/**
 * 工具箱启动器（PRD R31：工具入口统一收在右栏，不往顶栏堆按钮）
 *
 * 起名器是可进入的二级面板；架空地图（novel-map PRD）已升级为独立 MapWindow，
 * 点击即唤起（单实例，已开则聚焦）；人物关系网络（R27）尚在规划中。
 * 新工具接入只需在下面的清单里加一项，不必再改一次容器版式。
 */
export default function ToolLauncher({ onOpenNaming }: ToolLauncherProps) {
  const tools: ToolItem[] = [
    {
      id: "naming",
      icon: <ThunderboltOutlined />,
      color: "var(--app-primary)",
      weak: "var(--app-primary-weak)",
      name: "起名器",
      state: "已上线",
      desc: "八类名称 × 东西方多风格，避开本书已用名，可插入正文或直接建卡。",
      onOpen: onOpenNaming,
    },
    {
      id: "map",
      icon: <EnvironmentOutlined />,
      color: "var(--app-accent-green)",
      weak: "var(--app-accent-green-weak)",
      name: "架空地图",
      state: "已上线",
      desc: "独立地图窗口：随机成图 + 约束地形 + 标注即要素 + 大小图嵌套，与编辑器联动。",
      onOpen: () => window.electronAPI?.send("map-window-open", { type: "open" }),
    },
    {
      id: "relation",
      icon: <ApartmentOutlined />,
      color: "var(--app-accent-purple)",
      weak: "var(--app-accent-purple-weak)",
      name: "人物关系网络",
      state: "规划中 · R27",
      desc: "复用要素关联一键渲染力导向图，阵容与主线一眼看清。",
    },
  ];

  return (
    <div className="nv-tools">
      <div className="nv-tools__grid">
        {tools.map((tool) => {
          const body = (
            <>
              <span
                className="nv-tools__icon"
                style={{ color: tool.color, background: tool.weak }}
              >
                {tool.icon}
              </span>
              <span className="nv-tools__body">
                <span className="nv-tools__name">
                  {tool.name}
                  <span
                    className={`nv-tools__state${tool.onOpen ? " is-live" : ""}`}
                  >
                    {tool.state}
                  </span>
                </span>
                <span className="nv-tools__desc">{tool.desc}</span>
              </span>
            </>
          );

          return tool.onOpen ? (
            <button
              key={tool.id}
              type="button"
              className="nv-tools__card"
              onClick={tool.onOpen}
            >
              {body}
            </button>
          ) : (
            <div key={tool.id} className="nv-tools__card is-planned">
              {body}
            </div>
          );
        })}
      </div>

      <div className="nv-sechead">说明</div>
      <div className="nv-kv">
        <span className="nv-kv__k">工具</span>
        <span className="nv-kv__v">
          按需即用、关闭即释放，入口统一收在这里，避免顶栏按钮堆积。
        </span>
      </div>
    </div>
  );
}
