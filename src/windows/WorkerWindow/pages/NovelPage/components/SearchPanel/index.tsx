import { useEffect, useMemo, useRef, useState } from "react";
import { CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Virtuoso } from "react-virtuoso";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import { splitByKeyword } from "../../novel-utils";
import type { NovelEntity, SearchHit } from "../../types";
import "./index.scss";

interface SearchPanelProps {
  onSearch: (keyword: string) => Promise<SearchHit[]>;
  onSelectChapter: (chapterId: string) => void;
  /** 要素名作用域：在本地要素库里查名称 / 别名 / 一句话 */
  entities: NovelEntity[];
  /** 当前编辑章：本章作用域的过滤依据 */
  activeChapterId: string | null;
  /** 当前编辑章显示名（「第三章 灵潮初现」） */
  activeChapterName: string;
  /** 要素名作用域点开要素详情 */
  onOpenEntity: (entityId: string) => void;
}

/** 检索作用域 */
type SearchScope = "book" | "chapter" | "entity";

const SCOPES: Array<{ key: SearchScope; label: string }> = [
  { key: "book", label: "全书" },
  { key: "chapter", label: "本章" },
  { key: "entity", label: "要素名" },
];

/** 最近搜索保留条数 */
const RECENT_LIMIT = 6;

/**
 * 全书检索面板（PRD R10）
 *
 * 输入 300ms 防抖后才查库；命中词在片段里高亮，结果按章节聚合处数。
 * 命中列表用 Virtuoso 虚拟化：全书检索可能命中上千章，不允许全量挂载。
 * 作用域分三档：全书 / 本章 / 要素名——卡在某个人物写了什么时，
 * 「要素名」比在正文里翻片段快得多。
 */
export default function SearchPanel({
  onSearch,
  onSelectChapter,
  entities,
  activeChapterId,
  activeChapterName,
  onOpenEntity,
}: SearchPanelProps) {
  const { metaOf } = useEntityTypeMeta();
  const [keyword, setKeyword] = useState("");
  const [scope, setScope] = useState<SearchScope>("book");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const timerRef = useRef<number | null>(null);

  const trimmed = keyword.trim();

  useEffect(() => {
    if (!trimmed) {
      setHits([]);
      setLoading(false);
      return undefined;
    }

    // 要素名作用域不走正文检索：直接在内存要素库里比对，零往返
    if (scope === "entity") {
      setLoading(false);
      setHits(
        entities
          .filter((entity) =>
            `${entity.name} ${entity.aliases.join(" ")} ${entity.summary}`
              .toLowerCase()
              .includes(trimmed.toLowerCase()),
          )
          .map((entity) => ({
            id: `entity-${entity.id}`,
            chapterId: entity.id,
            chapterTitle: entity.name,
            count: 0,
            snippet: entity.summary,
          })),
      );
      setRecent((current) =>
        current.includes(trimmed)
          ? current
          : [trimmed, ...current].slice(0, RECENT_LIMIT),
      );
      return undefined;
    }

    setLoading(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void onSearch(trimmed).then((result) => {
        const scoped =
          scope === "chapter" && activeChapterId
            ? result.filter((hit) => hit.chapterId === activeChapterId)
            : result;
        setHits(scoped);
        setLoading(false);
        setRecent((current) =>
          current.includes(trimmed)
            ? current
            : [trimmed, ...current].slice(0, RECENT_LIMIT),
        );
      });
    }, 300);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [trimmed, scope, onSearch, entities, activeChapterId]);

  const total = hits.reduce((sum, hit) => sum + hit.count, 0);

  /** 命中片段：关键词切成高亮片段 */
  const segments = useMemo(
    () => (hit: SearchHit) => splitByKeyword(hit.snippet, trimmed),
    [trimmed],
  );

  const isEntityScope = scope === "entity";

  return (
    <div className="nv-search">
      <div className="nv-field nv-search__box">
        <SearchOutlined />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="全书检索"
          aria-label="全书检索"
        />
        {trimmed && !loading && (
          <span className="nv-search__count">
            {isEntityScope ? `${hits.length} 个要素` : `${total} 处 · ${hits.length} 章`}
          </span>
        )}
        {keyword && (
          <button
            type="button"
            className="nv-field__clear"
            aria-label="清空检索"
            onClick={() => setKeyword("")}
          >
            <CloseOutlined />
          </button>
        )}
      </div>

      <div className="nv-sub nv-search__scopes">
        {SCOPES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nv-sub__btn${scope === item.key ? " is-on" : ""}`}
            disabled={item.key === "chapter" && !activeChapterId}
            title={item.key === "chapter" && !activeChapterId ? "先选一章" : undefined}
            onClick={() => setScope(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <>
          <div className="nv-sechead">检索中</div>
          <div className="nv-search__pending">
            <i />
            <i style={{ width: "82%" }} />
            <i style={{ width: "64%" }} />
          </div>
        </>
      ) : !trimmed ? (
        <>
          {recent.length > 0 && (
            <>
              <div className="nv-sechead">最近搜索</div>
              <div className="nv-chips">
                {recent.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="nv-chip"
                    onClick={() => setKeyword(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="nv-empty">
            <b>输入关键词开始检索</b>
            <span>
              {scope === "chapter" && activeChapterName
                ? `当前作用域：本章（${activeChapterName}）`
                : scope === "entity"
                  ? "当前作用域：要素名（名称 / 别名 / 一句话）"
                  : "命中按章节聚合，点一条即跳到该章"}
            </span>
          </div>
        </>
      ) : hits.length === 0 ? (
        <div className="nv-empty">
          <b>没有命中任何片段</b>
          <span>换个说法再试一次</span>
        </div>
      ) : (
        <>
          <div className="nv-sechead">
            {isEntityScope ? "要素" : "命中"}
            <em>
              {isEntityScope
                ? `${hits.length} 个`
                : `${total} 处 · ${hits.length} 章`}
            </em>
          </div>
          <Virtuoso
            className="nv-search__list"
            style={{ flex: 1, minHeight: 0 }}
            data={hits}
            overscan={8}
            computeItemKey={(_, hit) => hit.id}
            itemContent={(_, hit) => {
              const meta = isEntityScope
                ? metaOf(
                    entities.find((entity) => entity.id === hit.chapterId)?.type ??
                      "custom",
                  )
                : null;
              return (
                <div className="nv-search__item">
                  <button
                    type="button"
                    className="nv-search__hit"
                    onClick={() =>
                      isEntityScope
                        ? onOpenEntity(hit.chapterId)
                        : onSelectChapter(hit.chapterId)
                    }
                  >
                    <span className="nv-search__head">
                      <span className="nv-search__chapter">
                        {hit.chapterTitle}
                      </span>
                      {meta && (
                        <span
                          className="nv-search__kind"
                          style={{ color: meta.color, background: meta.colorWeak }}
                        >
                          {meta.label}
                        </span>
                      )}
                      {!isEntityScope && (
                        <span className="nv-search__n">{hit.count} 处</span>
                      )}
                    </span>
                    <span className="nv-search__snippet">
                      {segments(hit).map((segment, index) =>
                        segment.hit ? (
                          <mark key={index}>{segment.text}</mark>
                        ) : (
                          <span key={index}>{segment.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                </div>
              );
            }}
          />
        </>
      )}
    </div>
  );
}
