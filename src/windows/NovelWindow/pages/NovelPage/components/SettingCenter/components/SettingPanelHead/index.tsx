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
import type { SettingCategory } from "../../../../types";
import type { SettingCenterProps } from "../../setting-center-shared";
import "./index.scss";

export interface SettingPanelHeadProps {
  /** 当前选中的分类；为空时不渲染「⋯」（导出 / 另存针对具体分类） */
  active: SettingCategory | null;
  onOpenLibrary: () => void;
  onStartSaveTemplate: () => void;
  onExport: SettingCenterProps["onExport"];
  onPatchCategory: SettingCenterProps["onPatchCategory"];
}

export default function SettingPanelHead({
  active,
  onOpenLibrary,
  onStartSaveTemplate,
  onExport,
  onPatchCategory,
}: SettingPanelHeadProps) {
  return (
    <div className="nv-sc__head">
      <span className="nv-sc__hint">
        设定按作品独立存储 · 修改即时同步到角色卡境界与行囊
      </span>
      <div className="nv-sc__actions">
        {/* T-02：首次打开设定中心时提示模板库（默认消费判定，无打字保护需求） */}
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
                {
                  key: "save-template",
                  label: (
                    <>
                      <UploadOutlined /> 另存为模板
                    </>
                  ),
                  onClick: onStartSaveTemplate,
                },
                {
                  key: "export-json",
                  label: (
                    <>
                      <DownloadOutlined /> 导出为 JSON（本分类）
                    </>
                  ),
                  onClick: () => onExport(active.id, "json"),
                },
                {
                  key: "export-md",
                  label: (
                    <>
                      <DownloadOutlined /> 导出为 Markdown 设定集
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
