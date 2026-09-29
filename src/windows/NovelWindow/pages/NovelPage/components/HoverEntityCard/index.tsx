import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import { useHoverStore } from "../../store/useHoverStore";
import "./index.scss";

interface HoverEntityCardProps {
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
 *
 * target / entity 直接从 hover store 订阅：指针在正文里移动是全应用
 * 最高频的事件流，若由页面根组件持有再透传，每一帧都会推着整棵树重渲染。
 * 现在只有本组件会跟着坐标走。
 */
export default function HoverEntityCard({
  onOpenDetail,
}: HoverEntityCardProps) {
  const target = useHoverStore((state) => state.target);
  const entity = useHoverStore((state) => state.entity);
  const { metaOf } = useEntityTypeMeta();

  if (!target || !entity) return null;

  const meta = metaOf(entity.type);
  const tags = entity.fields["性格"] ? splitTags(entity.fields["性格"]) : [];

  return (
    <div className="nv-pop" style={{ left: target.x, top: target.y }}>
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
    </div>
  );
}
