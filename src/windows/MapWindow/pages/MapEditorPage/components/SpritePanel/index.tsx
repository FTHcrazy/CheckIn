import { Empty, Tooltip } from "antd";
import { SPRITES, SPRITE_CATEGORIES, type SpriteDef } from "../../sprites";
import "./index.scss";

interface SpritePanelProps {
  /** 当前待放置素材 id */
  pendingSpriteId: string | null;
  onPick: (spriteId: string | null) => void;
}

/**
 * 左侧素材面板：按分类展示可用地形素材，点击后进入"待放置"态。
 *
 * 交互约定：点击素材 → 画布光标变十字 → 再点画布落位。
 * 再次点击同一素材可取消待放置态（避免误触后无法退出）。
 */
export default function SpritePanel({ pendingSpriteId, onPick }: SpritePanelProps) {
  const grouped = SPRITE_CATEGORIES.map((cat) => ({
    ...cat,
    items: SPRITES.filter((s) => s.category === cat.key),
  }));

  return (
    <aside className="sprite-panel">
      <div className="sprite-panel__title">地形素材</div>
      {grouped.every((g) => g.items.length === 0) ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无素材"
          style={{ marginTop: 32 }}
        />
      ) : (
        <div className="sprite-panel__groups">
          {grouped.map((group) =>
            group.items.length === 0 ? null : (
              <section key={group.key} className="sprite-group">
                <div className="sprite-group__label">{group.label}</div>
                <div className="sprite-group__grid">
                  {group.items.map((item) => (
                    <SpriteCard
                      key={item.id}
                      sprite={item}
                      active={pendingSpriteId === item.id}
                      onClick={() =>
                        onPick(pendingSpriteId === item.id ? null : item.id)
                      }
                    />
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      )}
      <div className="sprite-panel__hint">
        {pendingSpriteId ? "点击画布放置素材" : "选择素材后在画布上点击放置"}
      </div>
    </aside>
  );
}

function SpriteCard({
  sprite,
  active,
  onClick,
}: {
  sprite: SpriteDef;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={sprite.label} mouseEnterDelay={0.4}>
      <button
        type="button"
        className={`sprite-card${active ? " sprite-card--active" : ""}`}
        onClick={onClick}
        aria-pressed={active}
      >
        <img className="sprite-card__img" src={sprite.src} alt={sprite.label} draggable={false} />
        <span className="sprite-card__label">{sprite.label}</span>
      </button>
    </Tooltip>
  );
}
