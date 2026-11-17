/**
 * T06-A 接线验收：**合并出来的数据真的到了用户眼前**。
 *
 * 这一层不重复 `useInterviewBank` / `interview-bank-source` 的单测（那两份已经在验
 * 「状态对不对」）。这里只回答一个问题：把整页 `<InterviewPage />` 渲染起来、
 * 让 IPC 通道返回库内增量之后，**用户能不能看见它**——列表里的卡片、总数角标、
 * 正文里变蓝的名词、图解标签。
 *
 * 为什么必须做到页面级：`useInterviewPage` 里 `QUESTIONS` 那一行、
 * `TermText` 里 `glossaryIndex ?? splitByGlossary` 那一行、Provider 挂在哪一层，
 * 这三处接错都**不会让任何单测变红**，用户看到的却是「我的题不见了」
 * 「我加的词条不变蓝」。
 *
 * 断言一律落在 DOM（`.interview-card__title` / `.interview-card` /
 * `.interview-search__count` / `button[aria-label^="名词解释"]`），不看 hook 内部状态。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElectronAPI, InterviewItemDetailDTO } from "@/shared/types/electron";
import InterviewPage from "../InterviewPage";
import InterviewBankProvider from "../components/InterviewBankProvider";
import { useInterviewBankContext } from "../components/InterviewBankProvider/context";
import QuestionCard from "../components/QuestionCard";
import TermText from "../components/TermText";
import { FAVORITES_STORAGE_KEY } from "../data/favorites-storage";
import { QUESTION_BANK } from "../data/interview-bank";
import { diagramById } from "../data/interview-diagrams";
import { GLOSSARY_TERMS, splitByGlossary } from "../data/interview-glossary";
import {
  PAGE_SIZE,
  createInitialFilterState,
  filterQuestions,
  sortQuestions,
} from "../data/interview-filter-utils";
import type { InterviewQuestion } from "../data/interview-types";
import { buildGlossaryIndex } from "../persistence/glossary-matcher";
import { buildMergeBaseline, toMergeRows } from "../persistence/interview-bank-source";

// ──────────────────────────── 桩与夹具 ────────────────────────────

/**
 * `QuestionCard` 的维护动作 props（T08-A 引入）。
 *
 * 这个文件测的是**合并结果有没有渲染到界面上**，不是维护动作本身
 * （那条链路由 `hooks/useQuestionOverride.test.tsx` 与页面级用例守着）。
 * 单独渲染卡片时统一给一套空实现，免得三处调用点各写六行。
 */
const CARD_ACTION_PROPS = {
  stale: false,
  pending: false,
  onEdit: () => {},
  onHide: () => {},
  onRevert: () => {},
  onDeleteNew: () => {},
  onAckBase: () => {},
};

/** 装一份（不完整的）`window.electronAPI.interview` 桩 */
function mountInterviewApi(interview: Partial<ElectronAPI["interview"]>): void {
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: { interview } as unknown as ElectronAPI,
  });
}

/** 用固定结果装一个 `itemsList` 桩 */
function mountItems(items: InterviewItemDetailDTO[]): void {
  mountInterviewApi({ itemsList: vi.fn(async () => items) as never });
}

