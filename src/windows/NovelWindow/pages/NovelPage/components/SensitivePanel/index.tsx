import { useMemo, useRef, useState } from "react";
import { Button, Empty, Input, Popconfirm, Segmented, Upload } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScanOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { UploadProps } from "antd";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import {
  buildWordList,
  parseImportedWords,
  SENSITIVE_MODE_META,
  type SensitiveHit,
  type SensitiveScanMode,
  type SensitiveWord,
} from "../../sensitive";
import { useSensitiveStore } from "../../store/useSensitiveStore";
import type { NovelChapter } from "../../types";
import "./index.scss";

interface SensitivePanelProps {
  /** 当前编辑章：手动「扫描本章」的兜底数据源 */
  chapterId: string | null;
  chapters: NovelChapter[];
  onNotify: (text: string, tone?: ToastTone) => void;
}

type PanelView = "result" | "words";
type ResultScope = "chapter" | "book";

const VIEW_OPTIONS = [
  { label: "检测结果", value: "result" },
  { label: "词库", value: "words" },
];

const SCOPE_OPTIONS = [
  { label: "本章", value: "chapter" },
  { label: "全书", value: "book" },
];

const MODE_OPTIONS = (Object.keys(SENSITIVE_MODE_META) as SensitiveScanMode[]).map(
  (mode) => ({ label: SENSITIVE_MODE_META[mode].label, value: mode }),
);

/**
 * 敏感词检测面板（工具箱二级面板）
 *
 * 两个视图：
 *   - 检测结果：扫描模式切换 + 扫描按钮 + 命中列表（点行跳正文定位）
 *   - 词库：新增 / 导入 / 编辑 / 删除；内置词只能「屏蔽」（可恢复）
 *
 * 状态全部来自模块级 store，面板本身只在 session 内持有「当前看哪个视图」
 * 这类纯 UI 状态——切走再切回，扫描结果与词库仍在。
 */
