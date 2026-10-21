/**
 * `novel_links` 变更广播（R27：S3 写回 / S4 反向同步共用**同一条**通道）
 *
 * 为什么单独一个模块：这条通道有两个生产者（图窗口的单事务提交、主窗口的
 * 增删关系），却只能有一个载体。事件名 / 排除发送者 / payload 形态三件事只要
 * 有一处走样，就会出现「图窗口收到了自己刚写的边，于是多画一条」这种只在
 * 特定顺序下复现的 bug。集中在这里，两处生产者都只是填 delta。
 *
 * 语义约定：
 * - delta 里出现的数组**都是增量**（新增行 / 删掉的行 id / 改过的备注），
 *   接收方按 id 幂等合并，**不重载 bundle** —— 重载会把主窗口正在编辑的正文
 *   基线顶掉，也会让图窗口重装画布记忆（丢掉还没落库的坐标）。
 * - `workId` 可能缺省：`novel_links` 表没有 work_id，只能从 from 端点反查；
 *   `to_type='level'` 的境界绑定反查不到本书，此时不带 workId。接收方见到
 *   缺省 workId 就按 id 合并（id 全局唯一，跨书同 id 不存在）。
 * - 一律排除发送者：它已经做过乐观更新，再收一次会重复插入。
 */
import { BrowserWindow, type WebContents } from "electron";
import { novelGet } from "./novel-db";
import { windowManager } from "./windowManager";

export interface LinkDeltaRow {
  id: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
  note?: string | null;
}

/** 广播载荷（与 `src/shared/types/electron.d.ts` 的 NovelLinksDelta 保持一致） */
export interface LinksDelta {
  workId?: string;
  /** 画布文档 rev（只有单事务提交会带） */
  rev?: number;
  created?: LinkDeltaRow[];
  /** 同四元组已存在 → 并入已有边（不新增） */
  merged?: string[];
  /** 备注被改的行 */
  notes?: Array<{ id: string; note: string | null }>;
  /** 被删掉的行 id（主窗口「解除关联」） */
  removed?: string[];
  /** 关系名被改的行（主窗口目前无改名入口，契约先留好） */
  relations?: Array<{ id: string; relation: string }>;
}

/** 要素所属作品；要素已被删除 / 库未就绪 → null（不阻断主操作） */
export function workIdOfEntity(entityId: string): string | null {
  try {
    const row = novelGet("SELECT work_id FROM novel_entities WHERE id = ?", [entityId]) as
      | { work_id?: string }
      | undefined;
    return row?.work_id ?? null;
  } catch {
    return null;
  }
}

/**
 * 广播一条 links 增量。
 *
 * `sender` 传 `event.sender`：排除的是**那个窗口**，不是「所有非图窗口」——
 * 主窗口删关系时图窗口必须收到，图窗口提交时主窗口必须收到，两者互为对方
 * 的唯一消费者。
 */
export function broadcastLinksChanged(sender: WebContents | null, delta: LinksDelta): void {
  let exclude: string | undefined;
  if (sender && !sender.isDestroyed()) {
    const win = BrowserWindow.fromWebContents(sender);
    if (win) exclude = windowManager.getNameOf(win);
  }
  windowManager.broadcast("novel-links-changed", delta, exclude);
}
