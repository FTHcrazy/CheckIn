/**
 * 关系图 → 主窗口「打开要素资料卡」的意图判定（R27 / S6）
 *
 * 这条链路横跨两个窗口，落点有三种，判定必须只有一份：
 *
 * | 主窗口此刻        | 行为                                        |
 * |------------------|---------------------------------------------|
 * | 书架主页          | 直接切到目标作品并开卡（书架态没有「当前书」可言）|
 * | 编辑器 · 同一本书 | 直接开卡                                     |
 * | 编辑器 · 另一本书 | **只抬窗口**，由用户点「保存后跳转」才切书    |
 * | 编辑器 · 无当前书 | 直接切（空态没有可保存的东西）                |
 *
 * 这里只回答「该走哪条」，不碰窗口 / 存储 —— 判定能单测，副作用留在组件里。
 * 主进程只负责把负载送到（窗口没开就先拉起），不认识这三种落点。
 */
export interface EntityOpenPayload {
  workId: string;
  entityId: string;
}

/** 跨进程负载不可信：两个 id 都得是非空字符串，否则按「不是一次跳转」忽略 */
export function readEntityOpenPayload(raw: unknown): EntityOpenPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const { workId, entityId } = raw as { workId?: unknown; entityId?: unknown };
  if (typeof workId !== "string" || workId.length === 0) return null;
  if (typeof entityId !== "string" || entityId.length === 0) return null;
  return { workId, entityId };
}

/**
 * 同一条跳转的「去重窗口」（毫秒）。
 *
 * 只挡通道重放（收件箱补投 + 实时投递落在同一拍），不挡用户隔一会儿又点一次
 * —— 那是新意图，该照常处理。
 */
export const ENTITY_JUMP_REPLAY_MS = 800;

export type EntityJumpPlan =
  /** 直接切作品（需要时）并打开资料卡 */
  | "open"
  /** 当前书还有上下文：抬窗口 + 问一句，用户确认「保存后跳转」才动 */
  | "confirm"
  /** 负载无效 / 目标就是当前书且已在看：什么都不用做 */
  | "ignore";

export function planEntityJump(input: {
  /** 主窗口是否停在书架主页 */
  onShelf: boolean;
  /** 编辑器当前作品 id（书架态为空串） */
  activeWorkId: string;
  /** 关系图传来的目标作品 id */
  targetWorkId: string;
}): EntityJumpPlan {
  if (!input.targetWorkId) return "ignore";
  // 书架态：没有正在编辑的书，切过去就是用户要的
  if (input.onShelf) return "open";
  // 空态（没有作品 / 刚删完）：没有可保存的正文，也谈不上「换书会丢改动」
  if (!input.activeWorkId) return "open";
  return input.activeWorkId === input.targetWorkId ? "open" : "confirm";
}

/**
 * 编辑器页交给窗口根的「能力句柄」。
 *
 * 为什么需要它：落点判定必须在**窗口根**做（它同时知道当前停在书架还是编辑器），
 * 而「先保存再切书」「打开资料卡」只有编辑器页做得到。原先两边各挂一个监听，
 * 事件一来两边同时动手 —— 窗口根先切了书、编辑器那张确认框才弹出来，用户看到
 * 的就是「先切书，再问要不要切」。现在只剩窗口根一个监听，动作通过这个句柄下发，
 * 顺序由调用方（`confirmEntityJump` 之前不许调 `switchWork`）保证。
 *
 * 句柄里的函数都读最新值（`activeWorkId` 是 getter 而不是快照），否则窗口根
 * 拿到的是挂载那一刻的旧作品 id，判定会退化成「总是同一本书」。
 */
export interface NovelEditorBridge {
  /** 编辑器数据是否装载完成（装载前 `activeWorkId()` 是 `""`，不能拿去判定） */
  ready: () => boolean;
  /** 编辑器当前作品 id（空串 = 没有打开任何作品） */
  activeWorkId: () => string;
  /** 作品名（确认框文案用；查不到时给「其他作品」） */
  workNameOf: (workId: string) => string;
  /** 切到另一部作品：**只负责切**，保存由调用方先做 */
  switchWork: (workId: string) => void;
  /** 在当前作品里打开要素资料卡（右栏 + 详情） */
  openEntity: (entityId: string) => void;
  /** 落当前书的草稿；返回 false = 没存上（此时不能切书） */
  flushSave: () => Promise<boolean>;
  /** 轻提示（保存失败等） */
  toast: (text: string, tone?: "success" | "warning" | "error" | "info") => void;
}

/**
 * 窗口根拿到一条跳转后该做什么 —— 比 `planEntityJump` 多两个「还不能判定」的分支。
 *
 * | 动作      | 含义                                                       |
 * |-----------|------------------------------------------------------------|
 * | `shelf`   | 停在书架：直接切到目标作品并开卡                            |
 * | `open`    | 就是当前这本书：直接开卡                                    |
 * | `confirm` | 另一本书：只弹确认框，**一个字都不切**                      |
 * | `defer`   | 句柄缺席**或数据还没装载完**（此时 `activeWorkId()` 是 `""`）：先挂起，就绪后重判 |
 * | `ignore`  | 负载无效，什么都不做                                        |
 *
 * `defer` 这一支是「先切书，再弹窗」的来源：曾经句柄为空 / 数据未就绪时
 * 兜底成「直接切过去开卡」，而那一刻恰好是编辑器正在装载，判定拿到的是
 * 空的作品 id —— 于是同一条消息被当成「空态直开」，书切完了确认框才跟上。
 * 现在拿不到**已就绪的真实作品 id** 就**不猜**：挂起，等就绪后重判一次。
 */
export type EntityJumpAction = "shelf" | "open" | "confirm" | "defer" | "ignore";

export function resolveEntityJumpAction(input: {
  /** 主窗口是否停在书架主页 */
  onShelf: boolean;
  /** 编辑器能力句柄是否已经交上来 */
  hasBridge: boolean;
  /** 编辑器数据是否装载完成（未就绪时 `activeWorkId` 不可信） */
  editorReady: boolean;
  /** 编辑器当前作品 id（书架态 / 句柄缺席时可给空串） */
  activeWorkId: string;
  /** 关系图传来的目标作品 id */
  targetWorkId: string;
}): EntityJumpAction {
  if (!input.targetWorkId) return "ignore";
  if (input.onShelf) return "shelf";
  // 拿不到「已就绪的当前作品 id」就不下判断：宁可延后一拍，也不能凭空白切一次书
  if (!input.hasBridge || !input.editorReady) return "defer";
  return planEntityJump({
    onShelf: false,
    activeWorkId: input.activeWorkId,
    targetWorkId: input.targetWorkId,
  });
}
