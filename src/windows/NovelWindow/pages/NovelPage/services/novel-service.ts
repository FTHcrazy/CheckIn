import { buildSearchSnippet, type LastPosition } from "../novel-utils";
import { STORAGE_KEYS } from "../novel-config";
import type {
  NovelBackupExportResult,
  NovelBackupPickResult,
  NovelBackupRestoreResult,
  NovelGlobalSettingCategoryDTO,
  NovelSettingCategoryPatch,
  NovelSettingExportPayload,
  NovelSettingLevelPatch,
  NovelSettingTemplateDTO,
  NovelTrashKind,
  NovelTrashListResult,
  PublishToGlobalResult,
} from "@/shared/types/electron";
import type {
  CustomEntityTypeDef,
  EditorSettings,
  NameFavorite,
  NovelBundle,
  NovelChapter,
  NovelEntity,
  NovelLink,
  NovelNote,
  NovelSnapshot,
  NovelVolume,
  NovelWork,
  OutlineEntry,
  SearchHit,
  SettingCategory,
  SensitiveConfig,
} from "../types";

/**
 * 小说编辑器数据服务（IPC 封装层）
 *
 * 全部数据持久化在主进程 userDb 的 novel_* 表（PRD v0.4 §7），
 * 这里只做语义化转发，不含业务逻辑、不导入 React。
 * 全书检索在渲染层基于已装载的章节内存完成（无 IPC 往返）。
 */

/** 生成带随机后缀的行 ID —— 定义在 shared（行囊模块跨窗口共用），此处转发 */
export { createNovelId, logUsageEvent } from "@/shared/services/novel-shared";

/** 拉取编辑器所需的全部数据（novel-editor-load） */
export async function fetchNovelBundle(): Promise<NovelBundle> {
  return window.electronAPI!.novel.editorLoad();
}

/**
 * 开启编辑器会话（novel-session-open）：置崩溃恢复标记 + 上报 editor_open。
 *
 * 与 `fetchNovelBundle` 分开是刻意的 —— 后者是通用装载，书架与行囊也在调，
 * 不能拿它当「进了编辑器」的判据。
 */
export async function openEditorSession(): Promise<boolean> {
  return window.electronAPI!.novel.sessionOpen();
}

// ── userDb config 读写（R5 设置持久化 / R6 位置记忆） ──

/** 读取编辑器设置 JSON（键不存在返回 null，由上层合并默认值） */
export async function fetchEditorSettings(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.settings);
}

/** 保存编辑器设置（整读整写，低频小数据） */
export async function saveEditorSettings(settings: EditorSettings): Promise<boolean> {
  return window.electronAPI!.novel.configSet(STORAGE_KEYS.settings, JSON.stringify(settings));
}

/** 读取上次续写位置 JSON（键不存在返回 null） */
export async function fetchLastPosition(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.position);
}

/** 保存上次续写位置（防抖后调用） */
export async function saveLastPosition(position: LastPosition): Promise<boolean> {
  return window.electronAPI!.novel.configSet(STORAGE_KEYS.position, JSON.stringify(position));
}

/** 读取右栏宽度 JSON（键不存在返回 null，由上层夹取到合法区间） */
export async function fetchPanelWidth(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.panelWidth);
}

/** 保存右栏宽度（拖拽结束后防抖落库） */
export async function savePanelWidth(width: number): Promise<boolean> {
  return window.electronAPI!.novel.configSet(
    STORAGE_KEYS.panelWidth,
    JSON.stringify(width),
  );
}

// ── 作品管理（R29） ──

/** 新建作品落库（novel-work-add；id 由渲染层生成） */
export async function addWork(work: NovelWork): Promise<boolean> {
  return window.electronAPI!.novel.addWork(work);
}

/** 作品重命名（novel-work-rename） */
export async function renameWork(workId: string, name: string): Promise<boolean> {
  return window.electronAPI!.novel.renameWork(workId, name);
}

