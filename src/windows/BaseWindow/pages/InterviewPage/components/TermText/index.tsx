import { useState, type ReactNode } from "react";
import { Button, Dropdown, Popover, Tag, type MenuProps } from "antd";
import { highlightSegments } from "../../data/interview-filter-utils";
import {
  GLOSSARY_DOMAIN_LABEL,
  glossaryById,
  splitByGlossary,
  type GlossaryTerm,
} from "../../data/interview-glossary";
import type { GlossaryMatchIndex } from "../../persistence/glossary-matcher";
import { isChipClickSuppressed } from "../../hooks/useSelectionTerms";
import { useGlossaryMatchIndex } from "../InterviewBankProvider/match-index-context";
import { useTermAction } from "./term-action-context";
import { UNBIND_KEY, EDIT_KEY, aliasOfMenuKey, buildTermMenu, isTermMenuGroup } from "./term-menu";
import "./index.scss";

/** 引用稳定的空数组：绝大多数命中没有同名词条，每次新建数组会让 `TermChip` 白渲染 */
const EMPTY_VARIANTS: GlossaryTerm[] = [];

interface TermTextProps {
  /** 纯文本（不含 `**` / 反引号等标记，标记由调用方先解析） */
  text: string;
  /** 当前搜索词，命中处仍要高亮，否则搜索结果里被术语吃掉的部分看起来没命中 */
  keyword?: string;
}

/**
 * 给片段补上「在完整原文里的起止下标」。
 *
 * 抽成模块级纯函数的两个理由：
 * 1. 组件体里累加游标会被 `react-hooks/immutability` 判成「渲染期间改闭包变量」；
 * 2. 划词反算偏移是纯计算，放在这里可以直接被单测覆盖。
 *
 * `data-text-*` 是划词的锚点：选区落在哪个片段上，就从它的起始下标 +
 * `range.startOffset` 反算出原文区间（规范 §10.2）。
 */
function withOffsets(
  segments: readonly { text: string }[],
  base: number,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let cursor = base;
  for (const segment of segments) {
    const start = cursor;
    cursor += segment.text.length;
    out.push({ start, end: cursor });
  }
  return out;
}

