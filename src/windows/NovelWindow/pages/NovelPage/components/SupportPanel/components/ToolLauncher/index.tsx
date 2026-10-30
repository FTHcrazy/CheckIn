import { Button } from "antd";
import {
  ApartmentOutlined,
  AuditOutlined,
  EnvironmentOutlined,
  SafetyOutlined,
  SnippetsOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import "./index.scss";

interface ToolLauncherProps {
  /** 打开起名器二级面板 */
  onOpenNaming: () => void;
  /** 打开敏感词检测二级面板 */
  onOpenSensitive: () => void;
  /** 打开一致性校对二级面板（R-AI-10a，纯本地，不依赖 AI） */
  onOpenConsistency: () => void;
  /** 打开「从本章抽取设定」二级面板（R-AI-08） */
  onOpenExtract: () => void;
  /**
   * 抽取入口不可用的原因（未配置 AI / lite 版）。
   *
   * 传了 = 卡片仍在但点下去只解释原因：**不隐藏**这张卡。抽取是「设定库怎么
   * 填满」的唯一答案，藏起来作者只会以为这软件没有这个能力（与起名保留本地
   * 引擎兜底同一取舍）。
   */
  extractUnavailableText?: string;
  /** 轻提示：规划中的工具点了也要有回应，不能是死链 */
  onNotify: (text: string, tone?: ToastTone) => void;
  /**
   * 打开人物关系网络独立窗口（R27）。
   *
   * 不传 = 该工具仍未落地（单测 / 精简形态），卡片退回「规划中」占位；
   * 传了 = 卡片翻成可用态。这样入口的「是否上线」只有一处开关，不必改版式。
   */
  onOpenRelation?: () => void;
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
 * 起名器、敏感词、一致性校对、实体抽取都是可进入的二级面板；关系网络（R27）
 * 与架空地图（R28）尚在规划中，以「规划中」占位卡同构呈现——新工具接入只需
 * 在下面的清单里加一项，不必再改一次容器版式。
 *
 * ⚠️ 规划中的卡**也必须是真按钮**（UI-09）。此前它是 `<div>`，样式上只比可用卡
 * 淡一点，作者点下去毫无反应，观感就是「点了没反应 / 是不是坏了」。现在：
 * 平面底 + 虚描边 = 一眼看出还没上线，点下去给一条 toast 说明，可反复获得解释。
 */
export default function ToolLauncher({
  onOpenNaming,
  onOpenSensitive,
  onOpenConsistency,
  onOpenExtract,
  extractUnavailableText,
  onNotify,
  onOpenRelation,
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
      id: "sensitive",
      icon: <SafetyOutlined />,
      color: "var(--app-error)",
      weak: "var(--app-error-weak)",
      name: "敏感词检测",
      state: "已上线",
      desc: "AC 自动机扫全书，内置涉黄涉暴等红线词，可自建词库与批量导入。",
      onOpen: onOpenSensitive,
    },
    {
      id: "consistency",
      icon: <AuditOutlined />,
      color: "var(--app-accent-teal)",
      weak: "var(--app-accent-teal-weak)",
      name: "一致性校对",
      state: "已上线",
      desc: "拿要素卡人名与境界阶梯核全书，挑出错字式的名字不一致与未登记档位。纯本地，不耗 AI 额度。",
      onOpen: onOpenConsistency,
    },
    {
      id: "extract",
      icon: <SnippetsOutlined />,
      color: "var(--app-accent-blue)",
      weak: "var(--app-accent-blue-weak)",
      name: "抽取设定",
      state: extractUnavailableText ? "需先配置 AI" : "已上线",
      desc: "把本章出现的人物 / 地点 / 势力 / 物品扒成候选卡，勾选后才入库。",
      // 不可用时**只解释原因**：onOpen 摘掉 → 走 plannedHint 分支的 toast
      onOpen: extractUnavailableText ? undefined : onOpenExtract,
      plannedHint: extractUnavailableText,
    },
    {
      id: "relation",
      icon: <ApartmentOutlined />,
      color: "var(--app-accent-purple)",
      weak: "var(--app-accent-purple-weak)",
      name: "人物关系网络",
      state: onOpenRelation ? "已上线" : "规划中 · R27",
      desc: "把本书要素铺成一张关系图，一眼看清阵容与主线；点节点展开完整资料卡。",
      onOpen: onOpenRelation,
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
        {tools.map((tool) => {
          const live = Boolean(tool.onOpen);
          return (
            <Button
              key={tool.id}
              className={`nv-tools__card${live ? "" : " is-planned"}`}
              onClick={
                live && tool.onOpen
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
                  <span className={`nv-tools__state${live ? " is-live" : ""}`}>
                    {tool.state}
                  </span>
                </span>
                <span className="nv-tools__desc">{tool.desc}</span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
