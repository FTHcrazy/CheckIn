export interface TodoItem {
  id: number;
  parent_id: number | null;
  content: string;
  done: number; // 0 or 1
  note: string | null;
  important: number; // 0 or 1
  work_hour: number | null;
  created_at: string;
  done_at: string | null;
}

export const db = {
  all: (sql: string, params?: unknown[]) =>
    window.electronAPI?.db.all(sql, params) ?? Promise.resolve([]),
  run: (sql: string, params?: unknown[]) =>
    window.electronAPI?.db.run(sql, params) ??
    Promise.resolve({ changes: 0, lastInsertRowid: 0 }),
  exec: (sql: string) =>
    window.electronAPI?.db.exec(sql) ?? Promise.resolve(false),
};

let tableInited = false;

export async function ensureTable() {
  if (tableInited) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER DEFAULT NULL,
      content TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      note TEXT DEFAULT NULL,
      important INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      done_at TEXT DEFAULT NULL
    )
  `);

  const columns = (await db.all("PRAGMA table_info(todos)")) as Array<{
    name: string;
  }>;
  const existingColumns = new Set(columns.map((column) => column.name));

  if (!existingColumns.has("note")) {
    await db.exec(`
      ALTER TABLE todos ADD COLUMN note TEXT DEFAULT NULL
    `);
  }

  if (!existingColumns.has("important")) {
    await db.exec(`
      ALTER TABLE todos ADD COLUMN important INTEGER DEFAULT 0
    `);
  }

  if (!existingColumns.has("work_hour")) {
    await db.exec(`
      ALTER TABLE todos ADD COLUMN work_hour REAL DEFAULT NULL
    `);
  }

  tableInited = true;
}