/** 一条题库行（默认是一条「用户新建的合法题」） */
function makeItem(overrides: Partial<InterviewItemDetailDTO> = {}): InterviewItemDetailDTO {
  return {
    id: "u-q-e2e",
    kind: "question",
    action: "new",
    baseId: null,
    status: "adopted",
    origin: "manual",
    categoryId: "foundation-js",
    track: "foundation",
    title: "端到端验证题：合并视图接线",
    errors: [],
    updatedAt: 1_760_000_000_000,
    payload: {
      id: "u-q-e2e",
      title: "端到端验证题：合并视图接线",
      stem: "这道题只存在于本地库里，源码基线里没有它。",
      answer: "因为合并视图把 interview.db 的增量叠在了基线之上。",
      track: "foundation",
      categoryId: "foundation-js",
      difficulty: "medium",
      tags: ["合并视图"],
      topic: "题库增量",
      reviewedAt: "2026-01",
      heat: 60,
      // 排到最前：默认排序是 updatedAt 倒序，用远期日期保证它在第一页
      updatedAt: "2099-12-31",
    },
    sourceIntent: null,
    aiLogId: null,
    baseStamp: null,
    baseHash: null,
    ackBaseHash: null,
    reviewedAt: null,
    createdAt: 1_760_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

/** 默认筛选（基础知识库 / 全部分类 / 按更新倒序）下第一页的顺序 = 用户实际看到的顺序 */
function firstPageQuestions(): InterviewQuestion[] {
  const filtered = filterQuestions(QUESTION_BANK, createInitialFilterState(), new Set<string>());
  return sortQuestions(filtered, "updated").slice(0, PAGE_SIZE);
}

function cardTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".interview-card__title")).map(
    (node) => node.textContent ?? "",
  );
}

/** 顶部「当前条件命中 N 题」的 N */
function totalCount(): number {
  const node = document.querySelector(".interview-search__count");
  if (!node) throw new Error("找不到命中数角标 .interview-search__count");
  return Number(node.textContent);
}

function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".interview-card"));
}

/** 左侧分类栏某个分类的角标数 */
function sidebarCount(container: HTMLElement, label: string): number {
  const item = Array.from(
    container.querySelectorAll<HTMLElement>(".interview-cats__item"),
  ).find((node) => node.querySelector(".interview-cats__label")?.textContent === label);
  if (!item) throw new Error(`找不到分类项：${label}`);
  return Number(item.querySelector(".interview-cats__count")?.textContent ?? "-1");
}

