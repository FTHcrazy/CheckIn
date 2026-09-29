import { BookOutlined, EditOutlined, LinkOutlined, RiseOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import type { NovelEntity } from "../../types";
import "./index.scss";

interface EntityCardProps {
  entity: NovelEntity;
  /** 关联要素条数（含出入两个方向） */
  relationCount: number;
  /** 出场章数：由页面一次性统计后传入，避免列表里逐卡扫全书 */
  appearanceCount: number;
  /** 当前境界名（R25 绑定，未绑定为空串） */
  levelName: string;
  onOpen: (entityId: string) => void;
  /** 把要素名插入正文光标处 */
  onInsertName: (name: string) => void;
}

/**
 * 要素卡：头像取名称首字，类型色与正文高亮同源。
 *
 * 卡片主体是整块的点击区（打开详情），「插入正文 / 编辑」悬停才浮出——
 * 常驻四个图标会让列表变成一片按钮墙。
 */
export default function EntityCard({
  entity,
  relationCount,
  appearanceCount,
  levelName,
  onOpen,
  onInsertName,
}: EntityCardProps) {
  const { metaOf } = useEntityTypeMeta();
  const meta = metaOf(entity.type);

  return (
    <div className="nv-ecard" style={{ ["--ent-color" as string]: meta.color }}>
      <button
        type="button"
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
              <BookOutlined /> 出场 {appearanceCount} 章
            </span>
            {levelName && (
              <span className="nv-ecard__stat nv-ecard__stat--level">
                <RiseOutlined /> {levelName}
              </span>
            )}
          </span>
        </span>
      </button>

      <span className="nv-ecard__quick">
        <button
          type="button"
          className="nv-mini"
          aria-label="插入正文"
          title="插入正文光标处"
          onClick={() => onInsertName(entity.name)}
        >
          <ThunderboltOutlined />
        </button>
        <button
          type="button"
          className="nv-mini"
          aria-label="编辑要素"
          title="编辑要素"
          onClick={() => onOpen(entity.id)}
        >
          <EditOutlined />
        </button>
      </span>
    </div>
  );
}
