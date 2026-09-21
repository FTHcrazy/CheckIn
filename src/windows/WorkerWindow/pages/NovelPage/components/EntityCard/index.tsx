import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import TypeBadge from "../TypeBadge";
import type { NovelEntity } from "../../types";
import "./index.scss";

interface EntityCardProps {
  entity: NovelEntity;
  onOpen: (entityId: string) => void;
}

/** 要素卡：头像取名称首字，类型色与正文高亮同源 */
export default function EntityCard({ entity, onOpen }: EntityCardProps) {
  const { metaOf } = useEntityTypeMeta();
  const meta = metaOf(entity.type);

  return (
    <button
      type="button"
      className="nv-ecard"
      onClick={() => onOpen(entity.id)}
    >
      <span
        className="nv-ecard__avatar"
        style={{ color: meta.color, background: meta.colorWeak }}
      >
        {Array.from(entity.name)[0] ?? "?"}
      </span>
      <span className="nv-ecard__main">
        <span className="nv-ecard__name">
          {entity.name}
          <TypeBadge type={entity.type} compact />
        </span>
        <span className="nv-ecard__summary">{entity.summary || "暂无简介"}</span>
      </span>
    </button>
  );
}
