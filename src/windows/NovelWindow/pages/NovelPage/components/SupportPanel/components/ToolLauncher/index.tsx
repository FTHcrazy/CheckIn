import { Button } from "antd";
import {
  ApartmentOutlined,
  EnvironmentOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import "./index.scss";

interface ToolLauncherProps {
  /** 打开起名器二级面板 */
  onOpenNaming: () => void;
  /** 轻提示：规划中的工具点了也要有回应，不能是死链 */
  onNotify: (text: string, tone?: ToastTone) => void;
}

interface ToolItem {
  id: string;
  icon: ReactNode;
  color: string;
  weak: string;
  name: string;
  state: string;
  desc: string;
  /** 可进入的工具：点击打开二级面板 */
  onOpen?: () => void;
  /** 规划中的工具：点击要说明「还没上线」，而不是静默 */
  plannedHint?: string;
}

/**
 * 工具箱启动器（PRD R31：工具入口统一收在右栏，不往顶栏堆按钮）
 *
 * 起名器是可进入的二级面板；关系网络（R27）与架空地图（R28）尚在规划中，
 * 以「规划中」占位卡同构呈现——新工具接入只需在下面的清单里加一项，
 * 不必再改一次容器版式。
 *
 * ⚠️ 规划中的卡**也必须是真按钮**（UI-09）。此前它是 `<div>`，样式上只比可用卡
 * 淡一点，作者点下去毫无反应，观感就是「点了没反应 / 是不是坏了」。现在：
 * 平面底 + 虚描边 = 一眼看出还没上线，点下去给一条 toast 说明，可反复获得解释。
 */
export default function ToolLauncher({
  onOpenNaming,
  onNotify,
}: ToolLauncherProps) {
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
      id: "relation",
      icon: <ApartmentOutlined />,
      color: "var(--app-accent-purple)",
      weak: "var(--app-accent-purple-weak)",
      name: "人物关系网络",
      state: "规划中 · R27",
      desc: "复用要素关联一键渲染力导向图，阵容与主线一眼看清。",
      plannedHint: "「人物关系网络」还在规划中，上线后会出现在这里",
    },
    {
      id: "map",
      icon: <EnvironmentOutlined />,
      color: "var(--app-accent-green)",
      weak: "var(--app-accent-green-weak)",
      name: "架空地图",
      state: "规划中 · R28",
      desc: "轻量画布：节点 + 连线标距离 + 导出 PNG，不触真实地理数据。",
      plannedHint: "「架空地图」还在规划中，上线后会出现在这里",
    },
  ];

  return (
    <div className="nv-tools">
      <div className="nv-tools__grid">
        {tools.map((tool) => (
          <Button
            key={tool.id}
            className={`nv-tools__card${tool.onOpen ? "" : " is-planned"}`}
            onClick={
              tool.onOpen
                ? tool.onOpen
                : () => onNotify(tool.plannedHint ?? "", "info")
            }
          >
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
          </Button>
        ))}
      </div>
    </div>
  );
}
