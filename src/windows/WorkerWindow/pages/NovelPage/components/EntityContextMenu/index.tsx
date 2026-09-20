import { RightOutlined } from "@ant-design/icons";
import { ENTITY_TYPE_META, MARK_TYPE_OPTIONS } from "../../novel-config";
import { truncate } from "../../novel-utils";
import type { EntityType, NovelEntity } from "../../types";
import "./index.scss";

interface EntityContextMenuProps {
  /** 相对 .nv-page__stage 的坐标（EditorPane 已按菜单尺寸 clamp） */
  x: number;
  y: number;
  /** 选中的正文文本 */
  text: string;
  entities: NovelEntity[];
  /** 新建资料卡（类型由菜单项决定） */
  onMark: (type: EntityType) => void;
  /** 绑定到现有资料卡（关联为别名） */
  onBind: (entityId: string) => void;
  onClose: () => void;
}

/**
 * 选区右键菜单（O3 / R20 ③）
 *
 * 选中正文 → 右键：新建资料卡（四类型直建）或绑定到现有资料卡（关联为别名）。
 * 手动绑定路线：识别与绑定完全由用户驱动，不引入 NLP / 自动高亮。
 * 菜单相对 stage 绝对定位，透明捕获层负责点外部关闭。
 */
export default function EntityContextMenu({
  x,
  y,
  text,
  entities,
  onMark,
  onBind,
  onClose,
}: EntityContextMenuProps) {
  return (
    <>
      {/* 点外部关闭：铺满 stage 的透明捕获层（z-index 低于菜单本体） */}
      <div className="nv-ctxmenu__mask" aria-hidden="true" onClick={onClose} />
      <div className="nv-ctxmenu" style={{ left: x, top: y }} role="menu">
        <p className="nv-ctxmenu__selection" title={text}>
          {truncate(text, 16)}
        </p>

        <p className="nv-ctxmenu__label">新建资料卡</p>
        <div className="nv-ctxmenu__types">
          {MARK_TYPE_OPTIONS.map((type) => {
            const meta = ENTITY_TYPE_META[type];
            return (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="nv-ctxmenu__item"
                style={{ color: meta.color }}
                onClick={() => onMark(type)}
              >
                <span
                  className="nv-ctxmenu__dot"
                  style={{ background: meta.color }}
                />
                {meta.label}
              </button>
            );
          })}
        </div>

        <p className="nv-ctxmenu__label">绑定到现有资料卡</p>
        {entities.length === 0 ? (
          <p className="nv-ctxmenu__empty">设定库还是空的</p>
        ) : (
          <div className="nv-ctxmenu__binds">
            {entities.map((entity) => {
              const meta = ENTITY_TYPE_META[entity.type];
              const bound =
                entity.name === text || entity.aliases.includes(text);
              return (
                <button
                  key={entity.id}
                  type="button"
                  role="menuitem"
                  className="nv-ctxmenu__item"
                  disabled={bound}
                  onClick={() => onBind(entity.id)}
                >
                  <span
                    className="nv-ctxmenu__dot"
                    style={{ background: meta.color }}
                  />
                  <span className="nv-ctxmenu__name">{entity.name}</span>
                  {bound ? (
                    <span className="nv-ctxmenu__bound">已绑定</span>
                  ) : (
                    <RightOutlined className="nv-ctxmenu__go" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
