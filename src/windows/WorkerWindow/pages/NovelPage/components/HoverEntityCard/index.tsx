import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import type { NovelEntity } from "../../types";
import type { HoverTarget } from "../../hooks/useEntityHover";
import "./index.scss";

interface HoverEntityCardProps {
  target: HoverTarget;
  entity: NovelEntity;
  onOpenDetail: (entityId: string) => void;
}

/** 性格标签拆分：trim 后过滤空段（「· 」带空格的历史数据会产生空白标签） */
const splitTags = (raw: string): string[] =>
  raw
    .split(/[·、,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

/**
 * 悬浮资料卡（O2 / R20 ②）
 *
 * 无焦点 popover：不获取焦点、不劫持滚轮、不阻断 IME 候选，
 * 只展示摘要，完整设定要点开才查库（懒加载）。
 * 统一在文字下方展示（不再触底翻转覆盖正文）。
 */
export default function HoverEntityCard({
  target,
  entity,
  onOpenDetail,
}: HoverEntityCardProps) {
  const { metaOf } = useEntityTypeMeta();
  const meta = metaOf(entity.type);
  const tags = entity.fields["性格"] ? splitTags(entity.fields["性格"]) : [];

  return (
    <div
      className="nv-pop"
      style={{ left: target.x, top: target.y }}
    >
      <div className="nv-pop__head">
        <span
          className="nv-pop__avatar"
          style={{ color: meta.color, background: meta.colorWeak }}
        >
          {Array.from(entity.name)[0] ?? "?"}
        </span>
        <span className="nv-pop__names">
          <span className="nv-pop__name">{entity.name}</span>
          {entity.aliases.length > 0 && (
            <span className="nv-pop__alias">
              别名：{entity.aliases.join(" · ")}
            </span>
          )}
        </span>
      </div>

      <p className="nv-pop__summary">{entity.summary || "暂无简介"}</p>

      {tags.length > 0 && (
        <div className="nv-pop__tags">
          {tags.map((tag) => (
            <span key={tag} className="nv-pop__tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="nv-pop__foot">
        <button type="button" onClick={() => onOpenDetail(entity.id)}>
          查看完整设定
        </button>
      </div>

      <p className="nv-pop__tip">输入或滚动即关闭 · 不抢焦点</p>
    </div>
  );
}
