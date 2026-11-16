/**
 * 章节内查找 / 替换面板（R10）——替换 `@codemirror/search` 的默认面板。
 *
 * 为什么自己造：默认面板是一排英文原生控件（`find / next / previous / all /
 * match case / regexp / by word`），既不是中文，也不是本应用的设计语言；
 * 而且它占满编辑器顶部整条，打开时正文会被往下压一行。
 *
 * 这里对齐成熟编辑器（VS Code / Typora）的范式：
 *   1. 浮动卡片**跟着视口走**（贴编辑区右上角）、**不参与排版**：开关不引起正文
 *      重排，点搜索结果跳到命中处（滚动）也不会把卡片滚出视野；
 *   2. 查找框右侧内联「第几个 / 共几处」，永远跟着**光标**走（VS Code 同款口径），
 *      不要求「当前选区正好压在某处命中上」才报位置——
 *      那样手点一下正文就会退回只报总数，看着像「位置不更新」；
 *   3. 三个选项做成 `Aa` / `ab|` / `.*` 三枚互斥开关（中文 tooltip），
 *      不再是三个英文复选框；
 *   4. 替换行默认收起，Ctrl+H 打开时展开、Ctrl+F 回到纯查找。
 *
 * ⚠️ 跳转（上一个 / 下一个）**不用** `findNext` / `findPrevious`：它们按
 * 「主选区之后的第一处」取目标，光标停在某一处命中**中间**时会把这同一处
 * 再选一遍 —— 点「下一个」屏幕纹丝不动，只能再点一次。这里自己按命中表
 * 取「当前这一处」的下一处，并保证目标一定与当前选区不同（见 step）。
 *
 * 面板 DOM 挂在 CodeMirror 的 panel 容器里（React 树之外），所以用原生 DOM +
 * 应用色板变量实现。行为不自己发明：Enter / Shift+Enter / Esc / 焦点回落 /
 * 快捷键作用域全部沿用 CodeMirror 的 search 语义（`runScopeHandlers`）。
 */
