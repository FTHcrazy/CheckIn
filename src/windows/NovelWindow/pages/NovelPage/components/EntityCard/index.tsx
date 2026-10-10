import { Button } from "antd";
import {
  BookOutlined,
  CrownFilled,
  CrownOutlined,
  EditOutlined,
  LinkOutlined,
  RiseOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import type { NovelEntity } from "../../types";
import "./index.scss";

interface EntityCardProps {
  entity: NovelEntity;
  /** 关联要素条数（含出入两个方向） */
  relationCount: number;
  /** 出场章数：由页面一次性统计后传入，避免列表里逐卡扫全书 */
  appearanceCount: number;
  /**
   * 出场章数是否仍在后台补扫（首次导入长篇时为 true）。
   * 为 true 时不显示会跳动的中间数字，改显示「统计中…」。
   */
  appearancePending?: boolean;
  /** 当前境界名（R25 绑定，未绑定为空串） */
  levelName: string;
  /** 是否为行囊主角（决定「主角」角标与置顶） */
  isProtagonist: boolean;
  onOpen: (entityId: string) => void;
  /** 把要素名插入正文光标处 */
  onInsertName: (name: string) => void;
  /** 设为主角 / 取消主角 */
  onSetProtagonist: () => void;
}

/**
 * 要素卡：头像取名称首字，类型色与正文高亮同源。
 *
 * 卡片主体是整块的点击区（打开详情），「插入正文 / 编辑」悬停才浮出——
 * 常驻四个图标会让列表变成一片按钮墙。
 *
 * 主角设定只对角色卡出现：行囊只承载主角一人，把入口铺到地点 / 派系卡上
 * 只会让人以为「也能设主角」。
 */
export default function EntityCard({
  entity,
  relationCount,
  appearanceCount,
  appearancePending = false,
  levelName,
  isProtagonist,
  onOpen,
  onInsertName,
  onSetProtagonist,
}: EntityCardProps) {
  const { metaOf } = useEntityTypeMeta();
  const meta = metaOf(entity.type);
  const canBeProtagonist = entity.type === "character";

  return (
    <div
      className={`nv-ecard${isProtagonist ? " is-protagonist" : ""}`}
      style={{ ["--ent-color" as string]: meta.color }}
    >
      <Button
        className="nv-ecard__main"
        onClick={() => onOpen(entity.id)}
      >
        <span
          className="nv-ecard__avatar"
          style={{ color: meta.color, background: meta.colorWeak }}
        >
          {Array.from(entity.name)[0] ?? "?"}
        </span>
        <span className="nv-ecard__body">
          <span className="nv-ecard__top">
            <span className="nv-ecard__name">{entity.name}</span>
            {isProtagonist && (
              <span className="nv-ecard__protagonist" title="行囊主角：境界与行囊同源">
                <CrownFilled />
                主角
              </span>
            )}
            <span
              className="nv-ecard__badge"
              style={{ color: meta.color, background: meta.colorWeak }}
            >
              {meta.label}
            </span>
            {entity.aliases.length > 0 && (
              <span className="nv-ecard__alias">
                {entity.aliases.join(" · ")}
              </span>
            )}
          </span>
          <span className="nv-ecard__sum">{entity.summary}</span>
          <span className="nv-ecard__stats">
            <span className="nv-ecard__stat">
              <LinkOutlined /> 关联 {relationCount}
            </span>
            <span className="nv-ecard__stat">
              <BookOutlined />{" "}
              {appearancePending ? "统计中…" : `出场 ${appearanceCount} 章`}
            </span>
            {levelName && (
              <span className="nv-ecard__stat nv-ecard__stat--level">
                <RiseOutlined /> {levelName}
              </span>
            )}
          </span>
        </span>
      </Button>

      <span className="nv-ecard__quick">
        {canBeProtagonist && (
          <Button
            className={`nv-mini${isProtagonist ? " is-on" : ""}`}
            aria-pressed={isProtagonist}
            aria-label={isProtagonist ? "取消主角" : "设为主角"}
            title={
              isProtagonist
                ? "取消主角（行囊境界退回仅面板内使用）"
                : "设为主角：行囊境界与这张卡同源"
            }
            onClick={onSetProtagonist}
          >
            {isProtagonist ? <CrownFilled /> : <CrownOutlined />}
          </Button>
        )}
        <Button
          className="nv-mini"
          aria-label="插入正文"
          title="插入正文光标处"
          onClick={() => onInsertName(entity.name)}
        >
          <ThunderboltOutlined />
        </Button>
        <Button
          className="nv-mini"
          aria-label="编辑要素"
          title="编辑要素"
          onClick={() => onOpen(entity.id)}
        >
          <EditOutlined />
        </Button>
      </span>
    </div>
  );
}
