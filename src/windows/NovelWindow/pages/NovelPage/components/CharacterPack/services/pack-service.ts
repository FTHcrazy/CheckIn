/**
 * 行囊数据服务（IPC 封装层）
 *
 * 只做语义化转发，不含业务逻辑、不导入 React。
 * 全部通道集中在 `window.electronAPI.novel.pack.*`，便于未来把整个模块
 * 迁到独立窗口时只换入口、不动调用方。
 */
import type {
  PackBundleDTO,
  PackDraftDTO,
  PackRecordDTO,
  PackRealmLinkDTO,
  PackSavePayloadDTO,
} from "../types";
import { PACK_UI_KEY } from "../pack-config";

export interface PackSaveInput extends Omit<PackSavePayloadDTO, "reason" | "chapterId"> {
  reason: string;
  chapterId: string;
}

/** 全量装载行囊（含 R25 等级体系与当前境界绑定） */
export async function loadPackBundle(workId: string): Promise<PackBundleDTO> {
  return window.electronAPI!.novel.pack.load(workId);
}

/** 整文档事务保存：写前先落回退点，成功后清空草稿；false 表示已整体回滚 */
export async function savePackDocument(input: PackSaveInput): Promise<boolean> {
  return window.electronAPI!.novel.pack.save(input);
}

/** 写入草稿（编辑防抖 800ms + 关闭面板时必写） */
export async function putPackDraft(
  characterId: string,
  payload: string,
  dirtyCount: number,
): Promise<boolean> {
  return window.electronAPI!.novel.pack.draftSet(characterId, payload, dirtyCount);
}

export async function fetchPackDraft(characterId: string): Promise<PackDraftDTO | null> {
  return window.electronAPI!.novel.pack.draftGet(characterId);
}

export async function clearPackDraft(characterId: string): Promise<boolean> {
  return window.electronAPI!.novel.pack.draftClear(characterId);
}

export async function fetchPackRecords(
  characterId: string,
  limit?: number,
): Promise<PackRecordDTO[]> {
  return window.electronAPI!.novel.pack.recordList(characterId, limit);
}

/** 境界幂等写入（同一来源+关系只保留一行） */
export async function writeRealmLink(link: PackRealmLinkDTO): Promise<boolean> {
  return window.electronAPI!.novel.pack.linkSet(link);
}

/** 等级项补列：小层数 / 战力当量（PRD §9.7.2） */
export async function writeLevelMeta(
  id: string,
  meta: { subLevels?: number; power?: number | null },
): Promise<boolean> {
  return window.electronAPI!.novel.pack.levelMetaSet(id, meta);
}

// ── 主角绑定（行囊面板与右侧要素栏共用同一格数据） ──

/**
 * 读取「谁是主角」。null = 该作品还没建过行囊角色，此时右侧要素栏
 * 不显示任何主角角标（而不是伪造一个空主角）。
 */
export async function fetchProtagonistBinding(
  workId: string,
): Promise<{ characterId: string; entityId: string } | null> {
  return window.electronAPI!.novel.pack.protagonistGet(workId);
}

/** 设为主角 / 换一个主角 / 传空串解除主角 */
export async function writeProtagonistBinding(
  workId: string,
  entityId: string,
): Promise<boolean> {
  return window.electronAPI!.novel.pack.protagonistSet(workId, entityId);
}

// ── 界面偏好（即改即存，走 config 整读整写；不进草稿，见 PRD §8.6.2） ──

/** 读取行囊界面偏好 JSON（键不存在返回 null，由上层合并默认值） */
export async function fetchPackUiPrefsRaw(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(PACK_UI_KEY);
}

/** 保存行囊界面偏好（防抖由调用方负责） */
export async function savePackUiPrefsRaw(value: string): Promise<boolean> {
  return window.electronAPI!.novel.configSet(PACK_UI_KEY, value);
}
