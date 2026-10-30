import { Button } from "antd";
import { ReloadOutlined, ScanOutlined, StopOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import { useConsistencyStore } from "../../store/useConsistencyStore";
import NvSegmented from "../NvSegmented";
import { formatClock } from "../../novel-utils";
import type { NovelChapter, NovelEntity, SettingCategory } from "../../types";
import "./index.scss";

interface ConsistencyPanelProps {
  /** 当前作品：切书即清空旧结果（上一本的问题列表对新书毫无意义） */
  workId: string;
  /** 全书章节（含正文）：校对的数据源 */
  chapters: NovelChapter[];
  /** 本书要素卡：人名的比对基准 */
  entities: NovelEntity[];
  /** 境界体系分类（kind === "realm"）：境界写法的比对基准，可为空 */
  realmCategory: SettingCategory | null;
  onNotify: (text: string, tone?: ToastTone) => void;
}

type IssueFilter = "all" | "name" | "realm";

const FILTER_OPTIONS = [
  { label: "全部", value: "all" },
  { label: "人名", value: "name" },
  { label: "境界", value: "realm" },
] as const;

/**
 * 一致性校对面板（工具箱二级面板，R-AI-10a）
 *
 * 特点是**完全不依赖 AI**：不配置模型也能用，纯本地比对要素卡与境界阶梯。
 * 这不是「AI 不可用时的降级」，而是这一功能本身就该在本地做——人名与境界
 * 都有明确比对基准，交给模型反而更贵、更不可复现（B6 判据①）。
 *
 * 列表只**提示**、绝不自动改正文（PRD 风险应对①）：一条误报如果自动改了
 * 一个字，作者要花十倍时间去核对自己没写错的地方。
 */
export default function ConsistencyPanel({
  workId,
  chapters,
  entities,
  realmCategory,
  onNotify,
}: ConsistencyPanelProps) {
  const status = useConsistencyStore((state) => state.status);
  const progress = useConsistencyStore((state) => state.progress);
  const issues = useConsistencyStore((state) => state.issues);
  const counts = useConsistencyStore((state) => state.counts);
  const scannedWorkId = useConsistencyStore((state) => state.workId);
  const scannedAt = useConsistencyStore((state) => state.scannedAt);
  const chapterCount = useConsistencyStore((state) => state.chapterCount);
  const scan = useConsistencyStore((state) => state.scan);
  const cancel = useConsistencyStore((state) => state.cancel);
  const reset = useConsistencyStore((state) => state.reset);
  const requestJump = useConsistencyStore((state) => state.requestJump);

  const [filter, setFilter] = useState<IssueFilter>("all");

  // 切作品：旧结果必须清掉，否则「这本书没问题」会是上一本的结论
  useEffect(() => {
    if (scannedWorkId && scannedWorkId !== workId) reset();
  }, [workId, scannedWorkId, reset]);

  const scanning = status === "scanning";
  /** 结果属于别的书 / 已过期（只是提示，不主动清，方便对照） */
  const stale = scannedWorkId !== null && scannedWorkId !== workId;

  const visible = useMemo(() => {
    if (filter === "all") return issues;
    return issues.filter((item) =>
      filter === "name" ? item.kind === "name-near-miss" : item.kind === "realm-variant",
    );
  }, [issues, filter]);

  /**
   * 扫描：把「比对基准」和「待扫正文」一次交出去。
   *
   * 境界阶梯在这里才展开成 {name, aliases}：`SettingLevel` 的别名含义是
   * 「写作里出现这些词也算引用本阶」，正是校对要的「已登记写法」。
   */
  const handleScan = useCallback((): void => {
    if (chapters.length === 0) {
      onNotify("这本书还没有章节", "info");
      return;
    }
    if (entities.length === 0 && !realmCategory) {
      onNotify("先建几张要素卡或一套境界体系，校对才有比对基准", "info");
      return;
    }
    scan({
      workId,
      chapters: chapters.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
      })),
      entities: entities.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        aliases: item.aliases,
      })),
      realmLevels: (realmCategory?.levels ?? []).map((level) => ({
        name: level.name,
        aliases: level.aliases,
      })),
    });
  }, [chapters, entities, realmCategory, scan, workId, onNotify]);

  return (
    <div className="nv-cc">
      <div className="nv-cc__actions">
        <Button
          className="nv-ghost"
          icon={
            scanning ? (
              <ReloadOutlined spin />
            ) : status === "done" ? (
              <ReloadOutlined />
            ) : (
              <ScanOutlined />
            )
          }
          disabled={scanning}
          onClick={handleScan}
        >
          {scanning
            ? `扫描中 ${Math.round(progress * 100)}%`
            : status === "done"
              ? "重新扫描"
              : "扫描全书"}
        </Button>
        {scanning && (
          <Button className="nv-ghost" icon={<StopOutlined />} onClick={cancel}>
            停止
          </Button>
        )}
      </div>

      <p className="nv-cc__hint">
        纯本地比对：拿要素卡的人名 / 别名与境界阶梯去核正文，不联网、不消耗 AI 额度；
        只提示，不改正文。
      </p>

      {status === "done" && (
        <div className="nv-cc__summary">
          <span className="nv-cc__stat">
            {chapterCount} 章 · 确定 {counts.sure} · 疑似 {counts.suspect}
          </span>
          {scannedAt !== null && (
            <span className="nv-cc__time">{formatClock(scannedAt)} 扫描</span>
          )}
        </div>
      )}

      {status === "done" && issues.length > 0 && (
        <NvSegmented<IssueFilter>
          ariaLabel="问题类型筛选"
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS.map((option) => ({
            ...option,
            count: option.value === "all" ? issues.length : counts[option.value],
          }))}
        />
      )}

      {stale && (
        <p className="nv-cc__hint nv-cc__hint--warn">
          以下结果来自其他作品，点「扫描全书」刷新
        </p>
      )}

      <div className="nv-cc__list">
        {scanning ? (
          <div className="nv-empty">
            <b>正在扫描</b>
            <span>已处理 {Math.round(progress * 100)}%，可以边等边写</span>
          </div>
        ) : status === "done" && visible.length > 0 ? (
          visible.map((issue) => (
            <Button
              key={issue.id}
              className={`nv-cc-hit nv-cc-hit--${issue.severity}`}
              title="跳到正文中的第一处"
              onClick={() => requestJump({ chapterId: issue.chapterId, from: issue.from })}
            >
              <span className="nv-cc-hit__head">
                <span className="nv-cc-hit__found">{issue.found}</span>
                <span className="nv-cc-hit__arrow">→</span>
                <span className="nv-cc-hit__expected">{issue.expected}</span>
                <span className={`nv-cc-hit__tag nv-cc-hit__tag--${issue.severity}`}>
                  {issue.severity === "sure" ? "确定" : "疑似"}
                </span>
                <span className="nv-cc-hit__count">{issue.count} 次</span>
              </span>
              <span className="nv-cc-hit__chapter">
                {issue.expectedLabel} · {issue.chapterTitle}
              </span>
              <span className="nv-cc-hit__snippet">{issue.evidence}</span>
            </Button>
          ))
        ) : status === "done" ? (
          <div className="nv-empty">
            <b>
              {issues.length === 0 ? "没有发现不一致" : "这一类没有问题"}
            </b>
            <span>
              {issues.length === 0
                ? `扫完 ${chapterCount} 章：人名写法与境界档位都对得上`
                : "切到「全部」看看其它类型"}
            </span>
          </div>
        ) : (
          <div className="nv-empty">
            <b>尚未扫描</b>
            <span>点「扫描全书」核一遍人名写法与境界档位，问题会列在这里</span>
          </div>
        )}
      </div>
    </div>
  );
}
