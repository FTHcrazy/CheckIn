/**
 * 全局设定中心 · 工具头（窗口私有，替换 shared 的 `SettingPanelHead`）
 *
 * 一行跨书共享提示语 + 右侧动作区：「模板库」「＋ 新建分类」「批量选择」与「⋯」
 * 更多菜单（导出为 JSON（全部）/ 导出为 Markdown 设定集（全部）/ 转为普通分类）。
 *
 * 为什么不用 `SettingPanelHead`：
 * - 它把「另存为模板」（本书域能力）也挂在动作区，全局库没有该能力；
 * - 它的「⋯」只在有选中分类时才渲染，而「模板库 / 新建分类」应当**恒可用**
 *   （空库也要能套预设、能新建）；
 * - 提示语文案本身就是全局口径，窗口自持可以避免再去 shared 里加分支。
 *
 * 动作分级（与书架顶栏一致）：**一个实底 pill 主命令 + 其余纯文字** ——
 * 四颗同形 outlined 小按钮排成一行时，没有一颗看起来更像下一步该做的事。
 *
 * ⚠️ 导出走既有 `onExport`，全局域忽略 `categoryId`（导出通道只有整库一档）。
 */

import {
  AppstoreOutlined,
  CheckSquareOutlined,
  DownloadOutlined,
  MoreOutlined,
  PlusOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { SettingCategory } from "@/shared/novel/setting-types";
import "./index.scss";

export interface GsToolbarProps {
  /** 当前选中的分类；为空时「⋯」里的按分类动作（导出 / 转为普通分类）不渲染 */
  active: SettingCategory | null;
  onOpenLibrary: () => void;
  /** 聚焦左栏新建输入框（工具头「＋ 新建分类」与空态「新建空白分类」共用） */
  onFocusNewCategory: () => void;
  onExport: (format: "json" | "markdown") => void;
  /** 把境界体系转为普通分类（仅 `active.kind === "realm"` 时提供） */
  onUnsetRealm: () => void;
  /** 批量选择模式开关（R10）：开启后等级行首列出现勾选框 */
  batchSelecting: boolean;
  onToggleBatchSelecting: () => void;
}

export default function GsToolbar({
  active,
  onOpenLibrary,
  onFocusNewCategory,
  onExport,
  onUnsetRealm,
  batchSelecting,
  onToggleBatchSelecting,
}: GsToolbarProps) {
  const hasActiveWithLevels = Boolean(active) && active!.levels.length > 0;

  return (
    <div className="gs-toolbar">
      <span className="gs-toolbar__hint">
        这里的设定可被任意作品引用 · 改动会同步到仍引用它的书
      </span>
      <span className="gs-toolbar__spacer" />
      <div className="gs-toolbar__actions">
        <Button size="small" type="text" onClick={onOpenLibrary}>
          <AppstoreOutlined />
          模板库
        </Button>
        <Button
          size="small"
          type="primary"
          className="gs-toolbar__cta"
          onClick={onFocusNewCategory}
        >
          <PlusOutlined />
          新建分类
        </Button>
        {/* R10：批量选择是「进入一种模式」，不是一次性动作 —— 用显式开关而不是
            把勾选框常驻在每行（常驻会挤掉窄窗下本就紧张的等级名列）。 */}
        {hasActiveWithLevels && (
          <Button
            size="small"
            type="text"
            className={`gs-toolbar__ghost${batchSelecting ? " is-on" : ""}`}
            aria-pressed={batchSelecting}
            onClick={onToggleBatchSelecting}
          >
            <CheckSquareOutlined />
            {batchSelecting ? "退出批量" : "批量选择"}
          </Button>
        )}
        <Dropdown
          trigger={["click"]}
          disabled={!active}
          menu={{
            items: [
              {
                key: "export-json",
                label: (
                  <>
                    <DownloadOutlined /> 导出为 JSON（全部）
                  </>
                ),
                onClick: () => onExport("json"),
              },
              {
                key: "export-md",
                label: (
                  <>
                    <DownloadOutlined /> 导出为 Markdown 设定集（全部）
                  </>
                ),
                onClick: () => onExport("markdown"),
              },
              ...(active && active.kind === "realm"
                ? [
                    {
                      key: "unset-realm",
                      label: (
                        <>
                          <SwapOutlined /> 转为普通分类
                        </>
                      ),
                      onClick: onUnsetRealm,
                    },
                  ]
                : []),
            ],
          }}
        >
          <Button size="small" type="text" aria-label="更多设定操作">
            <MoreOutlined />
          </Button>
        </Dropdown>
      </div>
    </div>
  );
}