export default function SensitivePanel({
  chapterId,
  chapters,
  onNotify,
}: SensitivePanelProps) {
  const config = useSensitiveStore((state) => state.config);
  const setMode = useSensitiveStore((state) => state.setMode);
  const chapterResult = useSensitiveStore((state) => state.chapterResult);
  const chapterResultId = useSensitiveStore((state) => state.chapterResultId);
  const bookResult = useSensitiveStore((state) => state.bookResult);
  const scanningBook = useSensitiveStore((state) => state.scanningBook);
  const bookProgress = useSensitiveStore((state) => state.bookProgress);
  const scanCurrentChapter = useSensitiveStore((state) => state.scanCurrentChapter);
  const scanLatestDraft = useSensitiveStore((state) => state.scanLatestDraft);
  const scanBook = useSensitiveStore((state) => state.scanBook);
  const addWords = useSensitiveStore((state) => state.addWords);
  const removeWord = useSensitiveStore((state) => state.removeWord);
  const restoreBuiltin = useSensitiveStore((state) => state.restoreBuiltin);
  const renameWord = useSensitiveStore((state) => state.renameWord);
  const requestJump = useSensitiveStore((state) => state.requestJump);

  const [view, setView] = useState<PanelView>("result");
  const [scope, setScope] = useState<ResultScope>("chapter");
  const [newTerm, setNewTerm] = useState("");
  const [filter, setFilter] = useState("");
  /** 行内编辑：null = 没有正在编辑的词条 */
  const [editing, setEditing] = useState<{ from: string; value: string } | null>(
    null,
  );

  const words = useMemo(() => buildWordList(config), [config]);

  const visibleWords = useMemo(() => {
    const keyword = filter.trim();
    if (!keyword) return words;
    return words.filter((item) => item.term.includes(keyword));
  }, [words, filter]);

  const userCount = config.words.length;
  const builtinCount = words.length - userCount;

  // ── 扫描结果 ────────────────────────────────────────────────────

  const activeResult = scope === "book" ? bookResult : chapterResult;

  /**
   * 「本章」结果是否属于当前章。
   *
   * 切章后旧结果仍在 store 里（不主动清，方便回头对照），但拿上一章的命中
   * 去解释这一章的正文会误导，所以在面板上明确标出「结果来自其他章节」。
   */
  const resultStale =
    scope === "chapter" &&
    chapterResult !== null &&
    chapterResultId !== null &&
    chapterResultId !== chapterId;

  const handleScanChapter = (): void => {
    // 优先用编辑器上报的最新草稿（含未保存的输入）
    if (scanLatestDraft()) {
      setScope("chapter");
      return;
    }
    const chapter = chapters.find((item) => item.id === chapterId);
    if (!chapter) {
      onNotify("先打开一章再扫描", "info");
      return;
    }
    scanCurrentChapter({
      id: chapter.id,
      title: chapter.title,
      content: chapter.content,
    });
    setScope("chapter");
  };

  const handleScanBook = (): void => {
    if (chapters.length === 0) {
      onNotify("这本书还没有章节", "info");
      return;
    }
    scanBook(chapters);
    setScope("book");
  };

  // ── 词库操作 ────────────────────────────────────────────────────

  const handleAdd = (): void => {
    const term = newTerm.trim();
    if (!term) return;
    const { added, skipped } = addWords([term]);
    if (added === 0) {
      onNotify(skipped > 0 ? "词条已存在" : "词条无效", "info");
      return;
    }
    setNewTerm("");
  };

  const handleImport: UploadProps["beforeUpload"] = (file) => {
    void file
      .text()
      .then((content) => {
        const terms = parseImportedWords(content);
        if (terms.length === 0) {
          onNotify("没有解析到有效词条", "warning");
          return;
        }
        const { added, skipped } = addWords(terms);
        onNotify(
          skipped > 0
            ? `导入 ${added} 条，跳过 ${skipped} 条重复或无效`
            : `已导入 ${added} 条词条`,
          added > 0 ? "success" : "info",
        );
      })
      .catch(() => onNotify("文件读取失败", "error"));
    // 返回 false：禁止 antd 发起真实上传，文件只在本地解析
    return false;
  };

  /**
   * 行内编辑的「已提交」标记。
   *
   * Enter 提交后输入框失焦，onBlur 会再触发一次提交；此时 state 里的 editing
   * 还没被 React 刷新，闭包拿到的仍是旧值 —— 不加这个标记就会重命名两次，
   * 第二次必然撞「原词已不存在」而弹一条误报。
   */
  const committedRef = useRef<string | null>(null);

  const startEdit = (term: string): void => {
    committedRef.current = null;
    setEditing({ from: term, value: term });
  };

  const commitRename = (): void => {
    const current = editing;
    if (!current) return;
    if (committedRef.current === current.from) return;
    committedRef.current = current.from;

    if (current.value.trim() === current.from) {
      setEditing(null);
      return;
    }
    if (!renameWord(current.from, current.value)) {
      // 失败时留在编辑态，允许改完再提交
      committedRef.current = null;
      onNotify("重命名失败：名称为空、重复或不是自定义词条", "warning");
      return;
    }
    setEditing(null);
  };

  const handleRemove = (item: SensitiveWord): void => {
    removeWord(item.term);
    onNotify(
      item.origin === "builtin"
        ? `已屏蔽内置词「${item.term}」，可在词库底部恢复`
        : `已删除「${item.term}」`,
      "info",
    );
  };

  const renderHit = (hit: SensitiveHit) => (
    <Button
      key={`${hit.chapterId}:${hit.word}`}
      className="nv-sm-hit"
      title="跳到正文中的第一处"
      onClick={() => requestJump({ chapterId: hit.chapterId, from: hit.from })}
    >
      <span className="nv-sm-hit__head">
        <span className="nv-sm-hit__word">{hit.word}</span>
        <span className="nv-sm-hit__count">{hit.count} 次</span>
      </span>
      <span className="nv-sm-hit__chapter">{hit.chapterTitle}</span>
      <span className="nv-sm-hit__snippet">{hit.snippet}</span>
    </Button>
  );

  return (
    <div className="nv-sm">
      <div className="nv-sm__views">
        <Segmented
          block
          size="small"
          value={view}
          options={VIEW_OPTIONS}
          onChange={(value) => setView(value as PanelView)}
        />
      </div>

      {view === "result" ? (
        <>
          <div className="nv-sm__section">
            <span className="nv-sm__label">检测机制</span>
            <Segmented
              block
              size="small"
              value={config.mode}
              options={MODE_OPTIONS}
              onChange={(value) => setMode(value as SensitiveScanMode)}
            />
            <p className="nv-sm__hint">{SENSITIVE_MODE_META[config.mode].hint}</p>
          </div>

          <div className="nv-sm__actions">
            <Button
              className="nv-sm__btn"
              icon={<ScanOutlined />}
              disabled={config.mode === "off"}
              onClick={handleScanChapter}
            >
              扫描本章
            </Button>
            <Button
              className="nv-sm__btn"
              icon={scanningBook ? <ReloadOutlined spin /> : <DownloadOutlined />}
              disabled={config.mode === "off" || scanningBook}
              onClick={handleScanBook}
            >
              {scanningBook
                ? `扫描中 ${Math.round(bookProgress * 100)}%`
                : "扫描全书"}
            </Button>
          </div>

          {config.mode === "off" ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="检测已关闭，正文也不会高亮"
            />
          ) : (
            <>
              <div className="nv-sm__summary">
                <Segmented
                  size="small"
                  value={scope}
                  options={SCOPE_OPTIONS}
                  onChange={(value) => setScope(value as ResultScope)}
                />
                <span className="nv-sm__stat">
                  {activeResult
                    ? `${activeResult.total} 处 · ${activeResult.wordCount} 词 · ${activeResult.chapterCount} 章`
                    : "尚未扫描"}
                </span>
              </div>

              {resultStale && (
                <p className="nv-sm__hint nv-sm__hint--warn">
                  以下结果来自其他章节，点「扫描本章」刷新
                </p>
              )}

              <div className="nv-sm__list">
                {activeResult && activeResult.hits.length > 0 ? (
                  activeResult.hits.map(renderHit)
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      scope === "book" ? "全书未命中" : "本章未命中"
                    }
                  />
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="nv-sm__section">
            <Input
              size="small"
              value={newTerm}
              maxLength={40}
              placeholder="新增词条，回车添加"
              onChange={(event) => setNewTerm(event.target.value)}
              onPressEnter={handleAdd}
              suffix={
                <Button
                  className="nv-sm__icon-btn"
                  icon={<PlusOutlined />}
                  title="添加词条"
                  onClick={handleAdd}
                />
              }
            />
            <div className="nv-sm__actions">
              <Upload
                accept=".txt,.json"
                showUploadList={false}
                beforeUpload={handleImport}
              >
                <Button className="nv-sm__btn" icon={<DownloadOutlined />}>
                  导入词库
                </Button>
              </Upload>
              <span className="nv-sm__stat">
                内置 {builtinCount} · 自定义 {userCount}
              </span>
            </div>
          </div>

          <div className="nv-sm__section">
            <Input
              size="small"
              allowClear
              value={filter}
              placeholder="筛选词条"
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>

          <div className="nv-sm__list">
            {visibleWords.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的词条" />
            ) : (
              visibleWords.map((item) => (
                <div className="nv-sm-word" key={`${item.origin}:${item.term}`}>
                  {editing && editing.from === item.term ? (
                    <>
                      <Input
                        size="small"
                        autoFocus
                        value={editing.value}
                        maxLength={40}
                        onChange={(event) =>
                          setEditing({ from: item.term, value: event.target.value })
                        }
                        onKeyDown={(event) => {
                          // IME 组合期的 Enter 是在选候选词，不是提交
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename();
                          } else if (event.key === "Escape") {
                            setEditing(null);
                          }
                        }}
                        onBlur={commitRename}
                      />
                      <Button
                        className="nv-sm__icon-btn"
                        title="取消"
                        onClick={() => setEditing(null)}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="nv-sm-word__term">{item.term}</span>
                      <span
                        className={`nv-sm-word__origin${
                          item.origin === "user" ? " is-user" : ""
                        }`}
                      >
                        {item.origin === "user" ? "自定义" : "内置"}
                      </span>
                      <span className="nv-sm-word__ops">
                        {item.origin === "user" ? (
                          <>
                            <Button
                              className="nv-sm__icon-btn"
                              icon={<EditOutlined />}
                              title="重命名"
                              onClick={() => startEdit(item.term)}
                            />
                            <Popconfirm
                              title="删除这个词条？"
                              description="删除后不再参与检测，可重新添加"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => handleRemove(item)}
                            >
                              <Button
                                className="nv-sm__icon-btn"
                                icon={<DeleteOutlined />}
                                title="删除"
                              />
                            </Popconfirm>
                          </>
                        ) : (
                          <Button
                            className="nv-sm__icon-btn"
                            icon={<StopOutlined />}
                            title="屏蔽该内置词"
                            onClick={() => handleRemove(item)}
                          />
                        )}
                      </span>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {config.muted.length > 0 && (
            <div className="nv-sm__muted">
              <span className="nv-sm__label">已屏蔽 {config.muted.length} 条</span>
              <div className="nv-sm__muted-list">
                {config.muted.map((term) => (
                  <Button
                    key={term}
                    className="nv-sm__muted-chip"
                    title="点击恢复"
                    onClick={() => {
                      restoreBuiltin(term);
                      onNotify(`已恢复「${term}」`, "info");
                    }}
                  >
                    {term}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