import {
  SearchQuery,
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import type { Panel, ViewUpdate } from "@codemirror/view";

/** 三个互斥的匹配选项，与成熟编辑器同一套语义 */
type SearchOption = "case" | "word" | "regexp";

/** 命中数上限：长章里的单字查询不需要精确到几万处，超出只报「2000+」 */
const MAX_SCAN = 2000;

/** 一段命中的文档区间（只留跳转/计数要用的两个数字） */
interface Match {
  from: number;
  to: number;
}

/** 替换行是否展开（跨开关记住） */
let replaceOpen = false;

/** 当前挂在编辑器上的面板；关掉后置空，用于「已打开时 Ctrl+H 就地展开」 */
let livePanel: FindPanel | null = null;

const ICON = {
  chevron: `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3.5l5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 12.5V4M4.3 7.6L8 3.8l3.7 3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 3.5V12M4.3 8.4L8 12.2l3.7-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
};

const MARKUP = `
  <div class="nv-find__row nv-find__row--find">
    <button type="button" class="nv-find__expand" data-act="toggle-replace"
      aria-label="展开替换" aria-expanded="false" title="替换（Ctrl+H）">${ICON.chevron}</button>
    <div class="nv-find__field">
      <input class="nv-find__input" name="search" main-field="true" type="text"
        placeholder="查找" aria-label="查找内容" autocomplete="off" spellcheck="false" />
    </div>
    <span class="nv-find__count" aria-live="polite"></span>
    <div class="nv-find__group" role="group" aria-label="查找选项">
      <button type="button" class="nv-find__opt" data-opt="case"
        aria-pressed="false" aria-label="区分大小写" title="区分大小写（Aa）">Aa</button>
      <button type="button" class="nv-find__opt" data-opt="word"
        aria-pressed="false" aria-label="全字匹配" title="全字匹配（ab|）">ab|</button>
      <button type="button" class="nv-find__opt" data-opt="regexp"
        aria-pressed="false" aria-label="正则表达式" title="正则表达式（.*）">.*</button>
    </div>
    <div class="nv-find__group nv-find__group--nav" role="group" aria-label="命中之间跳转">
      <button type="button" class="nv-find__navbtn" data-act="prev"
        aria-label="上一个" title="上一个（Shift+Enter）">${ICON.up}</button>
      <button type="button" class="nv-find__navbtn" data-act="next"
        aria-label="下一个" title="下一个（Enter）">${ICON.down}</button>
    </div>
    <button type="button" class="nv-find__navbtn" data-act="close"
      aria-label="关闭查找" title="关闭（Esc）">${ICON.close}</button>
  </div>
  <div class="nv-find__row nv-find__row--replace" hidden>
    <span class="nv-find__gutter" aria-hidden="true"></span>
    <div class="nv-find__field">
      <input class="nv-find__input" name="replace" type="text"
        placeholder="替换为" aria-label="替换为" autocomplete="off" spellcheck="false" />
    </div>
    <div class="nv-find__actions">
      <button type="button" class="nv-find__btn" data-act="replace-one" title="替换当前命中（Enter）">替换</button>
      <button type="button" class="nv-find__btn is-strong" data-act="replace-all" title="替换全部命中">全部替换</button>
    </div>
  </div>
`;

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  // 模板是本文件里的常量，缺节点只可能是改模板时漏了同步，早失败好过静默空白
  if (!found) throw new Error(`查找面板缺少节点：${selector}`);
  return found;
}

class FindPanel implements Panel {
  readonly dom: HTMLElement;
  /** 面板挂在编辑器顶部（配合 CSS 浮到右上角） */
  readonly top = true;
  readonly pos = 80;

  private readonly view: EditorView;
  private readonly searchInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly replaceRow: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly expandButton: HTMLButtonElement;
  private readonly optionButtons: Record<SearchOption, HTMLButtonElement>;
  private query: SearchQuery;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);

    const dom = document.createElement("div");
    dom.className = "nv-find";
    dom.setAttribute("role", "search");
    dom.setAttribute("aria-label", "查找与替换");
    dom.innerHTML = MARKUP;
    this.dom = dom;

    this.searchInput = requireElement<HTMLInputElement>(dom, "input[name=search]");
    this.replaceInput = requireElement<HTMLInputElement>(dom, "input[name=replace]");
    this.replaceRow = requireElement<HTMLElement>(dom, ".nv-find__row--replace");
    this.countEl = requireElement<HTMLElement>(dom, ".nv-find__count");
    this.expandButton = requireElement<HTMLButtonElement>(dom, "[data-act=toggle-replace]");
    this.optionButtons = {
      case: requireElement<HTMLButtonElement>(dom, "[data-opt=case]"),
      word: requireElement<HTMLButtonElement>(dom, "[data-opt=word]"),
      regexp: requireElement<HTMLButtonElement>(dom, "[data-opt=regexp]"),
    };

    this.searchInput.value = this.query.search;
    this.replaceInput.value = this.query.replace;
    this.syncOptions();
    this.setReplaceOpen(replaceOpen, false);
    this.bindEvents();
    this.refreshCount();
  }

  /** 面板登场时选中查找框里的字：直接打字就是替换查询，与成熟编辑器一致 */
  mount(): void {
    this.searchInput.focus();
    this.searchInput.select();
  }

  destroy(): void {
    if (livePanel === this) livePanel = null;
  }

  update(update: ViewUpdate): void {
    let queryChanged = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
          queryChanged = true;
        }
      }
    }
    // 正文改了、或者光标换了位置，「第几个」都可能变
    if (queryChanged || update.docChanged || update.selectionSet) this.refreshCount();
  }

  /** 展开 / 收起替换行（Ctrl+H 与面板里的箭头共用） */
  setReplaceOpen(open: boolean, focusInput: boolean): void {
    replaceOpen = open;
    this.replaceRow.hidden = !open;
    this.dom.classList.toggle("is-replace", open);
    this.expandButton.classList.toggle("is-open", open);
    this.expandButton.setAttribute("aria-expanded", String(open));
    if (open && focusInput) this.replaceInput.focus();
  }

  private bindEvents(): void {
    /* 面板里点按钮不该把焦点从输入框抢走（敲一半的查询会断），
       但输入框之间的点选要保留默认行为 */
    this.dom.addEventListener("mousedown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      event.preventDefault();
    });

    this.dom.addEventListener("click", (event) => {
      const control = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-act], [data-opt]",
      );
      if (!control) return;

      const option = control.dataset.opt as SearchOption | undefined;
      if (option) {
        this.toggleOption(option);
        return;
      }

      switch (control.dataset.act) {
        case "prev":
          this.step(false);
          break;
        case "next":
          this.step(true);
          break;
        case "close":
          closeSearchPanel(this.view);
          break;
        case "replace-one":
          this.replaceCurrent();
          break;
        case "replace-all":
          replaceAll(this.view);
          break;
        case "toggle-replace":
          this.setReplaceOpen(!this.dom.classList.contains("is-replace"), true);
          break;
        default:
          break;
      }
    });

    this.dom.addEventListener("keydown", (event) => {
      // Esc / Ctrl+F / F3… 都是「search-panel 作用域」的快捷键，交回 CodeMirror
      if (runScopeHandlers(this.view, event, "search-panel")) {
        event.preventDefault();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (event.target === this.replaceInput) this.replaceCurrent();
      else this.step(!event.shiftKey);
    });

    // input 而非 change：输入过程中命中数与高亮要跟着变（change 只在失焦时触发）
    for (const input of [this.searchInput, this.replaceInput]) {
      input.addEventListener("input", () => this.commit());
    }
  }

  /**
   * 「替换」按一次就要真的换掉东西。
   *
   * CodeMirror 的 `replaceNext` 只在**选区正好是一个命中**时才替换；否则它只把
   * 选区挪到下一个命中上。照着直接调，用户打完查询点「替换」会觉得按钮失灵
   * （正文一个字没动，只是光标跳了一下）。所以先补一次跳转，再替换。
   */
  private replaceCurrent(): void {
    if (!this.selectionIsMatch()) {
      const { matches } = this.scan();
      if (!matches.length) return;
      this.jump(matches[this.activeIndex(matches)]);
    }
    replaceNext(this.view);
  }

  /** 当前主选区是否正好压在一个命中上 */
  private selectionIsMatch(): boolean {
    const { state } = this.view;
    const main = state.selection.main;
    if (main.empty || !this.query.search || !this.query.valid) return false;
    const first = this.query.getCursor(state, main.from, main.to).next();
    return !first.done && first.value.from === main.from && first.value.to === main.to;
  }

  /**
   * 全章命中表（计数与跳转共用）。
   *
   * 两处共用一张表而不是各扫一遍：分开扫不但慢，还可能在「一边刚扫完、文档已
   * 改」时给出不一致的结果（计数说 3 处，跳过去却是第 2 处）。
   *
   * 不做缓存。命中结果**依赖光标位置**（全字匹配的判定用
   * `state.charCategorizer(selection.main.head)`，光标在中文/拉丁文上下文之间
   * 移动时同一段文字的词边界可能变），按「文档 + 查询」缓存会悄悄给出旧结果。
   * 单章最长几万字、又受 MAX_SCAN 封顶，重扫一次的代价看不出来。
   */
  private scan(): { matches: Match[]; truncated: boolean } {
    const { state } = this.view;
    const matches: Match[] = [];
    let truncated = false;

    if (this.query.search && this.query.valid) {
      const cursor = this.query.getCursor(state);
      for (let step = cursor.next(); !step.done; step = cursor.next()) {
        matches.push({ from: step.value.from, to: step.value.to });
        if (matches.length >= MAX_SCAN) {
          truncated = true;
          break;
        }
      }
    }

    return { matches, truncated };
  }

  /**
   * 光标所在的那一处命中；不在任何命中上返回 -1。
   *
   * 三种都算「当前这一处」：选区正好选中它、光标落在它中间、光标正好压在它的
   * 头尾（敲完查询停在词首是最常见的一种）。判据用 head 而不是 from ——
   * 反向选择时 from 在远端。
   *
   * 边界取闭区间：光标停在某处命中第一个字之前时，若判成「不在命中上」，
   * 计数会把下一处报成「第 1 处」，而点「上一个」才回到这里 —— 用户看到的就是
   * 「数字和跳转对不上」。
   */
  private currentIndex(matches: Match[]): number {
    const main = this.view.state.selection.main;
    if (!main.empty) {
      const exact = matches.findIndex(
        (match) => match.from === main.from && match.to === main.to,
      );
      if (exact >= 0) return exact;
    }
    const head = main.head;
    return matches.findIndex((match) => match.from <= head && head <= match.to);
  }

  /** 光标之后的第一处（没有就回绕到第一处） */
  private nextIndex(matches: Match[]): number {
    const { to } = this.view.state.selection.main;
    const index = matches.findIndex((match) => match.from >= to);
    return index >= 0 ? index : 0;
  }

  /** 光标之前的第一处（没有就回绕到最后一处） */
  private prevIndex(matches: Match[]): number {
    const { head } = this.view.state.selection.main;
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      if (matches[i].to <= head) return i;
    }
    return matches.length - 1;
  }

  /**
   * 「当前这一处」的下标 —— 计数与跳转**必须共用这一个口径**。
   *
   * 光标压在命中上就是它本身；不在任何命中上（手点正文、刚打开面板、光标停在
   * 两处之间）时报**会跳过去的那一处**（下一处）。
   *
   * ⚠️ 跳转不能各算一套：旧实现里计数按「光标不在命中上就算下一处」报位置，
   * 跳转却按「光标在哪」取前后 —— 面板写着「1 / 95」时点下一条，目标正是
   * 光标之后的第 1 处（屏幕上纹丝不动，数字也不变）；点上一条则退到光标前面
   * 的那一处，而不是用户看到的「第 95 处」。
   */
  private activeIndex(matches: Match[]): number {
    const current = this.currentIndex(matches);
    return current >= 0 ? current : this.nextIndex(matches);
  }

  /**
   * 跳到上/下一处命中。
   *
   * 不用 `findNext` 的两个理由：
   * ① 它从**选区末尾**往后找，光标停在某处命中内部时找回来的就是这一处本身，
   *    点「下一个」屏幕完全不动（只能再点一次才走）；
   * ② 零长度命中（`^`、`a*`）下它算出的目标可能仍是当前光标，同样原地打转。
   *
   * 基准是 `activeIndex`（计数里报的那一处），不是「光标在哪」：
   * 光标不在命中上时两者并不相同 —— 按光标算会让「1 / 95 → 下一条」回到第 1 处、
   * 「1 / 95 → 上一条」退到光标前面那一处，用户看到的就是「点了没用 / 跳错了」。
   */
  private step(forward: boolean): void {
    if (!this.query.search || !this.query.valid) return;
    const { matches } = this.scan();
    if (!matches.length) return;

    /** 环移一格（首尾相接：从最后一处再往后回到第一处） */
    const shift = (from: number): number =>
      (from + (forward ? 1 : -1) + matches.length) % matches.length;

    /* 基准要分两种：光标压在某一处命中上 → 就它本身，再 ±1 走到相邻；
       光标不在任何命中上（手点正文、停在两处之间）→ 直接落到「会跳过去的
       那一处」，而不是再 ±1 —— 否则会把这一处整段跳过（跳着高亮、数字对不上）。
       这里不能复用 `activeIndex`：它把「不在命中上」折算成了 nextIndex，
       而 nextIndex 本身就是「下一个」该落的地方，再 ±1 就跳多了一格。 */
    const current = this.currentIndex(matches);
    let index = current >= 0
      ? shift(current)
      : (forward ? this.nextIndex(matches) : this.prevIndex(matches));

    /* 目标正压在当前选区上 = 这一下按了等于没按（只有一处命中时会这样）。
       沿着同一方向再挪一格；命中只有一两处时挪到头也就停在那里。 */
    const { main } = this.view.state.selection;
    const same = (match: Match): boolean =>
      match.from === main.from && match.to === main.to;
    for (let guard = 0; guard < matches.length && same(matches[index]); guard += 1) {
      index = shift(index);
    }

    this.jump(matches[index]);
  }

  /** 选中一处命中并把它滚进视野（具体落点由 findPanelScroll 接管） */
  private jump(match: Match): void {
    this.view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: "nearest" }),
      userEvent: "select.search",
    });
  }

  private commit(): void {
    const next = new SearchQuery({
      search: this.searchInput.value,
      replace: this.replaceInput.value,
      caseSensitive: this.query.caseSensitive,
      wholeWord: this.query.wholeWord,
      regexp: this.query.regexp,
    });
    // 值没变就别派发：每敲一个同值字符都重建查询会把整章高亮重算一遍
    if (!next.eq(this.query)) {
      this.dispatch(next);
      this.reveal();
    }
  }

  /**
   * 敲完查询就把「计数里报的那一处」选中（VS Code / Typora 同款）。
   *
   * ⚠️ 这条是「点下一个跳不动」的正面解：面板原本只报「1 / 32」却**什么都没选**，
   * 于是第一下「下一个」只能从「预测的第一处」往后挪一格 —— 屏幕上没有可对照的
   * 起点，跳了也像没跳；而「上一个」退回去的那一处又和数字对不上。
   * 输入即选中之后，计数说第几就是真的第几，前后步进严格一条一条走。
   *
   * 落点用**选区起点**（不是终点）作为锚：继续打字时查询变长、原先那一处可能
   * 不再命中，锚不动就能顺理成章落到新的第一处，而不是越打越往后飘。
   */
  private reveal(): void {
    if (!this.query.search || !this.query.valid) return;
    const { matches } = this.scan();
    if (!matches.length) return;

    const { from } = this.view.state.selection.main;
    const index = matches.findIndex((match) => match.from >= from);
    const target = matches[index >= 0 ? index : 0];

    // 已经选中这一处就别再派发：反复 dispatch 会把整章高亮与滚动一起重算
    const { main } = this.view.state.selection;
    if (main.from === target.from && main.to === target.to) return;
    this.jump(target);
  }

  private toggleOption(option: SearchOption): void {
    this.dispatch(
      new SearchQuery({
        search: this.searchInput.value,
        replace: this.replaceInput.value,
        caseSensitive: option === "case" ? !this.query.caseSensitive : this.query.caseSensitive,
        wholeWord: option === "word" ? !this.query.wholeWord : this.query.wholeWord,
        regexp: option === "regexp" ? !this.query.regexp : this.query.regexp,
      }),
    );
  }

  private dispatch(query: SearchQuery): void {
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  /** 查询被外部改写（含自己派发的 effect）时回灌输入框与开关 */
  private setQuery(query: SearchQuery): void {
    this.query = query;
    if (this.searchInput.value !== query.search) this.searchInput.value = query.search;
    if (this.replaceInput.value !== query.replace) this.replaceInput.value = query.replace;
    this.syncOptions();
    this.refreshCount();
  }

  private syncOptions(): void {
    const active: Record<SearchOption, boolean> = {
      case: this.query.caseSensitive,
      word: this.query.wholeWord,
      regexp: this.query.regexp,
    };
    for (const option of Object.keys(this.optionButtons) as SearchOption[]) {
      const button = this.optionButtons[option];
      button.classList.toggle("is-active", active[option]);
      button.setAttribute("aria-pressed", String(active[option]));
    }
  }

  /**
   * 命中计数：「第几个 / 共几处」。
   *
   * 「第几个」= 光标所在的那一处；光标不在任何命中上时报**下一处**（会跳过去
   * 的那一处）。口径与 VS Code 一致，好处是输入完就有位置可看，跳转前后数字
   * 都跟着光标走。
   *
   * ⚠️ 不能要求「当前选区正好等于某个命中」才报位置 —— 那样手点一下正文，
   * 面板就从「3 / 7」退回「7 处」，看着像位置没更新（用户报过的原症状）。
   */
  private refreshCount(): void {
    const label = this.countEl;
    label.classList.remove("is-error", "is-empty");

    if (!this.query.search) {
      label.textContent = "";
      return;
    }
    if (!this.query.valid) {
      label.textContent = "表达式无效";
      label.classList.add("is-error");
      return;
    }

    const { matches, truncated } = this.scan();
    if (!matches.length) {
      label.textContent = "无结果";
      label.classList.add("is-empty");
      return;
    }

    const totalText = truncated ? `${MAX_SCAN}+` : String(matches.length);
    label.textContent = `${this.activeIndex(matches) + 1} / ${totalText}`;
  }
}

/** 交给 `search({ createPanel })` */
export function createFindPanel(view: EditorView): Panel {
  livePanel = new FindPanel(view);
  return livePanel;
}

/**
 * 浮层遮住的那一段：跳转到命中时，别把命中留在卡片底下。
 *
 * 面板浮在正文之上、不占排版，代价是视口顶部那一条被它盖住；而
 * `scrollIntoView` 走的是**最小滚动**——命中落在视口顶部时，就会被卡片压住，
 * 看起来像「跳了个寂寞」。`scrollMargins` 是 CodeMirror 给「固定元素遮挡」
 * 留的口子：把卡片实际高度报给滚动计算，跳转时视口顶部自动让出这一段。
 *
 * 只在面板开着时报（关掉即 null），高度按当时量到的算——替换行展开后卡片更
 * 高，写死一个常数迟早不够。
 *
 * 正常路径其实走下面的 `findPanelScroll`（自己算落点）；这里留着当兜底：
 * 命中还没被渲染出来、量不到坐标时，仍由 CodeMirror 的默认实现来滚。
 */
export const findPanelMargins = EditorView.scrollMargins.of(() => {
  if (!livePanel) return null;
  const height = livePanel.dom.offsetHeight;
  return { top: height > 0 ? height + 20 : 0 };
});

/** 卡片盖住视口顶部的实际高度（卡片高度 + 上下留白），与 findPanelMargins 同一口径 */
function panelCover(): number {
  const height = livePanel?.dom.offsetHeight ?? 0;
  return height > 0 ? height + 20 : 0;
}

/** 命中与可见带上下沿之间留的呼吸量（px） */
const SCROLL_PAD = 24;

/**
 * 跳转落点：把命中放进「卡片下沿 ~ 视口下沿」这条可见带里。
 *
 * 为什么不能只靠 `scrollIntoView` 的默认实现：
 * ① 它是「最小滚动」，命中只要在视口矩形内就不动 —— 可视口顶上那一条被卡片
 *    盖着，命中正好落在卡片底下时**一像素都不滚**，用户看到的就是「点了没反应」；
 * ② 我们真正的滚动容器是祖先 `.nv-editor__scroll`，它靠 `scrollRectIntoView`
 *    逐级向上找可滚动祖先，落点还要再经一遍 `scrollMargins` 的放大 rect 换算，
 *    隔着两层推算，行为不好预测也不好守。
 * 这里直接量几何，命中已在可见带里就一像素不动（保留「最小滚动」的手感）。
 *
 * ⚠️ 量几何**必须放到 requestMeasure 的读相位**：scrollHandler 是在
 * `EditorView.measure` 的写相位里被调的（updateState = Updating），此时
 * `view.coordsAtPos` 直接抛「Reading the editor layout isn't allowed during an
 * update」。异常被 CodeMirror 的 try/catch 吞掉（只在控制台留一句 `scroll
 * handler:`），随后回落默认实现 —— 也就是说：**平写「就地量、就地滚」的版本
 * 每次跳转都在抛、这段落点逻辑从未真正生效过**（2.55.x 实测：连点 30 次
 * 下一个 = 30 条异常）。读相位量、写相位滚，才是 CodeMirror 允许的顺序。
 */
export const findPanelScroll = EditorView.scrollHandler.of((view, range) => {
  if (!livePanel) return false;
  const scroller = view.scrollDOM.closest<HTMLElement>(".nv-editor__scroll");
  if (!scroller) return false;

  view.requestMeasure<ScrollGeometry | null>({
    read() {
      // 没渲染出来的位置量不到坐标（长章虚拟滚动），这次放弃、由下一帧重算
      const head = view.coordsAtPos(range.from);
      const tail = range.to > range.from ? view.coordsAtPos(range.to) : head;
      if (!head || !tail) return null;
      const box = scroller.getBoundingClientRect();
      return {
        headTop: head.top,
        tailBottom: tail.bottom,
        boxTop: box.top,
        viewHeight: scroller.clientHeight,
        cover: panelCover(),
      };
    },
    write(geometry) {
      if (!geometry) return;
      const visibleTop = geometry.boxTop + geometry.cover + SCROLL_PAD;
      const visibleBottom = geometry.boxTop + geometry.viewHeight - SCROLL_PAD;
      // 已经在可见带里：不动（与成熟编辑器的「就近滚动」一致）
      if (geometry.headTop >= visibleTop && geometry.tailBottom <= visibleBottom) return;
      scroller.scrollTop +=
        geometry.headTop < visibleTop
          ? geometry.headTop - visibleTop
          : geometry.tailBottom - visibleBottom;
    },
  });
  return true;
});

/** 读相位量到的几何（写相位据此算滚动量） */
interface ScrollGeometry {
  headTop: number;
  tailBottom: number;
  boxTop: number;
  viewHeight: number;
  /** 浮层盖住的顶部高度（卡片 + 留白） */
  cover: number;
}

/**
 * 打开查找面板（`replace` 决定替换行是否展开）。
 *
 * Ctrl+F 传 `replace: false`，Ctrl+H 传 `replace: true`；面板已经开着时
 * 直接就地改显隐，不再走一遍「关掉再开」——那样焦点会回正文、查询被重新种子化。
 */
export function openFindPanel(
  view: EditorView,
  options: { replace?: boolean } = {},
): boolean {
  if (typeof options.replace === "boolean") {
    replaceOpen = options.replace;
    livePanel?.setReplaceOpen(replaceOpen, false);
  }
  return openSearchPanel(view);
}
