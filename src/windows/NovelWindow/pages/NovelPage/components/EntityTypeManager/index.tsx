import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button, Input, Modal, Popconfirm } from "antd";
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
  /** 删除类型：该类型要素卡由编排层迁回 custom 兜底 */
  onRemove: (typeId: string) => void;
}

/**
 * 自定义要素类型管理弹框（R23）
 *
 * 用户自建类型（命名 + 色板选色，id 固定 ct- 前缀），定义存 config。
 * 删除类型不删数据：该类型要素卡自动迁回「自定义」兜底类型。
 */
export default function EntityTypeManager({
  open,
  customTypes,
  usageCountOf,
  onClose,
  onAdd,
  onRename,
  onRemove,
}: EntityTypeManagerProps) {
  const [nameDraft, setNameDraft] = useState("");
  const [colorDraft, setColorDraft] = useState(CUSTOM_TYPE_PALETTE[0]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    if (open) return;
    setNameDraft("");
    setColorDraft(CUSTOM_TYPE_PALETTE[0]);
    setError("");
    setEditingId(null);
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
      // 下一个新建默认取未占用的下一个颜色
      const used = new Set(
        [...customTypes, created].map((def) => def.color),
      );
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
              <span
                className="nv-etm__dot"
                style={{ background: def.color }}
              />
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
          <div className="nv-etm__palette">
            {CUSTOM_TYPE_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className={`nv-etm__swatch${
                  colorDraft === color ? " is-on" : ""
                }`}
                style={{ background: color }}
                aria-label={`选择颜色 ${color}`}
                onClick={() => setColorDraft(color)}
              />
            ))}
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
