/**
 * 记账模块语义化 IPC handlers
 * 数据存 userDb 的 ledger_* 表（PRD v0.1 数据模型）
 *
 * 约定：
 * - 金额一律为正数（REAL，单位元），收支方向由 type 决定
 * - 时间统一本地字符串 `YYYY-MM-DD HH:mm:ss`
 * - 更新类接口只接受白名单列，禁止拼接外部列名
 */
import { ipcMain } from 'electron';
import { dbAll, dbGet, dbRun } from '../db';

interface LedgerTransactionRow {
  id: string;
  type: string;
  amount: number;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  note: string;
  happened_at: string;
  created_at: string;
  updated_at: string;
}

interface LedgerCategoryRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  builtin: number;
  sort: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

/** 新增一笔的入参（DTO 子集，缺字段由主进程兜底） */
interface LedgerAddParams {
  id: string;
  type: string;
  amount: number;
  currency?: string;
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  note?: string;
  happenedAt?: string;
}

/** 可更新字段白名单：camelCase → 列名 */
const TX_UPDATE_COLUMNS: Record<string, string> = {
  type: 'type',
  amount: 'amount',
  currency: 'currency',
  categoryId: 'category_id',
  accountId: 'account_id',
  toAccountId: 'to_account_id',
  note: 'note',
  happenedAt: 'happened_at',
};

function nowLocalISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** 数据库行 → 渲染进程 DTO */
function txRowToDto(row: LedgerTransactionRow) {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    categoryId: row.category_id,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    note: row.note,
    happenedAt: row.happened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function categoryRowToDto(row: LedgerCategoryRow) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    type: row.type,
    builtin: row.builtin === 1,
    sort: row.sort,
    archived: row.archived === 1,
  };
}

export function registerLedgerHandlers(): void {
  // ── 流水 ──

  /** 列出流水；传入 start/end（YYYY-MM-DD）时按发生日期过滤，倒序返回 */
  ipcMain.handle('ledger-transaction-list', async (_event, range?: { start?: string; end?: string }) => {
    const start = range?.start;
    const end = range?.end;
    if (start && end) {
      const rows = dbAll(
        'SELECT * FROM ledger_transactions WHERE substr(happened_at, 1, 10) BETWEEN ? AND ? ORDER BY happened_at DESC, created_at DESC',
        [start, end],
      ) as LedgerTransactionRow[];
      return rows.map(txRowToDto);
    }
    const rows = dbAll(
      'SELECT * FROM ledger_transactions ORDER BY happened_at DESC, created_at DESC',
    ) as LedgerTransactionRow[];
    return rows.map(txRowToDto);
  });

  /** 记一笔：金额取绝对值，方向由 type 决定 */
  ipcMain.handle('ledger-transaction-add', async (_event, params: LedgerAddParams) => {
    const now = nowLocalISO();
    const happenedAt = params.happenedAt || now;
    dbRun(
      `INSERT INTO ledger_transactions
        (id, type, amount, currency, category_id, account_id, to_account_id, note, happened_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        params.type,
        Math.abs(Number(params.amount) || 0),
        params.currency || 'CNY',
        params.categoryId ?? null,
        params.accountId ?? null,
        params.toAccountId ?? null,
        params.note ?? '',
        happenedAt,
        now,
        now,
      ],
    );
    const row = dbGet('SELECT * FROM ledger_transactions WHERE id = ?', [params.id]) as
      | LedgerTransactionRow
      | undefined;
    return row ? txRowToDto(row) : null;
  });

  /** 更新一笔：只写白名单列 */
  ipcMain.handle(
    'ledger-transaction-update',
    async (_event, id: string, updates: Record<string, unknown>) => {
      const columns: string[] = [];
      const values: unknown[] = [];
      for (const [key, column] of Object.entries(TX_UPDATE_COLUMNS)) {
        if (updates[key] === undefined) continue;
        columns.push(`${column} = ?`);
        values.push(key === 'amount' ? Math.abs(Number(updates[key]) || 0) : updates[key]);
      }
      if (columns.length === 0) return false;
      values.push(nowLocalISO(), id);
      dbRun(
        `UPDATE ledger_transactions SET ${columns.join(', ')}, updated_at = ? WHERE id = ?`,
        values,
      );
      return true;
    },
  );

  ipcMain.handle('ledger-transaction-delete', async (_event, id: string) => {
    dbRun('DELETE FROM ledger_transactions WHERE id = ?', [id]);
    return true;
  });

  // ── 分类 ──

  ipcMain.handle('ledger-category-list', async () => {
    const rows = dbAll(
      'SELECT * FROM ledger_categories ORDER BY sort ASC, name ASC',
    ) as LedgerCategoryRow[];
    return rows.map(categoryRowToDto);
  });

  ipcMain.handle('ledger-category-upsert', async (_event, category: {
    id: string;
    name: string;
    icon: string;
    color: string;
    type: string;
    builtin: boolean;
    sort: number;
    archived: boolean;
  }) => {
    const now = nowLocalISO();
    dbRun(
      `INSERT INTO ledger_categories (id, name, icon, color, type, builtin, sort, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         icon = excluded.icon,
         color = excluded.color,
         type = excluded.type,
         builtin = excluded.builtin,
         sort = excluded.sort,
         archived = excluded.archived,
         updated_at = excluded.updated_at`,
      [
        category.id,
        category.name,
        category.icon,
        category.color,
        category.type,
        category.builtin ? 1 : 0,
        category.sort,
        category.archived ? 1 : 0,
        now,
        now,
      ],
    );
    return true;
  });

  /** 删除分类：历史流水重指派到 fallbackId（渲染进程传「其他」分类 id） */
  ipcMain.handle('ledger-category-delete', async (_event, id: string, fallbackId: string) => {
    dbRun('UPDATE ledger_transactions SET category_id = ? WHERE category_id = ?', [fallbackId, id]);
    dbRun('DELETE FROM ledger_categories WHERE id = ?', [id]);
    return true;
  });
}
