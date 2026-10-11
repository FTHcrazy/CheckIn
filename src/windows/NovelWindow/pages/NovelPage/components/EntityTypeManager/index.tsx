import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button, ColorPicker, Input, Modal, Popconfirm } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { CUSTOM_TYPE_PALETTE } from "../../novel-config";
import type { CustomEntityTypeDef } from "../../types";
import "./index.scss";

interface EntityTypeManagerProps {
  open: boolean;
  customTypes: CustomEntityTypeDef[];
  /** 某自建类型下现有多少张要素卡（删除确认提示迁移去向） */
  usageCountOf: (typeId: string) => number;
  onClose: () => void;
  /** 新建类型：名称重复或非法时返回 null */
  onAdd: (name: string, color: string) => CustomEntityTypeDef | null;
  /** 重命名：返回 false 表示重名或空名 */
  onRename: (typeId: string, name: string) => boolean;
  /** 改色：正文高亮 / chip / 圆点共用这一份颜色 */
  onRecolor: (typeId: string, color: string) => void;
  /** 删除类型：该类型要素卡由编排层迁回 custom 兜底 */
  onRemove: (typeId: string) => void;
}

/**
 * 自定义要素类型管理弹框（R23）
 *
 * 用户自建类型（命名 + 自选色，id 固定 ct- 前缀），定义存 config。
 * 取色用组件库 ColorPicker（AGENTS §6.1.2）：色板自由、支持直接填 hex，
 * 不再受固定色板的个数限制；下方 presets 保留原配色作为快捷起点。
 * 删除类型不删数据：该类型要素卡自动迁回「自定义」兜底类型。
 */
export default function EntityTypeManager({
  open,
  customTypes,
  usageCountOf,
  onClose,
  onAdd,
  onRename,
  onRecolor,
  onRemove,
}: EntityTypeManagerProps) {
  const [nameDraft, setNameDraft] = useState("");
  const [colorDraft, setColorDraft] = useState<string>(CUSTOM_TYPE_PALETTE[0]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [recolorId, setRecolorId] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setNameDraft("");
    setColorDraft(CUSTOM_TYPE_PALETTE[0]);
    setError("");
    setEditingId(null);
    setRecolorId(null);
  }, [open]);

  const submitAdd = (): void => {
    const name = nameDraft.trim();
    if (!name) {
      setError("名称不能为空");
      return;
    }
    if (customTypes.some((def) => def.name === name)) {
      setError("已有同名类型");
      return;
    }
    const created = onAdd(name, colorDraft);
    if (created) {
      setNameDraft("");
      setError("");
      // 下一个新建默认取未占用的下一个颜色；色板用尽则给一个中性灰起点
      const used = new Set([...customTypes, created].map((def) => def.color));
      setColorDraft(
        CUSTOM_TYPE_PALETTE.find((color) => !used.has(color)) ??
          CUSTOM_TYPE_PALETTE[0],
      );
    }
  };

  const commitRename = (): boolean => {
    if (!editingId) return true;
    const name = renameDraft.trim();
    if (!name) return false;
    const ok = onRename(editingId, name);
    if (ok) setEditingId(null);
    return ok;
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    commit: () => boolean,
    cancel: () => void,
  ): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (!commit()) setError("名称为空或重复");
    } else if (event.key === "Escape") {
      event.stopPropagation();
      cancel();
    }
  };

  return (
    <Modal
      open={open}
      title="自定义要素类型"
      footer={null}
      width={420}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="nv-etm">
        <p className="nv-etm__hint">
          自建类型会出现在筛选、标注类型开关与资料卡编辑里，正文高亮使用所选颜色。
        </p>

        <ul className="nv-etm__list">
          {customTypes.map((def) => (
            <li key={def.id} className="nv-etm__item">
              {/* 圆点即取色入口：点它换色，色板即时预览 */}
              <ColorPicker
                className="nv-etm__pick"
                value={def.color}
                disabledAlpha
                format="hex"
                presets={[
                  { label: "推荐", colors: [...CUSTOM_TYPE_PALETTE] },
                ]}
                open={recolorId === def.id}
                onOpenChange={(next) => setRecolorId(next ? def.id : null)}
                onChangeComplete={(color) => onRecolor(def.id, color.toHexString())}
                aria-label={`修改 ${def.name} 的颜色`}
              >
                <Button
                  className="nv-etm__dot"
                  style={{ background: def.color }}
                  aria-label={`修改 ${def.name} 的颜色`}
                />
              </ColorPicker>
              {editingId === def.id ? (
                <Input
                  size="small"
                  value={renameDraft}
                  autoFocus
                  maxLength={12}
                  aria-label="类型名称"
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => {
                    if (!commitRename()) setError("名称为空或重复");
                  }}
                  onKeyDown={(event) =>
                    handleKeyDown(
                      event,
                      commitRename,
                      () => setEditingId(null),
                    )
                  }
                />
              ) : (
                <>
                  <span className="nv-etm__name">{def.name}</span>
                  <span className="nv-etm__count">
                    {usageCountOf(def.id)} 张卡
                  </span>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    aria-label={`重命名 ${def.name}`}
                    onClick={() => {
                      setRenameDraft(def.name);
                      setEditingId(def.id);
                      setError("");
                    }}
                  />
                  <Popconfirm
                    title="删除该类型？"
                    description={
                      usageCountOf(def.id) > 0
                        ? `该类型下 ${usageCountOf(def.id)} 张要素卡将回退为「自定义」。`
                        : "该类型下暂无要素卡。"
                    }
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onRemove(def.id)}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`删除 ${def.name}`}
                    />
                  </Popconfirm>
                </>
              )}
            </li>
          ))}
          {customTypes.length === 0 && (
            <li className="nv-etm__empty">还没有自建类型</li>
          )}
        </ul>

        <div className="nv-etm__create">
          <p className="nv-etm__label">新建类型</p>
          <Input
            value={nameDraft}
            maxLength={12}
            placeholder="类型名称，如：功法"
            aria-label="新类型名称"
            status={error ? "error" : undefined}
            onChange={(event) => {
              setNameDraft(event.target.value);
              setError("");
            }}
            onPressEnter={submitAdd}
          />
          <div className="nv-etm__colorrow">
            <span className="nv-etm__colorlabel">标识色</span>
            <ColorPicker
              className="nv-etm__pick nv-etm__pick--draft"
              value={colorDraft}
              disabledAlpha
              format="hex"
              showText
              presets={[{ label: "推荐", colors: [...CUSTOM_TYPE_PALETTE] }]}
              onChangeComplete={(color) => setColorDraft(color.toHexString())}
              aria-label="新类型颜色"
            />
          </div>
          {error && <p className="nv-etm__error">{error}</p>}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!nameDraft.trim()}
            onClick={submitAdd}
          >
            添加类型
          </Button>
        </div>
      </div>
    </Modal>
  );
}
