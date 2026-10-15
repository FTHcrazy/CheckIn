/**
 * 设定中心 · 模板库弹窗（UI-10 拆分）
 *
 * 内置预设（一键灌入）+ 我的模板（在分类上「另存为模板」存下）。
 * 打开时由父级 Hook 触发一次列表刷新（模板是低频功能）。
 */

import { Button, Empty, Modal, Popconfirm } from "antd";
import { SETTING_PRESETS } from "../../../../utils/setting-presets";
import "./index.scss";

export interface TemplateLibraryModalProps {
  open: boolean;
  templates: Array<{ id: string; name: string; createdAt: number }>;
  onApplyPreset: (presetId: string) => void;
  onApplyTemplate: (templateId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onCancel: () => void;
}

export default function TemplateLibraryModal({
  open,
  templates,
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
              应用到本书
            </Button>
          </div>
        ))}
        <div className="nv-sc__lib-head">我的模板 · 在分类上「另存为模板」存下</div>
        {templates.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有自己的模板" />
        ) : (
          templates.map((template) => (
            <div key={template.id} className="nv-sc__lib-row">
              <span className="nv-sc__lib-name">{template.name}</span>
              <Button
                size="small"
                type="link"
                onClick={() => onApplyTemplate(template.id)}
              >
                应用到本书
              </Button>
              <Popconfirm
                title="删除这个模板？"
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={() => onDeleteTemplate(template.id)}
              >
                <Button size="small" type="text" danger>
                  删除
                </Button>
              </Popconfirm>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
