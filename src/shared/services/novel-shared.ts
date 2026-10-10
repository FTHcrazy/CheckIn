/**
 * 小说域跨窗口共享的最小依赖集
 *
 * 行囊模块（`shared/components/CharacterPack`）已同时服务 NovelWindow 与
 * PackWindow 两个窗口，窗口之间禁止互相导入，所以它依赖的几个与「当前
 * 窗口」无关的小工具 / IPC 封装集中放在这里，供两个窗口共用：
 *
 * - `createNovelId`：纯函数，行 ID 生成
 * - `logUsageEvent`：埋点（失败静默，不阻塞写作链路）
 * - `fetchPackBindableEntities`：行囊「绑定主角」下拉需要的实体清单
 *   （内部走 novel.editorLoad，只取 character 类型，不引入 NovelWindow 的类型）
 *
 * NovelWindow 侧经 `services/novel-service` 转发使用，不感知本文件路径。
 */

/** 生成带随机后缀的行 ID，避免同毫秒并发创建时碰撞 */
export function createNovelId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 通用事件上报（novel-usage-log）：埋点失败静默，不影响写作主流程 */
export async function logUsageEvent(
  event: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await window.electronAPI!.novel.usageLog(event, payload);
  } catch {
    // 静默：统计缺失可接受，写作链路不可被埋点阻塞
  }
}

/** 可绑定为主角的实体（只取 character 类型；id + name 足够渲染下拉） */
export interface PackBindableEntity {
  id: string;
  name: string;
}

/**
 * 拉取当前作品的实体清单（供行囊境界模块的「主角」下拉）。
 *
 * 走既有 `novel.editorLoad` 通道（任意窗口都能调），在渲染层过滤出
 * character 类型 —— 不为主窗口之外再造一个 IPC 通道。
 */
export async function fetchPackBindableEntities(): Promise<PackBindableEntity[]> {
  const bundle = await window.electronAPI!.novel.editorLoad();
  const entities: unknown = bundle.entities;
  if (!Array.isArray(entities)) return [];
  const result: PackBindableEntity[] = [];
  for (const entity of entities) {
    if (
      entity &&
      typeof entity === "object" &&
      "id" in entity &&
      "name" in entity &&
      "type" in entity &&
      (entity as { type: unknown }).type === "character" &&
      typeof (entity as { id: unknown }).id === "string" &&
      typeof (entity as { name: unknown }).name === "string"
    ) {
      result.push({ id: (entity as { id: string }).id, name: (entity as { name: string }).name });
    }
  }
  return result;
}
