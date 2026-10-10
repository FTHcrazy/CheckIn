import { Button } from "antd";
import { ImportOutlined, RightOutlined } from "@ant-design/icons";
import { MARK_TYPE_OPTIONS } from "../../novel-config";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
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
  /** 把选中文本记入行囊物品栏（REQ-027）；面板没开也生效 */
  onAddToPack: () => void;
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
  onAddToPack,
  onMark,
  onBind,
  onClose,
}: EntityContextMenuProps) {
  const { metaOf } = useEntityTypeMeta();

  return (
    <>
      {/* 点外部关闭：铺满 stage 的透明捕获层（z-index 低于菜单本体） */}
      <div className="nv-ctxmenu__mask" aria-hidden="true" onClick={onClose} />
      <div className="nv-ctxmenu" style={{ left: x, top: y }} role="menu">
        <p className="nv-ctxmenu__selection" title={text}>
          {truncate(text, 16)}
        </p>

        {/* 快捷记账（REQ-027）排在最前：一次点击就完成，没有二级选择，
            与下面两组「先选类型 / 先选卡」的层级结构明显不同 */}
        <p className="nv-ctxmenu__label">记入行囊</p>
        <div className="nv-ctxmenu__types">
          <Button
            role="menuitem"
            className="nv-ctxmenu__item"
            onClick={onAddToPack}
            title="把这件东西记进物品栏，来源章节自动填当前章"
          >
            <ImportOutlined className="nv-ctxmenu__go" />
            记入背包
          </Button>
        </div>

        <p className="nv-ctxmenu__label">新建资料卡</p>
        <div className="nv-ctxmenu__types">
          {MARK_TYPE_OPTIONS.map((type) => {
            const meta = metaOf(type);
            return (
              <Button
                key={type}
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
              </Button>
            );
          })}
        </div>

        <p className="nv-ctxmenu__label">绑定到现有资料卡</p>
        {entities.length === 0 ? (
          <p className="nv-ctxmenu__empty">设定库还是空的</p>
        ) : (
          <div className="nv-ctxmenu__binds">
            {entities.map((entity) => {
              const meta = metaOf(entity.type);
              const bound =
                entity.name === text || entity.aliases.includes(text);
              return (
                <Button
                  key={entity.id}
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
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
