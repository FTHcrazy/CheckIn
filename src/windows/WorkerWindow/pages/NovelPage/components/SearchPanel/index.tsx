import { useEffect, useMemo } from "react";
import { CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Input } from "antd";
import { Virtuoso } from "react-virtuoso";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import { splitByKeyword } from "../../novel-utils";
import { registerSearchRunner, useSearchStore } from "../../store/useSearchStore";
import { useEdgeFade } from "../SupportPanel/useEdgeFade";
import type { SearchScope } from "../../store/useSearchStore";
import type { NovelEntity, SearchHit } from "../../types";
import "./index.scss";

/** 作用域按钮 */
const SCOPES: Array<{ key: SearchScope; label: string }> = [
  { key: "book", label: "全书" },
  { key: "chapter", label: "本章" },
  { key: "entity", label: "要素名" },
];

interface SearchPanelProps {
  /** 正文检索实现（searchBook）：只用于注册进 store，不作为检索触发条件 */
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

/**
 * 全书检索面板（PRD R10）
 *
 * 输入 300ms 防抖后才查库；命中词在片段里高亮，结果按章节聚合处数。
 * 命中列表用 Virtuoso 虚拟化：全书检索可能命中上千章，不允许全量挂载。
 * 作用域分三档：全书 / 本章 / 要素名——卡在某个人物写了什么时，
 * 「要素名」比在正文里翻片段快得多。
 *
 * 状态全部来自模块级 store（store/useSearchStore）：检索由状态自己调度，
 * 不挂在 effect 依赖数组上，因此父层重渲染 / 跳章保存都不会重跑检索，
 * 也不会闪骨架屏；切走 Tab 再回来关键词与结果仍在。
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

  const keyword = useSearchStore((state) => state.keyword);
  const scope = useSearchStore((state) => state.scope);
  const hits = useSearchStore((state) => state.hits);
  const loading = useSearchStore((state) => state.loading);
  const recent = useSearchStore((state) => state.recent);
  const setKeyword = useSearchStore((state) => state.setKeyword);
  const setScope = useSearchStore((state) => state.setScope);
  const clear = useSearchStore((state) => state.clear);
  // 最近搜索 chips 行横向溢出时两端渐隐提示（滚动条为隐藏设计）
  const { ref: chipsRef, fadeLeft: chipsFadeLeft, fadeRight: chipsFadeRight } =
    useEdgeFade<HTMLDivElement>();

  // 只做实现注册：identity 变化不再触发任何检索（此前这里是闪烁的根因）
  useEffect(() => {
    registerSearchRunner(onSearch);
    return () => registerSearchRunner(null);
  }, [onSearch]);

  const trimmed = keyword.trim();
  const isEntityScope = scope === "entity";

  /** 要素名作用域：内存比对，同步派生，零往返、无加载态 */
  const entityHits = useMemo<SearchHit[]>(() => {
    if (!trimmed || !isEntityScope) return [];
    const needle = trimmed.toLowerCase();
    return entities
      .filter((entity) =>
        `${entity.name} ${entity.aliases.join(" ")} ${entity.summary}`
          .toLowerCase()
          .includes(needle),
      )
      .map((entity) => ({
        id: `entity-${entity.id}`,
        chapterId: entity.id,
        chapterTitle: entity.name,
        count: 0,
        snippet: entity.summary,
      }));
  }, [trimmed, isEntityScope, entities]);

  /** 展示结果：全书直出；「本章」按当前编辑章过滤（渲染期，零往返） */
  const visible = useMemo(() => {
    if (isEntityScope) return entityHits;
    if (scope === "chapter" && activeChapterId) {
      return hits.filter((hit) => hit.chapterId === activeChapterId);
    }
    return hits;
  }, [isEntityScope, entityHits, scope, activeChapterId, hits]);

  const total = visible.reduce((sum, hit) => sum + hit.count, 0);

  /** 命中片段：关键词切成高亮片段 */
  const segments = useMemo(
    () => (hit: SearchHit) => splitByKeyword(hit.snippet, trimmed),
    [trimmed],
  );

  return (
    <div className="nv-search">
      <div className="nv-field nv-search__box">
        <SearchOutlined />
        <Input
          variant="borderless"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="全书检索"
          aria-label="全书检索"
        />
        {trimmed && !loading && (
          <span className="nv-search__count">
            {isEntityScope ? `${visible.length} 个要素` : `${total} 处 · ${visible.length} 章`}
          </span>
        )}
        {keyword && (
          <button
            type="button"
            className="nv-field__clear"
            aria-label="清空检索"
            onClick={clear}
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
              <div
                ref={chipsRef}
                className={`nv-chips${chipsFadeLeft ? " is-fade-left" : ""}${
                  chipsFadeRight ? " is-fade-right" : ""
                }`}
              >
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
      ) : visible.length === 0 ? (
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
                ? `${visible.length} 个`
                : `${total} 处 · ${visible.length} 章`}
            </em>
          </div>
          <Virtuoso
            className="nv-search__list"
            style={{ flex: 1, minHeight: 0 }}
            data={visible}
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