/** 关键词高亮：只包文本节点，不产生 HTML 字符串 */
function KeywordText({
  text,
  keyword,
  offset = 0,
}: {
  text: string;
  keyword: string;
  /** 这段文字在**完整原文**里的起始下标（划词反算偏移用） */
  offset?: number;
}): ReactNode {
  const segments = highlightSegments(text, keyword);
  const anchors = withOffsets(segments, offset);
  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark
            className="interview-term__mark"
            key={`hit-${index}`}
            data-text-start={anchors[index].start}
            data-text-end={anchors[index].end}
          >
            {segment.text}
          </mark>
        ) : (
          <span
            key={`plain-${index}`}
            data-text-start={anchors[index].start}
            data-text-end={anchors[index].end}
          >
            {segment.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * 名词按钮。
 *
 * 用 `Button type="text"` 承载而不是自绘 `<span onClick>`：键盘可达性、焦点环、
 * 禁用语义都由组件库给（AGENTS §6.1.2）。外观在 index.scss 里清成「行内下划线」。
 *
 * `glossaryIndex` 可选：有合并视图时用它反查 `related`（用户新增的词条也能跳），
 * 没有时回落模块级基线函数 —— 两条路径的渲染结果完全一致。
 *
 * 交互：
 *   - 左键 → 名词弹层（定义 + 细节 + 同名词条的其它解释）；
 *   - 右键 → 维护菜单（`这里不是这个词` / `删掉别名`），见 `term-menu.ts`。
 *     右键菜单只在**正文里的命中**上挂：行内代码那种「整段相等」没有位置信息，
 *     解除负例也无处可存。
 */
function TermChip({
  text,
  term,
  keyword = "",
  code = false,
  glossaryIndex,
  offset,
  hitKey = "",
  variants = [],
  paragraph = "",
}: {
  text: string;
  term: GlossaryTerm;
  keyword?: string;
  code?: boolean;
  glossaryIndex?: GlossaryMatchIndex;
  /** 这段命中词在完整原文里的起止（划词反算偏移用；不传则不挂锚点） */
  offset?: { start: number; end: number };
  /** 本次命中用的匹配键（小写归一）；决定右键菜单里能不能「删掉别名」 */
  hitKey?: string;
  /** 同一个键的其它词条（同名不同领域），弹层里并列展示 */
  variants?: GlossaryTerm[];
  /** 这段命中所在的完整原文：右键解除要用它算左右各 6 字的窗口 */
  paragraph?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  /**
   * 同名词条里正在看哪一条（`null` = 主匹配）。
   *
   * 词名相同、解释不同的情况真实存在（「节流」在浏览器性能与 RxJS 里不是一回事），
   * 而一段文字只能点亮一个按钮 —— 主匹配只取一条，其余放 `variants`。没有切换
   * 入口的话，后建的那条在正文里永远看不到。
   */
  const [focusId, setFocusId] = useState<string | null>(null);
  const action = useTermAction();
  const termOf = (id: string): GlossaryTerm | undefined =>
    glossaryIndex ? glossaryIndex.byId(id) : glossaryById(id);

  const alternatives = variants.filter((item) => item.id !== term.id);
  const shown = (focusId ? alternatives.find((item) => item.id === focusId) : undefined) ?? term;
  const related = (shown.related ?? [])
    .map((id) => termOf(id))
    .filter((item): item is GlossaryTerm => Boolean(item));

  /** 右键菜单：没有 Provider（组件测试 / 无通道）或没有位置信息时不挂 */
  const menuNodes =
    action && offset
      ? buildTermMenu({ term, hitText: text, hitKey, canEdit: Boolean(action.editTerm) })
      : [];
  const menuItems: MenuProps["items"] = menuNodes.map((node) =>
    isTermMenuGroup(node)
      ? {
          key: node.key,
          label: node.label,
          children: node.children.map((child) => ({ key: child.key, label: child.label })),
        }
      : { key: node.key, label: node.label },
  );

  const onMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (!action || !offset) return;
    // 右键菜单点完就收起：动作是破坏性的，让用户立刻看到那段文字的变化
    setOpen(false);
    const alias = aliasOfMenuKey(key);
    if (alias) {
      action.removeAlias(term, alias);
      return;
    }
    if (key === EDIT_KEY) {
      // 编辑的是**当前看着的那条**（`shown`），不是主匹配：同名词条可以分别纠错
      action.editTerm?.(shown);
      return;
    }
    if (key === UNBIND_KEY) {
      // 传整段原文 + 绝对区间：窗口规则必须与匹配器同一份实现（`muteContextOf`）
      action.unbind({
        term,
        key: hitKey || term.term,
        text: paragraph || text,
        start: offset.start,
        end: offset.end,
      });
    }
  };

  const panel = (
    <div className="interview-term__panel">
      <div className="interview-term__panel-head">
        <strong className="interview-term__panel-title">{shown.term}</strong>
        {shown.en && shown.en !== shown.term ? (
          <span className="interview-term__panel-en">{shown.en}</span>
        ) : null}
        <Tag className="interview-term__panel-domain">
          {GLOSSARY_DOMAIN_LABEL[shown.domain]}
        </Tag>
      </div>
      <p className="interview-term__panel-short">{shown.short}</p>
      <ul className="interview-term__panel-points">
        {shown.detail.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {alternatives.length > 0 ? (
        <div className="interview-term__panel-variants">
          <span className="interview-term__panel-variants-label">
            同名词条 {alternatives.length + 1} 条（按领域分开）：
          </span>
          {[term, ...alternatives].map((item) => (
            <Button
              className={`interview-term__variant${item.id === shown.id ? " is-active" : ""}`}
              type="text"
              size="small"
              key={item.id}
              onClick={() => setFocusId(item.id === term.id ? null : item.id)}
            >
              {GLOSSARY_DOMAIN_LABEL[item.domain]}
              {item.id === term.id ? "（默认）" : ""}
            </Button>
          ))}
        </div>
      ) : null}
      {related.length > 0 ? (
        <p className="interview-term__panel-related">
          另见：{related.map((item) => item.term).join(" / ")}
        </p>
      ) : null}
      {action?.editTerm ? (
        <div className="interview-term__panel-ops">
          <Button
            className="interview-term__edit"
            type="text"
            size="small"
            onClick={() => {
              // 先收起弹层：编辑抽屉一开就是几百毫秒的表单操作，
              // 留着弹层只会挡在抽屉底下
              setOpen(false);
              action.editTerm?.(shown);
            }}
          >
            编辑词条
          </Button>
        </div>
      ) : null}
    </div>
  );

  const chip = (
    <Popover
      trigger="click"
      placement="top"
      arrow={false}
      open={open}
      onOpenChange={(next) => {
        // 拖选的终点常常正好落在这个按钮上：刚划完词的那一下 click 不该同时
        // 打开名词弹层（两套浮层会叠在一起）。抑制窗口由 `useSelectionTerms` 置。
        if (next && isChipClickSuppressed()) {
          setOpen(false);
          return;
        }
        setOpen(next);
      }}
      classNames={{ root: "interview-term__pop" }}
      content={panel}
    >
      <Button
        className={`interview-term${code ? " is-code" : ""}`}
        type="text"
        aria-label={`名词解释：${term.term}`}
        aria-expanded={open}
        {...(offset
          ? { "data-text-start": offset.start, "data-text-end": offset.end }
          : {})}
      >
        {keyword ? (
          // 按钮内部的关键词高亮也要带上绝对偏移：`KeywordText` 默认从 0 起算，
          // 落在这里就会把「整段原文的第几个字」算成「这个按钮里的第几个字」，
          // 划词反算偏移时得到的是错的位置
          <KeywordText text={text} keyword={keyword} offset={offset?.start ?? 0} />
        ) : (
          text
        )}
      </Button>
    </Popover>
  );

  // 菜单必须有位置信息才挂得上：`offset` 为 `undefined` 的调用点（行内代码）
  // 直接渲染 chip，右键不会弹出「这个菜单点了也没用」的菜单
  if (!action || !offset) return chip;

  return (
    /**
     * `Dropdown` 包在外层、`Popover` 包在内层。
     *
     * 两层都要 clone 一次 child 来挂事件（Dropdown 挂 `onContextMenu`、
     * Popover 挂 `onClick`）。反过来套就会丢事件：Dropdown 不认识
     * `onClick` 这个 prop，它 clone 时只透传自己关心的事件 —— 左键就打不开
     * 弹层了。中间垫一个原生 `span` 是最省事的做法：Dropdown clone 的是
     * DOM 节点，属性原样落到元素上。
     */
    <Dropdown
      trigger={["contextMenu"]}
      menu={{ items: menuItems, onClick: onMenuClick }}
      disabled={action.busy}
      onOpenChange={(next) => {
        // 右键时收起左键弹层，免得两个浮层叠在同一个词上
        if (next) setOpen(false);
      }}
    >
      <span className="interview-term__hit">{chip}</span>
    </Dropdown>
  );
}

/**
 * 名词感知的文本渲染器。
 *
 * 题干、标题、答案段落都经过这里：命中的名词变成可点击按钮，点击弹出
 * 「一句话定义 + 细节 + 相关词」。未命中时退化为普通文本 + 关键词高亮，
 * 因此可以放心地全量替换原来的 `Highlighted`。
 *
 * 词表来源：有 `InterviewBankProvider` 时用**合并后**的匹配器
 * （`buildGlossaryIndex(merged.glossary)`，能认出用户新增 / 覆盖的词条）；
 * 页面还会再套一层「按当前分类优先」的偏好实例（`useGlossaryMatchIndex`，
 * 同名词条在不同分类下指向不同的解释）。
 * 没有 Provider 时用模块级基线 `splitByGlossary`。两条路径都产出
 * `GlossarySegment[]`，下游渲染结构完全一致 —— 这是既有测试能继续跑的原因。
 */
export default function TermText({ text, keyword = "" }: TermTextProps): ReactNode {
  // hook 必须在任何提前 return 之前调用
  const glossaryIndex = useGlossaryMatchIndex();

  if (text.length === 0) return null;
  const segments = glossaryIndex ? glossaryIndex.split(text) : splitByGlossary(text);
  /**
   * 逐片段补齐原文偏移：`buildGlossaryIndex` 的命中片段自带 `start` / `end`，
   * 基线 `splitByGlossary` 不带。累加游标放在模块级纯函数里做（组件体里改闭包
   * 变量会被 `react-hooks/immutability` 拦），结果与片段一一对应。
   */
  const anchors = withOffsets(segments, 0);

  return (
    /**
     * 外层 `span` 不是多余的包装：它是划词反算的「原文边界」。
     *
     * 片段上的 `data-text-start/end` 只是「本片段在完整原文里的位置」，要把它变成
     * 真实的子串需要一个「完整原文」——`getSelection().toString()` 在跨高亮词的
     * 选区上会把相邻词算进来（划 `weak map` 时把 `map` 一起带上）。把原文挂在
     * 最近公共祖先上，`useSelectionTerms` 就能 `slice(start, end)` 取到精确区间。
     */
    <span className="interview-term-text" data-text-full={text}>
      {segments.map((segment, index) => {
        const start = segment.start ?? anchors[index].start;
        const end = segment.end ?? anchors[index].end;
        return segment.term ? (
          <TermChip
            text={segment.text}
            term={segment.term}
            keyword={keyword}
            glossaryIndex={glossaryIndex}
            offset={{ start, end }}
            hitKey={segment.key ?? ""}
            variants={segment.variants ?? EMPTY_VARIANTS}
            paragraph={text}
            key={`term-${segment.term.id}-${index}`}
          />
        ) : (
          <KeywordText
            text={segment.text}
            keyword={keyword}
            offset={start}
            key={`text-${index}`}
          />
        );
      })}
    </span>
  );
}

/** 行内代码里的名词：整段相等才算命中，由渲染层先判断再决定用哪个组件 */
export { TermChip };
