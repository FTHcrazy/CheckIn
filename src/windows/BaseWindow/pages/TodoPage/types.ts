/**
 * TodoPage 共享类型定义
 * 从原 todo-db.ts 迁移，供页面内各组件复用
 */
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
