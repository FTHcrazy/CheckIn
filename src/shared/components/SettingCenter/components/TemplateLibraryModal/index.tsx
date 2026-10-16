/**
 * 设定中心 · 模板库弹窗（UI-10 拆分）
 *
 * 内置预设（一键灌入，恒显示）+ 我的模板（在分类上「另存为模板」存下，
 * 仅 `showTemplates` 为真时显示）。
 * 打开时由父级 Hook 触发一次列表刷新（模板是低频功能）。
 */

import { Button, Empty, Modal, Popconfirm } from "antd";
import { SETTING_PRESETS } from "@/shared/novel/setting-presets";
import "./index.scss";

export interface TemplateLibraryModalProps {
  open: boolean;
  /**
   * 本形态是否提供模板能力（= `hasTemplateCapability`）；false（全局库）时
   * 「我的模板」整块不渲染 —— 模板 IPC 绑 workId，全局库没有该能力。
   * ⚠️ 只关「我的模板」；上方「内置预设」恒显示（纯本地能力）。
   */
  showTemplates: boolean;
  /** 全局库形态：预设套用落到全局库 */
  isGlobal: boolean;
  /**
   * 模板列表。**仅在 `showTemplates === true` 时有意义**；false 时调用方不传
   * （缺省按空数组处理，反正该区块不渲染）。
   */
  templates?: Array<{ id: string; name: string; createdAt: number }>;
  onApplyPreset: (presetId: string) => void;
  /**
   * 套用 / 删除模板。**仅在 `showTemplates === true` 时有意义**；false 时调用方
   * **不传**（而不是传一个空实现）—— 这正是 N-04 要消灭的「假回调」模式。
   */
  onApplyTemplate?: (templateId: string) => void;
  onDeleteTemplate?: (templateId: string) => void;
  onCancel: () => void;
}

export default function TemplateLibraryModal({
  open,
  showTemplates,
  isGlobal,
  templates = [],
  onApplyPreset,
  onApplyTemplate,
  onDeleteTemplate,
  onCancel,
}: TemplateLibraryModalProps) {
  return (
    <Modal open={open} title="模板库" footer={null} onCancel={onCancel} width={480}>
      <div className="nv-sc__library">
        <div className="nv-sc__lib-head">内置预设 · 一键灌入，灌完随便改</div>
        {SETTING_PRESETS.map((preset) => (
          <div key={preset.id} className="nv-sc__lib-row">
            <span className="nv-sc__lib-name" title={preset.note}>
              {preset.name}
            </span>
            <Button
              size="small"
              type="link"
              onClick={() => onApplyPreset(preset.id)}
            >
              {isGlobal ? "应用到全局库" : "应用到本书"}
            </Button>
          </div>
        ))}
        {showTemplates && (
          <>
            <div className="nv-sc__lib-head">
              我的模板 · 在分类上「另存为模板」存下
            </div>
            {templates.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有自己的模板"
              />
            ) : (
              templates.map((template) => (
                <div key={template.id} className="nv-sc__lib-row">
                  <span className="nv-sc__lib-name">{template.name}</span>
                  <Button
                    size="small"
                    type="link"
                    onClick={() => onApplyTemplate?.(template.id)}
                  >
                    应用到本书
                  </Button>
                  <Popconfirm
                    title="删除这个模板？"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => onDeleteTemplate?.(template.id)}
                  >
                    <Button size="small" type="text" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
