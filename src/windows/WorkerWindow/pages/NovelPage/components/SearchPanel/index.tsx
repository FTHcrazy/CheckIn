import { useEffect, useRef, useState } from "react";
import { SearchOutlined } from "@ant-design/icons";
import { splitByKeyword } from "../../novel-utils";
import type { SearchHit } from "../../types";
import "./index.scss";

interface SearchPanelProps {
  onSearch: (keyword: string) => Promise<SearchHit[]>;
  onSelectChapter: (chapterId: string) => void;
}

/**
 * 全书检索面板（R10）
 *
 * 输入 300ms 防抖后才查库；命中词在片段里高亮，结果按章节聚合处数。
 */
export default function SearchPanel({
  onSearch,
  onSelectChapter,
}: SearchPanelProps) {
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      setHits([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void onSearch(trimmed).then((result) => {
        setHits(result);
        setLoading(false);
      });
    }, 300);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [keyword, onSearch]);

  const total = hits.reduce((sum, hit) => sum + hit.count, 0);

  return (
    <div className="nv-search">
      <label className="nv-search__box">
        <SearchOutlined className="nv-search__icon" />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="全书检索"
          aria-label="全书检索"
        />
        {keyword.trim() && !loading && (
          <span className="nv-search__count">
            全书 · {total} 条
          </span>
        )}
      </label>

      {loading ? (
        <p className="nv-search__hint">检索中…</p>
      ) : hits.length === 0 ? (
        <p className="nv-search__hint">
          {keyword.trim() ? "没有命中任何片段" : "输入关键词开始检索"}
        </p>
      ) : (
        <ul className="nv-search__list">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="nv-search__item"
                onClick={() => onSelectChapter(hit.chapterId)}
              >
                <span className="nv-search__head">
                  <span className="nv-search__chapter">{hit.chapterTitle}</span>
                  <span className="nv-search__hit">{hit.count} 处</span>
                </span>
                <span className="nv-search__snippet">
                  {splitByKeyword(hit.snippet, keyword.trim()).map(
                    (segment, index) =>
                      segment.hit ? (
                        <mark key={index}>{segment.text}</mark>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      ),
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
