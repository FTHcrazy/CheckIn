/**
 * 记账数据服务
 * 通过语义化 IPC 与主进程通信（数据存 userDb 的 ledger_* 表）
 *
 * 分类预设由渲染进程持有：首次拉取为空时自动播种到主进程，
 * 避免同一份预设在两个进程各写一份而漂移。
 */
import type {
  LedgerCategoryDTO,
  LedgerRangeDTO,
  LedgerTransactionDTO,
} from "../types/electron";

export type { LedgerCategoryDTO, LedgerRangeDTO, LedgerTransactionDTO };

/** 兜底分类 id：删除自定义分类时历史流水归到此分类 */
export const FALLBACK_CATEGORY_ID = "other";

/**
 * 预设 10 类（设计规格 §3.1）
 * color 存 `--app-*` 变量名，四主题自动跟随。
 */
export const LEDGER_PRESET_CATEGORIES: LedgerCategoryDTO[] = [
  { id: "food", name: "餐饮", icon: "CoffeeOutlined", color: "--app-accent-orange", type: "expense", builtin: true, sort: 1, archived: false },
  { id: "transport", name: "交通", icon: "CarOutlined", color: "--app-accent-blue", type: "expense", builtin: true, sort: 2, archived: false },
  { id: "shopping", name: "购物", icon: "ShoppingOutlined", color: "--app-accent-rose", type: "expense", builtin: true, sort: 3, archived: false },
  { id: "housing", name: "居住", icon: "HomeOutlined", color: "--app-accent-purple", type: "expense", builtin: true, sort: 4, archived: false },
  { id: "fun", name: "娱乐", icon: "GiftOutlined", color: "--app-accent-amber", type: "expense", builtin: true, sort: 5, archived: false },
  { id: "medical", name: "医疗", icon: "MedicineBoxOutlined", color: "--app-accent-teal", type: "expense", builtin: true, sort: 6, archived: false },
  { id: "education", name: "教育", icon: "BookOutlined", color: "--app-accent-green", type: "expense", builtin: true, sort: 7, archived: false },
  { id: "salary", name: "工资", icon: "WalletOutlined", color: "--app-success", type: "income", builtin: true, sort: 8, archived: false },
  { id: "invest", name: "理财", icon: "LineChartOutlined", color: "--app-primary", type: "income", builtin: true, sort: 9, archived: false },
  { id: FALLBACK_CATEGORY_ID, name: "其他", icon: "EllipsisOutlined", color: "--app-text-muted", type: "both", builtin: true, sort: 10, archived: false },
];

/** 生成唯一 ID */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 本地时间 `YYYY-MM-DD HH:mm:ss`（与主进程 datetime('now','localtime') 同格式） */
function nowLocal(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/** 列出分类；为空时播种预设后返回预设 */
export async function listCategories(): Promise<LedgerCategoryDTO[]> {
  const rows = await window.electronAPI!.ledger.listCategories();
  if (rows.length > 0) return rows;
  await Promise.all(
    LEDGER_PRESET_CATEGORIES.map((category) =>
      window.electronAPI!.ledger.upsertCategory(category),
    ),
  );
  return LEDGER_PRESET_CATEGORIES;
}

/** 列出流水（可选区间过滤） */
export async function listTransactions(
  range?: LedgerRangeDTO,
): Promise<LedgerTransactionDTO[]> {
  return window.electronAPI!.ledger.listTransactions(range);
}

/** 区间内支出合计（首页迷你卡用，避免页面间互相导入私有工具） */
export async function sumExpense(range: LedgerRangeDTO): Promise<number> {
  const rows = await window.electronAPI!.ledger.listTransactions(range);
  return rows.reduce((sum, tx) => (tx.type === "expense" ? sum + tx.amount : sum), 0);
}

/** 记一笔；返回写库后的完整记录 */
export async function addTransaction(input: {
  type: "expense" | "income";
  amount: number;
  categoryId: string | null;
  note?: string;
  happenedAt?: string;
}): Promise<LedgerTransactionDTO | null> {
  const timestamp = nowLocal();
  const tx: LedgerTransactionDTO = {
    id: genId(),
    type: input.type,
    amount: Math.abs(input.amount),
    currency: "CNY",
    categoryId: input.categoryId,
    accountId: null,
    toAccountId: null,
    note: input.note ?? "",
    happenedAt: input.happenedAt ?? timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return window.electronAPI!.ledger.addTransaction(tx);
}

/** 局部更新一笔 */
export async function updateTransaction(
  id: string,
  updates: Partial<Pick<LedgerTransactionDTO, "type" | "amount" | "categoryId" | "note" | "happenedAt">>,
): Promise<boolean> {
  return window.electronAPI!.ledger.updateTransaction(id, { ...updates });
}

/** 删除一笔 */
export async function deleteTransaction(id: string): Promise<boolean> {
  return window.electronAPI!.ledger.deleteTransaction(id);
}

/** 撤销删除：按原 id 与原始字段整条写回 */
export async function restoreTransaction(
  tx: LedgerTransactionDTO,
): Promise<LedgerTransactionDTO | null> {
  return window.electronAPI!.ledger.addTransaction(tx);
}

/** 新增 / 更新分类 */
export async function upsertCategory(category: LedgerCategoryDTO): Promise<boolean> {
  return window.electronAPI!.ledger.upsertCategory(category);
}

/** 删除分类，历史流水归到兜底分类 */
export async function deleteCategory(id: string): Promise<boolean> {
  return window.electronAPI!.ledger.deleteCategory(id, FALLBACK_CATEGORY_ID);
}
