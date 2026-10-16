/**
 * 设定中心 · 顶部工具头（UI-10 拆分）
 *
 * 一行说明 + 「模板库」入口 + 「⋯」更多操作（另存为模板 / 导出 / 转为普通分类）。
 * 低频操作（导出、把境界体系转为普通分类）收进「⋯」，避免与常驻按钮抢位置。
 */

import {
  BookOutlined,
  DownloadOutlined,
  MoreOutlined,
  SaveOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import GuideTooltip from "@/shared/components/GuideTooltip";
import type { SettingCategory } from "@/shared/novel/setting-types";
import type { SettingCenterProps } from "../../setting-center-shared";
import "./index.scss";

export interface SettingPanelHeadProps {
  /** 当前选中的分类；为空时不渲染「⋯」（导出 / 另存针对具体分类） */
  active: SettingCategory | null;
  /** 全局库形态：提示语 / 导出文案 / 「另存为模板」入口按此切换 */
  isGlobal: boolean;
  /**
   * 本形态是否提供模板能力（N-04）：false 时「另存为模板」菜单项不渲染
   * —— 它与 SaveTemplateModal、弹窗内「我的模板」区块共用同一判据，避免出现
   * 点了没反应的假入口。
   *
   * ⚠️ 它**不**管「模板库」入口：模板库里的「内置预设」是纯本地能力
   * （`SETTING_PRESETS` 直接 import，`onApplyPreset` 必填），任何形态都能用，
   * 所以「模板库」恒渲染（见下方按钮）。
   */
  hasTemplateCapability: boolean;
  onOpenLibrary: () => void;
  onStartSaveTemplate: () => void;
  onExport: SettingCenterProps["onExport"];
  onPatchCategory: SettingCenterProps["onPatchCategory"];
}

export default function SettingPanelHead({
  active,
  isGlobal,
  hasTemplateCapability,
  onOpenLibrary,
  onStartSaveTemplate,
  onExport,
  onPatchCategory,
}: SettingPanelHeadProps) {
  return (
    <div className="nv-sc__head">
      <span className="nv-sc__hint">
        {isGlobal
          ? "这里的设定可被任意作品引用 · 改动会同步到仍引用它的书"
          : "设定按作品独立存储 · 修改即时同步到角色卡境界与行囊"}
      </span>
      <div className="nv-sc__actions">
        {/* T-02：首次打开设定中心时提示模板库（默认消费判定，无打字保护需求）。
            ⚠️ 恒渲染：模板库的「内置预设」是纯本地能力（onApplyPreset 必填），
            与 hasTemplateCapability 无关 —— 后者只管「另存为模板」（N-04）。 */}
        <GuideTooltip id="T-02">
          <Button
            size="small"
            onClick={onOpenLibrary}
            data-tour-target="setting-library"
          >
            <SaveOutlined />
            模板库
          </Button>
        </GuideTooltip>
        {active && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                // 「另存为模板」是本书域能力（模板 IPC 绑 workId）——全局库不提供；
                // 本形态未提供模板能力时也不提供（N-04，与弹窗同一判据）
                ...(isGlobal || !hasTemplateCapability
                  ? []
                  : [
                      {
                        key: "save-template",
                        label: (
                          <>
                            <UploadOutlined /> 另存为模板
                          </>
                        ),
                        onClick: onStartSaveTemplate,
                      },
                    ]),
                {
                  key: "export-json",
                  label: (
                    <>
                      <DownloadOutlined />{" "}
                      {isGlobal ? "导出为 JSON（全部）" : "导出为 JSON（本分类）"}
                    </>
                  ),
                  onClick: () => onExport(active.id, "json"),
                },
                {
                  key: "export-md",
                  label: (
                    <>
                      <DownloadOutlined />{" "}
                      {isGlobal
                        ? "导出为 Markdown 设定集（全部）"
                        : "导出为 Markdown 设定集"}
                    </>
                  ),
                  onClick: () => onExport(active.id, "markdown"),
                },
                ...(active.kind === "realm"
                  ? [
                      {
                        key: "unset-realm",
                        label: (
                          <>
                            <BookOutlined /> 转为普通分类
                          </>
                        ),
                        onClick: () =>
                          onPatchCategory(active.id, { kind: "custom" as const }),
                      },
                    ]
                  : []),
              ],
            }}
          >
            <Button size="small" aria-label="更多设定操作">
              <MoreOutlined />
            </Button>
          </Dropdown>
        )}
      </div>
    </div>
  );
}