/** 设置作品题材（novel-work-set-genre；传 null 即清空） */
export async function setWorkGenre(workId: string, genre: string | null): Promise<boolean> {
  return window.electronAPI!.novel.setWorkGenre(workId, genre);
}

/** 删除作品（novel-work-delete，主进程级联清理全部关联数据） */
export async function removeWork(workId: string): Promise<boolean> {
  return window.electronAPI!.novel.deleteWork(workId);
}

// ── 数据安全（P0：一键全量备份 / 恢复 + 删除兜底） ──

/**
 * 删除作品 → 移入回收站（novel-work-trash，软删除）。
 *
 * ⚠️ 与 `removeWork` 的分工：日常删除一律走这里（只打 deleted_at，卷章正文 /
 * 要素 / 行囊全都留着，30 天内可恢复）；`removeWork` 是**彻底删除**，只由
 * 回收站的「彻底删除 / 清空」与过期清理调用。
 */
export async function trashWork(workId: string): Promise<boolean> {
  return window.electronAPI!.novel.trashWork(workId);
}

/** 回收站列表（作品 / 卷 / 章三类，含规模与剩余可恢复天数） */
export async function listTrash(): Promise<NovelTrashListResult> {
  return window.electronAPI!.novel.listTrash();
}

/** 从回收站恢复条目（作品只清标记；卷 / 章会处理原位置被占的情况） */
export async function restoreTrash(
  kind: NovelTrashKind,
  id: string,
): Promise<boolean> {
  return window.electronAPI!.novel.restoreTrash(kind, id);
}

/** 一键全量备份（打包 novel.db + manifest，主进程弹保存框） */
export async function exportNovelBackup(): Promise<NovelBackupExportResult> {
  return window.electronAPI!.novel.exportBackup();
}

/** 选备份包并校验（只读清单，返回规模摘要供确认） */
export async function pickNovelBackup(): Promise<NovelBackupPickResult> {
  return window.electronAPI!.novel.pickBackup();
}

/** 用备份包覆盖整库（主进程先留底，失败自动回滚） */
export async function restoreNovelBackup(
  filePath: string,
): Promise<NovelBackupRestoreResult> {
  return window.electronAPI!.novel.restoreBackup(filePath);
}

/** 重置摘要（novel-editor-reset-template 返回，toast 汇报用） */
export interface TemplateResetSummary {
  volumes: number;
  chapters: number;
  words: number;
  entities: number;
}

/**
 * 一键重置为模板书籍（调试）：主进程单事务清空全部 novel_* 表后
 * 重新播种模板数据（novel-template.ts 实时构建，改模板定义后重置即生效）。
 * 排版设置保留，续写位置由主进程一并清除。
 */
export async function resetTemplateBook(): Promise<TemplateResetSummary> {
  return window.electronAPI!.novel.resetTemplate();
}

/** 保存章节正文 + 字数（novel-chapter-save，主进程同事务写增量快照） */
export async function saveChapterContent(
  chapterId: string,
  content: string,
  wordCount: number,
): Promise<boolean> {
  return window.electronAPI!.novel.saveChapter(chapterId, content, wordCount);
}

/** 拉取某章节的历史快照（novel-snapshot-list） */
export async function fetchChapterSnapshots(
  chapterId: string,
): Promise<NovelSnapshot[]> {
  return window.electronAPI!.novel.listSnapshots(chapterId);
}

/** 全书检索：按章节聚合命中次数（内存计算，PRD R10） */
export async function searchAcrossBook(
  keyword: string,
  chapters: NovelChapter[],
): Promise<SearchHit[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  // ⚠️ 两步走，别在 map 里先建结果再 filter：
  // ① `content.split(keyword)` 会为**每一章**分配一个全章大小的数组（百章长篇
  //    就是几百 MB 级的临时分配），② 摘要里的 `replace(/\s+/g, " ")` 是全文正则，
  //    对压根没命中的章也跑一遍 —— 防抖每触发一次就是一遍全书级同步 CPU，
  //    会卡住输入法。改成 indexOf 计数：未命中章一次扫描、零分配、零摘要。
  const hits: SearchHit[] = [];
  for (const chapter of chapters) {
    const count = countOccurrences(chapter.content, trimmed);
    if (count === 0) continue;
    hits.push({
      id: `${chapter.id}-${trimmed}`,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      count,
      snippet: buildSearchSnippet(chapter.content, trimmed),
    });
  }
  return hits.sort((a, b) => b.count - a.count);
}