function searchFor(keyword: string): void {
  const input = screen.getByPlaceholderText(/搜索题目/);
  fireEvent.change(input, { target: { value: keyword } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
}

/**
 * 从真实题干里挑一个「基线词表不认识」的中文词。
 *
 * 为什么这么挑：要证明「用户新增的词条会变蓝」，就必须保证那个词
 * ① 真的出现在渲染出来的题干里；② 基线词表里没有它（否则变蓝是基线本来的行为，
 * 断言就成了空跑）。从题干里截子串同时满足两条。
 */
function pickUncoveredTerm(stem: string): string {
  const index = buildGlossaryIndex(GLOSSARY_TERMS);
  for (let length = 4; length >= 2; length -= 1) {
    for (let start = 0; start + length <= stem.length; start += 1) {
      const candidate = stem.slice(start, start + length);
      if (!/^[\u4e00-\u9fa5]+$/.test(candidate)) continue;
      // 两个实现都不认识它，才算「基线里没有这个词」
      if (splitByGlossary(candidate).some((segment) => segment.term)) continue;
      if (index.split(candidate).some((segment) => segment.term)) continue;
      return candidate;
    }
  }
  throw new Error(`题干里找不到未被基线词表覆盖的中文片段：${stem.slice(0, 20)}…`);
}

/** 一条「用户新增的词条」行 */
function makeNewGlossaryItem(term: string, short: string): InterviewItemDetailDTO {
  return makeItem({
    id: "u-g-e2e",
    kind: "glossary",
    action: "new",
    title: term,
    payload: {
      id: "u-g-e2e",
      term,
      domain: "javascript",
      short,
      detail: ["这条词条来自本地库，源码基线里没有它。"],
    },
  });
}

/**
 * 用户看到的「命中 N 题」是**默认筛选之后**的条数（默认落在基础知识库），
 * 不等于题库总量 —— 这里必须用同一套筛选函数算，否则断言会盯着一个假数。
 */
const BASELINE_VISIBLE = filterQuestions(
  QUESTION_BANK,
  createInitialFilterState(),
  new Set<string>(),
).length;

/** 题库总量（卡片数据源的条数，用于 Provider 探针） */
const BANK_SIZE = QUESTION_BANK.length;

/** 默认筛选下 JavaScript 分类的角标数（新增题就落在这个分类里） */
const BASELINE_JS = QUESTION_BANK.filter(
  (question) => question.track === "foundation" && question.categoryId === "foundation-js",
).length;

const originalElectronApi = Object.getOwnPropertyDescriptor(window, "electronAPI");

describe("T06-A 接线验收（合并数据 → 用户眼前）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // 默认不装桩：每个用例自己决定有没有 IPC 通道
    window.electronAPI = undefined;
  });

  afterEach(() => {
    cleanup();
    window.electronAPI = undefined;
    if (originalElectronApi) {
      Object.defineProperty(window, "electronAPI", originalElectronApi);
    }
  });

  // ────────────────── ① 端到端：合并数据真的渲染出来 ──────────────────

  describe("① 合并数据真的渲染到界面上", () => {
    it("库里新增的题出现在第一页卡片里，且总数 +1", async () => {
      mountItems([makeItem()]);

      const { container } = render(<InterviewPage />);

      // 首帧是基线（默认轨道下的命中数），IPC 回来后必须 +1 且新题排在最前
      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE + 1));

      const titles = cardTitles(container);
      expect(titles[0]).toBe("端到端验证题：合并视图接线");
      expect(titles).toHaveLength(PAGE_SIZE);
      // 题干也在页面上（不只是标题）
      expect(container.textContent).toContain("这道题只存在于本地库里");
      // 侧栏角标也要跟着合并结果走（角标算错 = 「角标 206、点进去 207」）
      expect(sidebarCount(container, "全部分类")).toBe(BASELINE_VISIBLE + 1);
      expect(sidebarCount(container, "JavaScript")).toBe(BASELINE_JS + 1);
    });

    it("用搜索框能搜到库里新增的题（证明它进了筛选池，不是只画了一张卡）", async () => {
      mountItems([makeItem()]);

      const { container } = render(<InterviewPage />);
      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE + 1));

      searchFor("端到端验证题：合并视图接线");

      await waitFor(() => expect(totalCount()).toBe(1));
      const remaining = cardTitles(container);
      expect(remaining).toEqual(["端到端验证题：合并视图接线"]);
      expect(container.querySelector("mark")).not.toBeNull();
    });

    it("覆盖基线题之后，卡片上显示的是**改后的标题**，不是基线标题", async () => {
      const target = firstPageQuestions()[0];
      const myTitle = `【我的版本】${target.title}`;
      mountItems([
        makeItem({
          id: target.id,
          kind: "question",
          action: "override",
          baseId: target.id,
          title: myTitle,
          categoryId: target.categoryId,
          payload: { ...target, title: myTitle, answer: `${target.answer}（我补的一段）` },
          baseHash: null,
        }),
      ]);

      const { container } = render(<InterviewPage />);

      await waitFor(() => expect(cardTitles(container)).toContain(myTitle));
      // 总数不变：覆盖不是新增
      expect(totalCount()).toBe(BASELINE_VISIBLE);
      // 被覆盖的那道题不该再以基线标题出现
      expect(cardTitles(container)).not.toContain(target.title);
      expect(cardTitles(container)[0]).toBe(myTitle);

      // 展开后答案也应该是我的版本（懒挂载：先展开才渲染）
      fireEvent.click(container.querySelector<HTMLElement>(".interview-card__toggle") as HTMLElement);
      expect(container.querySelector(".interview-card__answer.is-open")?.textContent).toContain(
        "我补的一段",
      );
    });
  });

  // ────────────────── ② hidden 从界面上消失 ──────────────────

  describe("② hidden 墓碑：题从界面上消失，总数减一", () => {
    it("藏掉一道基线题 → 命中数 −1、卡片里不再有它", async () => {
      const target = firstPageQuestions()[0];

      // 对照组：不藏时它确实在页面上（否则下面「不出现」可能是本来就看不到）
      mountItems([]);
      const baseline = render(<InterviewPage />);
      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE));
      expect(cardTitles(baseline.container)[0]).toBe(target.title);
      baseline.unmount();

      mountItems([
        makeItem({
          id: target.id,
          kind: "question",
          action: "override",
          baseId: target.id,
          status: "hidden",
          title: target.title,
          categoryId: target.categoryId,
          payload: null,
        }),
      ]);

      const { container } = render(<InterviewPage />);
      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE - 1));

      expect(cardTitles(container)).not.toContain(target.title);
      expect(container.textContent).not.toContain(target.title);
      expect(cards(container)).toHaveLength(PAGE_SIZE);
    });

    it("对照组：同样一条 mock 通道真的被消费了（新增题会把命中数顶上去）", async () => {
      // 与上一条配对：证明「242」不是「通道没生效回落基线」的假象
      mountItems([makeItem()]);

      render(<InterviewPage />);
      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE + 1));
    });
  });

  // ────────────────── ③ 用户新增的词条真的会变蓝 ──────────────────

  describe("③ 新增词条变蓝（matcher 按合并结果重建）", () => {
    it("库里新增的词条，让题干里那个词变成可点名词，点开能看到定义", async () => {
      const target = firstPageQuestions()[0];
      const term = pickUncoveredTerm(target.stem);
      const short = "端到端验证：这条定义只存在于本地库。";
      mountItems([makeNewGlossaryItem(term, short)]);

      const { container } = render(<InterviewPage />);
      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE));

      // 页面里还没有「词条数」角标，等一个微任务让 IPC 结果落地
      await waitFor(() =>
        expect(
          container.querySelector(`button[aria-label="名词解释：${term}"]`),
        ).not.toBeNull(),
      );

      const chip = container.querySelector<HTMLElement>(
        `button[aria-label="名词解释：${term}"]`,
      ) as HTMLElement;
      expect(chip.textContent).toBe(term);

      fireEvent.click(chip);
      const panel = document.querySelector(".interview-term__panel");
      expect(panel).not.toBeNull();
      expect(panel?.querySelector(".interview-term__panel-short")?.textContent).toBe(short);
    });

    it("对照组：不加这条词条时，同一个词不会变蓝（证明变蓝来自合并结果）", async () => {
      const target = firstPageQuestions()[0];
      const term = pickUncoveredTerm(target.stem);
      mountItems([]);

      const { container } = render(<InterviewPage />);
      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE));

      expect(container.querySelector(`button[aria-label="名词解释：${term}"]`)).toBeNull();
      // 而且它确实出现在题干里（不是压根没渲染）
      expect(target.stem).toContain(term);
    });
  });

  // ────────────────── ④ 无通道 / 无 Provider：旧行为不回归 ──────────────────

  describe("④ 没有 IPC 通道时，题库页仍然完整可用", () => {
    it("不装任何桩：12 张卡片、命中数与基线一致，筛选 / 搜索 / 收藏都还能用", async () => {
      const { container } = render(<InterviewPage />);

      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE));
      expect(cards(container)).toHaveLength(PAGE_SIZE);

      // 分类筛选
      const categoryItem = Array.from(
        container.querySelectorAll<HTMLElement>(".interview-cats__item"),
      ).find((node) => node.textContent?.startsWith("JavaScript"));
      expect(categoryItem).toBeTruthy();
      fireEvent.click(categoryItem as HTMLElement);
      const scoped = cards(container);
      expect(scoped.length).toBeGreaterThan(0);
      for (const card of scoped) {
        expect(card.querySelector(".interview-card__path")?.textContent).toContain("JavaScript");
      }

      // 搜索（分类筛选仍在，先回全部分类再加关键词）
      const allItem = Array.from(
        container.querySelectorAll<HTMLElement>(".interview-cats__item"),
      ).find((node) => node.textContent?.startsWith("全部分类"));
      fireEvent.click(allItem as HTMLElement);
      searchFor("闭包");
      expect(cards(container).length).toBeGreaterThan(0);
      expect(container.querySelector("mark")).not.toBeNull();

      // 收藏
      fireEvent.click(container.querySelector<HTMLElement>(".interview-card__star") as HTMLElement);
      const saved: unknown = JSON.parse(
        window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]",
      );
      expect(saved as string[]).toHaveLength(1);
    });

    it("不带 Provider 的 TermText：名词按钮与「另见」仍按基线词表工作", () => {
      const { container } = render(<TermText text="Vue 3 用最长递增子序列减少移动" />);

      const chips = Array.from(container.querySelectorAll(".interview-term")).map(
        (node) => node.textContent,
      );
      expect(chips).toContain("最长递增子序列");

      fireEvent.click(container.querySelector<HTMLElement>(".interview-term") as HTMLElement);
      const panel = document.querySelector(".interview-term__panel");
      expect(panel?.querySelector(".interview-term__panel-short")?.textContent?.length).toBeGreaterThan(
        0,
      );
      // related 反查必须仍走 glossaryById，否则「另见」整段消失
      expect(panel?.querySelector(".interview-term__panel-related")?.textContent).toContain("另见");
    });

    it("不带 Provider 的 QuestionCard：图解仍按基线 diagramById 解析出来", () => {
      const withDiagram = QUESTION_BANK.find(
        (question) => question.diagramId && diagramById(question.diagramId),
      );
      expect(withDiagram).toBeDefined();

      const { container } = render(
        <QuestionCard
          question={withDiagram as InterviewQuestion}
          keyword=""
          favorite={false}
          expanded={false}
          {...CARD_ACTION_PROPS}
          onToggleFavorite={() => {}}
          onToggleExpand={() => {}}
        />,
      );

      expect(container.querySelector(".interview-card__tag.is-diagram")).not.toBeNull();
      expect(container.querySelector(".interview-card__title")?.textContent).toBe(
        (withDiagram as InterviewQuestion).title,
      );
    });

    it("带 Provider 但没有增量时，TermText 的渲染结果与无 Provider 完全一致", () => {
      mountItems([]);

      const without = render(<TermText text="Vue 3 用最长递增子序列减少移动" />);
      const withoutChips = Array.from(without.container.querySelectorAll(".interview-term")).map(
        (node) => node.textContent,
      );
      without.unmount();

      // 无增量时合并结果 === 基线，首帧就是它，因此不需要等 IPC 回来
      const withProvider = render(
        <InterviewBankProvider>
          <TermText text="Vue 3 用最长递增子序列减少移动" />
        </InterviewBankProvider>,
      );

      const withChips = Array.from(
        withProvider.container.querySelectorAll(".interview-term"),
      ).map((node) => node.textContent);
      expect(withChips).toEqual(withoutChips);
    });
  });

  // ────────────────── ⑤ 首帧不许「先空后满」 ──────────────────

  describe("⑤ 首帧就是基线，不许闪一下空列表", () => {
    it("IPC 永不 resolve 时，第一次提交就已经有 12 张卡和基线命中数", () => {
      // 永远不 resolve：任何「等数据回来再渲染」的写法都会露馅
      mountInterviewApi({ itemsList: vi.fn(() => new Promise(() => {})) as never });

      const { container } = render(<InterviewPage />);

      // 一个 await / waitFor 都没有：此刻必须是满的
      expect(cards(container)).toHaveLength(PAGE_SIZE);
      expect(totalCount()).toBe(BASELINE_VISIBLE);
      expect(container.querySelectorAll(".interview-card__title").length).toBe(PAGE_SIZE);
      expect(container.textContent).not.toContain("暂无");
    });
  });

  // ────────────────── ⑥ reload 与卸载 ──────────────────

  describe("⑥ reload 重新拉数据 / 卸载后不再 setState", () => {
    it("reload() 会再打一次通道，并把新数据渲染出来", async () => {
      const itemsList = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeItem()]);
      mountInterviewApi({ itemsList: itemsList as never });

      function Probe() {
        const bank = useInterviewBankContext();
        return (
          <div>
            <span data-probe="total">{bank?.questions.length}</span>
            <button data-probe="reload" onClick={() => bank?.reload()}>
              reload
            </button>
          </div>
        );
      }

      const { container } = render(
        <InterviewBankProvider>
          <Probe />
        </InterviewBankProvider>,
      );

      await waitFor(() =>
        expect(container.querySelector("[data-probe='total']")?.textContent).toBe(
          String(BANK_SIZE),
        ),
      );
      expect(itemsList).toHaveBeenCalledTimes(1);

      fireEvent.click(container.querySelector("[data-probe='reload']") as HTMLElement);

      await waitFor(() =>
        expect(container.querySelector("[data-probe='total']")?.textContent).toBe(
          String(BANK_SIZE + 1),
        ),
      );
      expect(itemsList).toHaveBeenCalledTimes(2);
    });

    it("卸载之后才回来的响应不许 setState（不报 act 警告、不报 React 错误）", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let release!: (items: InterviewItemDetailDTO[]) => void;
      const pending = new Promise<InterviewItemDetailDTO[]>((resolve) => {
        release = resolve;
      });
      mountInterviewApi({ itemsList: vi.fn(() => pending) as never });

      const { unmount } = render(
        <InterviewBankProvider>
          <span>probe</span>
        </InterviewBankProvider>,
      );
      unmount();

      await act(async () => {
        release([makeItem()]);
        await pending;
        await Promise.resolve();
      });

      const complaints = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => /not wrapped in act|Warning: Can't perform a React state update/.test(message));
      expect(complaints).toEqual([]);
      errorSpy.mockRestore();
    });

    it("卸载之后才 reject 的请求同样安静（catch 分支也认 cancelled）", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let fail!: (reason: unknown) => void;
      const pending = new Promise<InterviewItemDetailDTO[]>((_resolve, reject) => {
        fail = reject;
      });
      mountInterviewApi({ itemsList: vi.fn(() => pending) as never });

      const { unmount } = render(
        <InterviewBankProvider>
          <span>probe</span>
        </InterviewBankProvider>,
      );
      unmount();

      await act(async () => {
        fail(new Error("database is locked"));
        await pending.catch(() => undefined);
        await Promise.resolve();
      });

      const complaints = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => /not wrapped in act|Warning: Can't perform a React state update/.test(message));
      expect(complaints).toEqual([]);
      errorSpy.mockRestore();
    });
  });

  // ────────────────── ⑦ 额外对抗（工程师没提的） ──────────────────

  describe("⑦ 额外对抗", () => {
    it("payload 是 JSON 字符串（导入路径）时，合并后仍能解析出内容", async () => {
      const payloadText = JSON.stringify({
        id: "u-q-imported",
        title: "导入路径的题：payload 是字符串",
        stem: "这条 payload 在库里是 JSON 文本，不是对象。",
        answer: "coercePayload 会再解析一次。",
        track: "foundation",
        categoryId: "foundation-js",
        difficulty: "medium",
        tags: ["导入"],
        topic: "题库增量",
        reviewedAt: "2026-01",
        heat: 50,
        updatedAt: "2099-12-30",
      });
      mountItems([
        makeItem({
          id: "u-q-imported",
          title: "导入路径的题：payload 是字符串",
          payload: payloadText,
          updatedAt: 1_760_000_000_001,
        }),
      ]);

      const { container } = render(<InterviewPage />);

      await waitFor(() => expect(totalCount()).toBe(BASELINE_VISIBLE + 1));
      expect(cardTitles(container)[0]).toBe("导入路径的题：payload 是字符串");
      expect(container.textContent).toContain("这条 payload 在库里是 JSON 文本");
      // JSON 文本不该作为纯文本出现在页面上（被当正文渲染 = 接线层把字符串漏下去了）
      expect(container.textContent).not.toContain('"categoryId"');
    });

    it("toMergeRows 不预处理 payload：字符串原样透传给合并层", () => {
      const payloadText = '{"id":"u-q-raw","title":"原样"}';
      const { rows, skipped } = toMergeRows([makeItem({ payload: payloadText })]);

      expect(skipped).toBe(0);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toBe(payloadText);
    });

    it("TermChip 老调用点（不传 glossaryIndex）的 related 反查仍走 glossaryById", () => {
      const withRelated = GLOSSARY_TERMS.find((term) => (term.related ?? []).length > 0);
      expect(withRelated).toBeDefined();
      const related = withRelated?.related ?? [];
      const names = related
        .map((id) => GLOSSARY_TERMS.find((term) => term.id === id)?.term)
        .filter((name): name is string => Boolean(name));
      expect(names.length).toBeGreaterThan(0);

      const { container } = render(<TermText text={String(withRelated?.term)} />);
      fireEvent.click(container.querySelector<HTMLElement>(".interview-term") as HTMLElement);

      const panel = document.querySelector(".interview-term__panel");
      const relatedText = panel?.querySelector(".interview-term__panel-related")?.textContent ?? "";
      expect(relatedText).toContain("另见");
      for (const name of names) {
        expect(relatedText).toContain(name);
      }
    });

    it("reload 返回内容完全相同的新数组：不报错、不循环、DOM 计数不变", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let renders = 0;

      function Probe() {
        const bank = useInterviewBankContext();
        renders += 1;
        return (
          <div>
            <span data-probe="glossary">{bank?.glossary.length}</span>
            <button data-probe="reload" onClick={() => bank?.reload()}>
              reload
            </button>
          </div>
        );
      }

      // 每次返回**同一条内容**（但每次都是新对象/新数组）
      mountInterviewApi({ itemsList: vi.fn(async () => [makeItem()]) as never });

      const { container } = render(
        <InterviewBankProvider>
          <Probe />
        </InterviewBankProvider>,
      );

      await waitFor(() =>
        expect(container.querySelector("[data-probe='glossary']")?.textContent).toBe(
          String(GLOSSARY_TERMS.length),
        ),
      );
      const rendersBeforeReload = renders;

      fireEvent.click(container.querySelector("[data-probe='reload']") as HTMLElement);
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(container.querySelector("[data-probe='glossary']")?.textContent).toBe(
          String(GLOSSARY_TERMS.length),
        ),
      );

      // 一次 reload 只该带来常数级重渲染（有界即可，不钉具体次数）
      expect(renders - rendersBeforeReload).toBeLessThan(6);
      const depthComplaints = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes("Maximum update depth"));
      expect(depthComplaints).toEqual([]);
      errorSpy.mockRestore();
    });

    it("合并基线真的把四类常量都带上（漏一类就是「词条不变蓝 / 图解消失」）", () => {
      const baseline = buildMergeBaseline();

      expect(baseline.questions).toBe(QUESTION_BANK);
      expect(baseline.glossary).toBe(GLOSSARY_TERMS);
      expect(baseline.diagrams.length).toBeGreaterThan(0);
      expect(baseline.categories.length).toBeGreaterThan(0);
    });

    it("覆盖图解后，卡片展开看到的是我的版本（diagramsById 真的生效）", async () => {
      const target = QUESTION_BANK.find((question) => question.diagramId);
      expect(target?.diagramId).toBeTruthy();
      const original = diagramById(String(target?.diagramId));
      expect(original).toBeDefined();
      const myCaption = "【我的版本】只比同层、类型不同直接重建（我改过这句）";

      mountItems([
        makeItem({
          id: String(original?.id),
          kind: "diagram",
          action: "override",
          baseId: String(original?.id),
          title: String(original?.title),
          categoryId: null,
          payload: { ...original, caption: myCaption },
        }),
      ]);

      const { container } = render(
        <InterviewBankProvider>
          <QuestionCard
            question={target as InterviewQuestion}
            keyword=""
            favorite={false}
            expanded
            {...CARD_ACTION_PROPS}
            onToggleFavorite={() => {}}
            onToggleExpand={() => {}}
          />
        </InterviewBankProvider>,
      );

      await waitFor(() =>
        expect(container.querySelector(".interview-dg__caption")?.textContent).toBe(myCaption),
      );
      expect(container.textContent).not.toContain(String(original?.caption));
    });

    it("隐藏图解后，卡片上的「图解」标签消失（隐藏的图不该还挂在题上）", async () => {
      const target = QUESTION_BANK.find((question) => question.diagramId);
      const original = diagramById(String(target?.diagramId));
      expect(original).toBeDefined();

      const card = (): ReactElement => (
        <QuestionCard
          question={target as InterviewQuestion}
          keyword=""
          favorite={false}
          expanded
          {...CARD_ACTION_PROPS}
          onToggleFavorite={() => {}}
          onToggleExpand={() => {}}
        />
      );

      // 对照组：不隐藏时标签与图都在（否则下面「消失」可能是本来就看不到）
      mountItems([]);
      const before = render(<InterviewBankProvider>{card()}</InterviewBankProvider>);
      await waitFor(() =>
        expect(before.container.querySelector(".interview-card__tag.is-diagram")).not.toBeNull(),
      );
      expect(before.container.querySelector(".interview-dg__caption")).not.toBeNull();
      before.unmount();

      mountItems([
        makeItem({
          id: String(original?.id),
          kind: "diagram",
          action: "override",
          baseId: String(original?.id),
          status: "hidden",
          title: String(original?.title),
          categoryId: null,
          payload: null,
        }),
      ]);

      const { container } = render(<InterviewBankProvider>{card()}</InterviewBankProvider>);

      await waitFor(() =>
        expect(container.querySelector(".interview-card__tag.is-diagram")).toBeNull(),
      );
      expect(container.querySelector(".interview-dg__caption")).toBeNull();
    });
  });

  // ────────────────── ⑧ 约定守卫（react-refresh / 禁 disable） ──────────────────

  describe("⑧ 仓库约定（react-refresh 与 eslint-disable）", () => {
    const PAGE = path.resolve(process.cwd(), "src/windows/BaseWindow/pages/InterviewPage");
    const read = (relative: string): string => readFileSync(path.join(PAGE, relative), "utf8");

    it("Provider 的 index.tsx 只导出组件，context.ts 只导出 context / hook", () => {
      const provider = read("components/InterviewBankProvider/index.tsx");
      // 组件文件里出现命名导出（hook / context / 常量）会让热更新整页重挂
      expect(provider).toMatch(/export default function InterviewBankProvider/);
      expect(provider).not.toMatch(/^export (const|function|class|let) /m);

      const context = read("components/InterviewBankProvider/context.ts");
      expect(context).toMatch(/export const InterviewBankContext/);
      expect(context).toMatch(/export function useInterviewBankContext/);
      // context.ts 里不该有 JSX（有 JSX 就是组件文件，扩展名必须是 .tsx）
      expect(context).not.toContain("</");
    });

    it("没有靠 eslint-disable 蒙过 lint（本轮改动的文件里 0 处）", () => {
      const offenders: string[] = [];
      for (const relative of [
        "src/windows/BaseWindow/pages/InterviewPage/components/InterviewBankProvider/index.tsx",
        "src/windows/BaseWindow/pages/InterviewPage/components/InterviewBankProvider/context.ts",
        "src/windows/BaseWindow/pages/InterviewPage/hooks/useInterviewBank.ts",
        "src/windows/BaseWindow/pages/InterviewPage/persistence/interview-bank-source.ts",
        "src/windows/BaseWindow/pages/InterviewPage/components/TermText/index.tsx",
        "src/windows/BaseWindow/pages/InterviewPage/components/QuestionCard/index.tsx",
        "src/windows/BaseWindow/pages/InterviewPage/InterviewPage.tsx",
      ]) {
        const source = readFileSync(path.resolve(process.cwd(), relative), "utf8");
        if (source.includes("eslint-disable")) offenders.push(relative);
      }
      expect(offenders).toEqual([]);
    });
  });
});
