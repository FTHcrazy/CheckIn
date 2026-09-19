import type { OutlineNode } from "../../types";
import "./index.scss";

interface OutlinePanelProps {
  outline: OutlineNode[];
  onSelectChapter: (chapterId: string) => void;
}

/**
 * 大纲面板（R7）
 *
 * 卷 → 章 → 伏笔三级；点击章节条定位（当前数据集里大纲条目复用章节 id）。
 */
export default function OutlinePanel({
  outline,
  onSelectChapter,
}: OutlinePanelProps) {
  if (outline.length === 0) {
    return <p className="nv-outline__empty">这个作品还没有大纲</p>;
  }

  return (
    <div className="nv-outline">
      {outline.map((volume) => (
        <section key={volume.id} className="nv-outline__volume">
          <header className="nv-outline__volume-head">
            <span className="nv-outline__volume-title">{volume.title}</span>
            {volume.note && (
              <span className="nv-outline__volume-note">{volume.note}</span>
            )}
          </header>

          <ul className="nv-outline__list">
            {(volume.children ?? []).map((node) => (
              <li
                key={node.id}
                className={`nv-outline__item nv-outline__item--${node.kind}`}
              >
                <button
                  type="button"
                  className="nv-outline__row"
                  onClick={() => onSelectChapter(node.id)}
                  disabled={node.kind === "foreshadow"}
                >
                  {node.kind === "foreshadow" && node.tag && (
                    <span className="nv-outline__tag">{node.tag}</span>
                  )}
                  <span className="nv-outline__title">{node.title}</span>
                  {node.note && (
                    <span className="nv-outline__note">{node.note}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