/** 子串出现次数：indexOf 循环，不切开字符串（零中间数组） */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** 新建章节落库（novel-chapter-add；id 已由渲染层生成） */
export async function addChapter(chapter: NovelChapter): Promise<boolean> {
  return window.electronAPI!.novel.addChapter(chapter);
}

/** 章节重命名（novel-chapter-rename） */
export async function renameChapter(chapterId: string, title: string): Promise<boolean> {
  return window.electronAPI!.novel.renameChapter(chapterId, title);
}

/** 删除章节 = 移入回收站（novel-chapter-delete，软删除；正文与快照都保留） */
export async function removeChapter(chapterId: string): Promise<boolean> {
  return window.electronAPI!.novel.deleteChapter(chapterId);
}

/** 彻底删除章节（novel-chapter-purge，级联清理历史快照，不可恢复） */
export async function purgeChapter(chapterId: string): Promise<boolean> {
  return window.electronAPI!.novel.purgeChapter(chapterId);
}

/** 章节状态切换（novel-chapter-status） */
export async function setChapterStatus(
  chapterId: string,
  status: NovelChapter["status"],
): Promise<boolean> {
  return window.electronAPI!.novel.setChapterStatus(chapterId, status);
}

/** 章节大纲梗概保存（novel-chapter-outline，空串即清除） */
export async function saveChapterOutline(
  chapterId: string,
  note: string,
): Promise<boolean> {
  return window.electronAPI!.novel.saveChapterOutline(chapterId, note);
}

/** 章节批量重排 / 跨卷移动落库（novel-chapter-order） */
export async function saveChapterOrder(
  updates: Array<{ id: string; sort: number; volumeId: string }>,
): Promise<boolean> {
  return window.electronAPI!.novel.saveChapterOrder(updates);
}

/** 新建卷落库（novel-volume-add） */
export async function addVolume(volume: NovelVolume): Promise<boolean> {
  return window.electronAPI!.novel.addVolume(volume);
}

/** 卷命名（novel-volume-rename） */
export async function renameVolume(volumeId: string, name: string): Promise<boolean> {
  return window.electronAPI!.novel.renameVolume(volumeId, name);
}

/** 卷批量重排落库（novel-volume-order） */
export async function saveVolumeOrder(
  updates: Array<{ id: string; sort: number }>,
): Promise<boolean> {
  return window.electronAPI!.novel.saveVolumeOrder(updates);
}

/** 删除卷 = 移入回收站（novel-volume-delete，卷与卷内章节同批打标，可恢复） */
export async function removeVolume(volumeId: string): Promise<boolean> {
  return window.electronAPI!.novel.deleteVolume(volumeId);
}

/** 彻底删除卷（novel-volume-purge，级联清理章节 / 快照 / 大纲条目） */
export async function purgeVolume(volumeId: string): Promise<boolean> {
  return window.electronAPI!.novel.purgeVolume(volumeId);
}

/** 要素保存（novel-entity-save，upsert：新建 / 编辑 / 别名关联共用） */
export async function saveEntity(entity: NovelEntity): Promise<boolean> {
  return window.electronAPI!.novel.saveEntity(entity);
}

/** 新增要素关联（novel-link-add） */
export async function addLink(link: NovelLink): Promise<boolean> {
  return window.electronAPI!.novel.addLink(link);
}

/** 解除要素关联（novel-link-remove） */
export async function removeLink(linkId: string): Promise<boolean> {
  return window.electronAPI!.novel.removeLink(linkId);
}

/** 新增 / 更新灵感速记（novel-note-save，upsert 语义） */
export async function saveNote(note: NovelNote): Promise<boolean> {
  return window.electronAPI!.novel.saveNote(note);
}

/** 删除灵感速记（novel-note-remove） */
export async function removeNote(noteId: string): Promise<boolean> {
  return window.electronAPI!.novel.removeNote(noteId);
}

/**
 * 灵感归属迁移（书架全局灵感库 R32）：归档到指定作品；
 * workId 传空串表示退回「未归属」全局池。note-save 的 upsert 不更新 work_id，
 * 归属变更必须走这条专用通道。
 */
export async function moveNote(noteId: string, workId: string): Promise<boolean> {
  return window.electronAPI!.novel.moveNote(noteId, workId);
}

/** 新增 / 更新伏笔条目（novel-outline-entry-save，upsert 语义） */
export async function saveOutlineEntry(entry: OutlineEntry): Promise<boolean> {
  return window.electronAPI!.novel.saveOutlineEntry(entry);
}

/** 删除伏笔条目（novel-outline-entry-remove） */
export async function removeOutlineEntry(entryId: string): Promise<boolean> {
  return window.electronAPI!.novel.removeOutlineEntry(entryId);
}

// ── 小说设定（1.36.0 起取代「等级体系管理」） ──
//
// 境界体系不再是独立实体，而是 `kind='realm'` 的一个设定分类；
// 功法等级 / 丹药稀有度等同构。全部走 `novel_setting_*` 两张表。

/**
 * 只重读「设定」这一片（含被引用分类的镜像行）—— 1.45.1 全局库实时同步用。
 *
 * 走 `novel-editor-load` 的 `includeContent=false`：正文是这条通道里唯一的大字段
 * （2000 章 × 3000 字 ≈ 12MB，见该 handler 的注释），而全局库改名 / 调层级 /
 * 增删等级后要刷的只是 `novel_setting_*` —— 没必要把全书正文再拉一遍过 IPC。
 *
 * 返回**全作品**的分类（调用方按 id 合并），语义与 `fetchNovelBundle().settings`
 * 完全一致，只是量级小得多。**不要**拿它当装载用：它不返回 chapters / notes 等，
 * 只有设定。
 *
 * 为什么不新开一条「按作品取设定」的窄通道：本仓读通道只有 `novel-editor-load`
 * 这一条，新增通道要同时改 preload / electron.d.ts / 主进程 handler 三处，收益
 * 只是省掉一次元数据读；而全局库写入是低频动作，不值得为它扩一条通道。
 */
export async function fetchSettingMirror(): Promise<SettingCategory[]> {
  const bundle = await window.electronAPI!.novel.editorLoad(false);
  return bundle.settings;
}

/**
 * 新建设定分类（novel-setting-category-add）
 *
 * `kind` 传 'realm' 时主进程会先查本书是否已有境界体系 —— 有则**降级为 custom**，
 * 境界体系全书只能有一个（角色卡「当前境界」绑定依赖这个唯一性）。
 * 返回的 `kind` 是落地后的真实值，渲染层要用它而不是入参。
 */
export async function addSettingCategory(
  workId: string,
  id: string,
  name: string,
  kind: "realm" | "custom",
  color?: string,
): Promise<{ id: string; kind: "realm" | "custom" } | null> {
  return window.electronAPI!.novel.settingCategoryAdd(workId, id, name, kind, color);
}

/** 改分类：重命名 / 改色 / 改说明 / 改进位规则（novel-setting-category-update） */
export async function patchSettingCategory(
  categoryId: string,
  patch: NovelSettingCategoryPatch,
): Promise<boolean> {
  return window.electronAPI!.novel.settingCategoryUpdate(categoryId, patch);
}

/** 删除分类（主进程级联摘除境界绑定与等级项） */
export async function removeSettingCategory(categoryId: string): Promise<boolean> {
  return window.electronAPI!.novel.settingCategoryDelete(categoryId);
}

/** 分类重排 */
export async function saveSettingCategoryOrder(
  updates: Array<{ id: string; sortOrder: number }>,
): Promise<boolean> {
  return window.electronAPI!.novel.settingCategoryOrder(updates);
}

/**
 * 追加 / 插入等级项（novel-setting-level-add）
 *
 * `index` 是插入落点（0 = 最前）；主进程重排落点及之后的 rank，
 * 不重排会出现两条相同 rank 的行。
 */
export async function addSettingLevel(
  categoryId: string,
  id: string,
  name: string,
  index: number,
): Promise<{ id: string; rank: number } | null> {
  return window.electronAPI!.novel.settingLevelAdd(categoryId, id, name, index);
}

/** 批量新增等级项：全部追加到末尾，返回实际插入条数（1.37.0） */
export async function batchAddSettingLevels(
  categoryId: string,
  items: Array<{ id: string; name: string; subLevels?: number; subPattern?: string }>,
): Promise<number> {
  return window.electronAPI!.novel.settingLevelBatchAdd(categoryId, items);
}

/** 改等级项：重命名 / 别名 / 说明 / 小层数 / 战力当量 */
export async function patchSettingLevel(
  levelId: string,
  patch: NovelSettingLevelPatch,
): Promise<boolean> {
  return window.electronAPI!.novel.settingLevelUpdate(levelId, patch);
}

/** 删除等级项（连同它的派生分段一起删，并把后面的 rank 前移） */
export async function removeSettingLevel(levelId: string): Promise<boolean> {
  return window.electronAPI!.novel.settingLevelDelete(levelId);
}

/** 等级项批量重排（拖拽后全量回写 {id, rank}） */
export async function saveSettingLevelOrder(
  updates: Array<{ id: string; rank: number }>,
): Promise<boolean> {
  return window.electronAPI!.novel.settingLevelOrder(updates);
}

/** 拆分层级：按小层分界切成多段，原行变成第一段 */
export async function splitSettingLevel(
  levelId: string,
  segments: Array<{ name: string; from: number; to: number }>,
): Promise<boolean> {
  return window.electronAPI!.novel.settingLevelSplit(levelId, segments);
}

/** 合并层级：摘掉派生段，还原小层总数 */
export async function mergeSettingLevel(levelId: string): Promise<boolean> {
  return window.electronAPI!.novel.settingLevelMerge(levelId);
}

/** 导出设定为可搬运载荷（写文件 / 存模板共用同一份快照） */
export async function exportSetting(workId: string): Promise<NovelSettingExportPayload> {
  return window.electronAPI!.novel.settingExport(workId);
}

/** 列出预设模板 */
export async function listSettingTemplates(): Promise<NovelSettingTemplateDTO[]> {
  return window.electronAPI!.novel.settingTemplateList();
}

/** 把当前作品的设定存为模板 */
export async function saveSettingTemplate(
  id: string,
  name: string,
  workId: string,
  categoryIds: string[],
): Promise<boolean> {
  return window.electronAPI!.novel.settingTemplateSave(id, name, workId, categoryIds);
}

/** 套用模板到当前作品，返回写入的分类数 */
export async function applySettingTemplate(
  templateId: string,
  workId: string,
): Promise<number> {
  return window.electronAPI!.novel.settingTemplateApply(templateId, workId);
}

/** 删除模板 */
export async function removeSettingTemplate(templateId: string): Promise<boolean> {
  return window.electronAPI!.novel.settingTemplateDelete(templateId);
}

// ── 全局设定中心联动（1.4x，REQ-041 / REQ-042） ──

/**
 * 读全局库分类（供本书「从全局库选择」选择器展示）。
 * 含 `refCount`（多少部书在引用），低频、打开选择器才读。
 */
export async function loadGlobalSettingCategories(): Promise<
  NovelGlobalSettingCategoryDTO[]
> {
  const { categories } = await window.electronAPI!.novel.globalSettingLoad();
  return categories;
}

/**
 * 本书引用一个全局分类（建立只读镜像，改动随全局实时同步，D2）。
 * 已有引用时幂等返回 true；主进程写成功后广播 `global-setting-changed`，
 * 让打开着的全局窗口刷新「N 部书引用」计数。
 */
export async function referenceGlobalCategory(
  workId: string,
  globalCategoryId: string,
): Promise<boolean> {
  return window.electronAPI!.novel.referenceGlobal(workId, globalCategoryId);
}

/**
 * 本书分类上架到全局（复制快照，D3）；同名冲突由 conflict 决定。
 * `conflict='cancel'` 先探同名 → 命中返回 `{ok:false, conflict:true}`，
 * 渲染层二次确认后以 `'duplicate'` 再调一次。
 */
export async function publishCategoryToGlobal(
  workId: string,
  categoryId: string,
  conflict: "duplicate" | "cancel",
): Promise<PublishToGlobalResult> {
  return window.electronAPI!.novel.publishGlobal(workId, categoryId, conflict);
}

// ── 文本导出（R13；行囊 REQ-030 复用同一通道） ──

/** 导出 TXT（novel-export-file，缺省 ext）：主进程弹保存框 + 写盘；用户取消返回 null */
export async function exportTxtFile(
  defaultName: string,
  content: string,
): Promise<{ path: string } | null> {
  return window.electronAPI!.novel.exportFile(defaultName, content);
}

/** 导出任意文本格式（行囊的 Markdown 表格走这条） */
export async function exportTextFile(
  defaultName: string,
  content: string,
  ext: string,
  filterName: string,
): Promise<{ path: string } | null> {
  return window.electronAPI!.novel.exportFile(defaultName, content, ext, filterName);
}

// ── 使用埋点（R14） ──

/** 今日聚合（novel-usage-today）：chapter_save 事件 delta 净增 + 保存次数 + 连续码字天数 */
export interface UsageTodaySummary {
  todayWords: number;
  saveCount: number;
  /** 连续码字天数：从今天（或昨天）回溯的有写作日连续数 */
  streakDays: number;
}

export async function fetchUsageToday(): Promise<UsageTodaySummary> {
  return window.electronAPI!.novel.usageToday();
}

// 通用事件上报已迁至 shared/services/novel-shared.ts（行囊模块跨窗口共用），
// 由文件头的 re-export 转发，原引用路径不变。

// ── 自定义要素类型（R23，config 整读整写） ──

/** 读取自建类型列表 JSON（键不存在返回 null） */
export async function fetchCustomEntityTypes(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.entityTypes);
}

/** 保存自建类型列表（防抖由调用方负责） */
export async function saveCustomEntityTypes(
  types: CustomEntityTypeDef[],
): Promise<boolean> {
  return window.electronAPI!.novel.configSet(
    STORAGE_KEYS.entityTypes,
    JSON.stringify(types),
  );
}

// ── 起名工具（R18 / 步骤三：复用 config 整读整写，零新表） ──

/** 读取起名工具收藏夹 JSON（键不存在返回 null） */
export async function fetchNameFavorites(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.namingFavorites);
}

/** 保存起名工具收藏夹（防抖由调用方负责） */
export async function saveNameFavorites(
  favorites: NameFavorite[],
): Promise<boolean> {
  return window.electronAPI!.novel.configSet(
    STORAGE_KEYS.namingFavorites,
    JSON.stringify(favorites),
  );
}

// ── 敏感词检测（工具箱）：词库 + 扫描模式，复用 config 整读整写 ──

/** 读取敏感词配置 JSON（键不存在返回 null，由上层按默认值兜底） */
export async function fetchSensitiveConfig(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.sensitiveConfig);
}

/** 保存敏感词配置（词库 / 屏蔽列表 / 模式三项合一，改动防抖后落库） */
export async function saveSensitiveConfig(
  config: SensitiveConfig,
): Promise<boolean> {
  return window.electronAPI!.novel.configSet(
    STORAGE_KEYS.sensitiveConfig,
    JSON.stringify(config),
  );
}
