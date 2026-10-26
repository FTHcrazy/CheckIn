import { contextBridge, ipcRenderer } from 'electron'
import {
  buildWindowSendOptions,
  type WindowSendOptions,
} from './window-send-options'

/**
 * `ipcRenderer.on` 注册的是包了一层的 wrapper（剥掉 Electron 的 event 首参），
 * 而 `removeListener` 按**引用**比对 —— `off(event, handler)` 传的是原始 handler，
 * 永远匹配不到那个匿名 wrapper，监听器与它捕获的整条闭包链会一直存活。
 * 所以这里记住 handler → channel → wrapper 的映射，`off` 时删真 wrapper。
 *
 * 用 WeakMap 以 handler 为键：handler 被 GC 时映射自动释放，不会变成新泄漏源。
 */
const listenerWrappers = new WeakMap<
  (...args: unknown[]) => void,
  Map<string, (...args: unknown[]) => void>
>();

/**
 * IPC 通信观测（1.47.0）。
 *
 * 为什么不在主进程统一 hook：`ipcMain.handle` 没有全局拦截点，逐个包一层会
 * 散落 100+ 处；而 preload 是所有渲染层调用的唯一出口，在这里包一次就全覆盖。
 *
 * ⚠️ 只上报「失败」与「慢于阈值」——全量上报会让 ipc.log 一天几十万行，
 * 真正要排查的异常反而被淹没。阈值 300ms 是按本项目的本地 SQLite 往返定的
 * （正常调用普遍 <20ms）。
 */
const SLOW_IPC_MS = 300

function reportIpc(payload: {
  channel: string
  ok: boolean
  durationMs: number
  detail?: unknown
}): void {
  try {
    ipcRenderer.send('log-ipc', payload)
  } catch {
    // 日志通道自身异常不能影响业务调用
  }
}

/** 所有 `ipcRenderer.invoke` 的统一入口：返回值原样透传，异常原样抛出 */
function trackedInvoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const started = Date.now()
  return (ipcRenderer.invoke(channel, ...args) as Promise<unknown>).then(
    (value) => {
      const durationMs = Date.now() - started
      if (durationMs >= SLOW_IPC_MS) {
        reportIpc({ channel, ok: true, durationMs })
      }
      return value
    },
    (error: unknown) => {
      reportIpc({
        channel,
        ok: false,
        durationMs: Date.now() - started,
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })
      throw error
    },
  )
}

// 通过 contextBridge 暴露安全的 API 给渲染进程
/**
 * 待投递消息的本地收件箱。
 *
 * 主进程的 `window-send-to` 在目标窗口不存在时会把消息入队（见
 * `electron/window-pending.ts`）。窗口起来后本脚本主动 drain 一次；但
 * **拉到消息 ≠ 有人能接**：React 的 useEffect 往往还没注册监听。
 * 所以先放这儿，`windowAPI.on()` 注册时按事件名补投 —— 这样「消息先到、
 * 监听后挂」与「监听先挂、消息后到」两条时序都不会丢。
 */
interface PendingWindowMessage {
  event: string
  data?: unknown
}

const pendingInbox: PendingWindowMessage[] = []
/** event → 已注册的 handler（`on` 的补投要按事件名找接收方） */
const eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()

function deliverPending(event: string, data: unknown): boolean {
  const handlers = eventHandlers.get(event)
  if (!handlers || handlers.size === 0) return false
  for (const handler of handlers) {
    try {
      handler(data)
    } catch (error) {
      // 一个监听器抛错不该拖垮其它监听器 / 阻塞补投
      console.error(`[preload] 处理待投递消息 ${event} 失败`, error)
    }
  }
  return true
}

/** 把收件箱里「已经有人接」的消息按**到达顺序**投出去，没人接的继续留着 */
function flushPendingInbox(): void {
  if (pendingInbox.length === 0) return
  const remaining: PendingWindowMessage[] = []
  for (const message of pendingInbox) {
    // 顺序必须保持「老的先投」：同一种跳转连点两次时，后一次才是用户最终意图
    if (!deliverPending(message.event, message.data)) remaining.push(message)
  }
  pendingInbox.length = 0
  pendingInbox.push(...remaining)
}

let drainedPending = false

/** 向主进程取本窗口的待投递消息（装载完成后拉一次） */
function requestPendingMessages(): void {
  if (drainedPending) return
  void trackedInvoke('window-pending-drain')
    .then((raw) => {
      // null = 主进程还不认识这个窗口（注册晚于 preload 执行）：等 load 再试，
      // 不能把「没拉到」当成「没有待办」—— 那会把关系图那条跳转静默吞掉
      if (raw === null) return
      drainedPending = true
      if (!Array.isArray(raw)) return
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const { event, data } = item as { event?: unknown; data?: unknown }
        if (typeof event !== 'string' || event.length === 0) continue
        pendingInbox.push({ event, data })
      }
      flushPendingInbox()
    })
    .catch(() => {
      // 拉不到当作没有待办：一次导航失败不该拖住整个窗口
    })
}

requestPendingMessages()
// preload 的 tsconfig 不含 DOM lib，`window` 没有声明：从 globalThis 取即可
const host = globalThis as unknown as {
  addEventListener?: (type: string, listener: () => void) => void
}
host.addEventListener?.('load', requestPendingMessages)

contextBridge.exposeInMainWorld('electronAPI', {
  // 网络会话配置（一次性）：把认证 Cookie 写入 session jar，
  // 之后渲染进程 fetch 带 credentials:'include' 自动携带。
  // 请求本身不再经由主进程转发。
  httpSession: {
    setCookie: (url: string, cookie: string) =>
      trackedInvoke('http-session-set-cookie', { url, cookie }) as Promise<boolean>,
  },

  // ── 活动管理（语义化 IPC） ──
  activity: {
    list: () => trackedInvoke('activity-list'),
    listByDate: (date: string) => trackedInvoke('activity-list-by-date', date),
    activeDates: (start: string, end: string) => trackedInvoke('activity-active-dates', start, end),
    add: (params: { id: string; date: string; startTime: string; endTime: string; name: string; color: string }) =>
      trackedInvoke('activity-add', params),
    update: (params: { id: string; updates: Partial<{ date: string; startTime: string; endTime: string; name: string; color: string }> }) =>
      trackedInvoke('activity-update', params),
    delete: (id: string) => trackedInvoke('activity-delete', id),
  },

  // ── Todo 管理（语义化 IPC） ──
  todo: {
    list: () => trackedInvoke('todo-list'),
    add: (content: string, workHour: number | null) =>
      trackedInvoke('todo-add', { content, workHour }),
    addChild: (parentId: number, content: string, workHour: number | null) =>
      trackedInvoke('todo-add-child', { parentId, content, workHour }),
    delete: (id: number) => trackedInvoke('todo-delete', id),
    updateContent: (id: number, content: string, workHour: number | null) =>
      trackedInvoke('todo-update-content', { id, content, workHour }),
    updateNote: (id: number, note: string | null) =>
      trackedInvoke('todo-update-note', id, note),
    deleteNote: (id: number) => trackedInvoke('todo-delete-note', id),
    updateWorkHour: (id: number, workHour: number | null) =>
      trackedInvoke('todo-update-work-hour', id, workHour),
    deleteWorkHour: (id: number) => trackedInvoke('todo-delete-work-hour', id),
    toggleImportant: (id: number, important: number) =>
      trackedInvoke('todo-toggle-important', id, important),
    toggle: (id: number, checked: boolean) =>
      trackedInvoke('todo-toggle', id, checked),
    toggleChild: (id: number, checked: boolean) =>
      trackedInvoke('todo-toggle-child', id, checked),
    toggleParent: (id: number, checked: boolean) =>
      trackedInvoke('todo-toggle-parent', id, checked),
    // ── 备份包（zip：manifest + todos.json，追加合并导入） ──
    exportBackup: () =>
      trackedInvoke('todo-backup-export') as Promise<{
        canceled: boolean
        filePath: string | null
        count: number
      }>,
    importBackup: () =>
      trackedInvoke('todo-backup-import') as Promise<{
        canceled: boolean
        count: number
        skipped: string[]
      }>,
  },

  // ── 用户管理 ──
  user: {
    get: () => trackedInvoke('user-get'),
    login: (email: string) => trackedInvoke('user-login', email),
    update: (email: string) => trackedInvoke('user-update', email),
  },

  // ── 小说编辑器（语义化 IPC，数据存 userDb 的 novel_* 表） ──
  novel: {
    // includeContent=false：只要章节元数据，不拉正文（书架用，见 novel-handlers）
    editorLoad: (includeContent?: boolean) =>
      trackedInvoke('novel-editor-load', includeContent),
    /** 开启编辑器会话（崩溃恢复标记的唯一写入口；只有真正进入编辑器才调） */
    sessionOpen: () => trackedInvoke('novel-session-open') as Promise<boolean>,
    configGet: (key: string) =>
      trackedInvoke('novel-config-get', key) as Promise<string | null>,
    configSet: (key: string, value: string) =>
      trackedInvoke('novel-config-set', key, value) as Promise<boolean>,
    addWork: (work: unknown) =>
      trackedInvoke('novel-work-add', work) as Promise<boolean>,
    renameWork: (id: string, name: string) =>
      trackedInvoke('novel-work-rename', id, name) as Promise<boolean>,
    deleteWork: (id: string) =>
      trackedInvoke('novel-work-delete', id) as Promise<boolean>,
    // ── 数据安全（P0）：一键全量备份 / 恢复 + 删除兜底（回收站） ──
    // 注意以下三组「日常删除 vs 彻底删除」的差别：
    //   trashWork / deleteChapter / deleteVolume  = 软删除（进回收站，可恢复）
    //   deleteWork / purgeChapter / purgeVolume   = 物理级联（不可恢复）
    trashWork: (id: string) =>
      trackedInvoke('novel-work-trash', id) as Promise<boolean>,
    listTrash: () => trackedInvoke('novel-trash-list'),
    restoreTrash: (kind: string, id: string) =>
      trackedInvoke('novel-trash-restore', kind, id) as Promise<boolean>,
    exportBackup: () => trackedInvoke('novel-backup-export'),
    pickBackup: () => trackedInvoke('novel-backup-pick'),
    restoreBackup: (filePath: string) =>
      trackedInvoke('novel-backup-restore', filePath),
    // 一键重置为模板书籍（调试）：清空全部 novel_* 表并重新播种模板数据
    resetTemplate: () =>
      trackedInvoke('novel-editor-reset-template') as Promise<{ volumes: number; chapters: number; words: number; entities: number }>,
    saveChapter: (id: string, content: string, wordCount: number) =>
      trackedInvoke('novel-chapter-save', id, content, wordCount) as Promise<boolean>,
    listSnapshots: (chapterId: string) =>
      trackedInvoke('novel-snapshot-list', chapterId),
    addChapter: (chapter: unknown) =>
      trackedInvoke('novel-chapter-add', chapter) as Promise<boolean>,
    renameChapter: (id: string, title: string) =>
      trackedInvoke('novel-chapter-rename', id, title) as Promise<boolean>,
    deleteChapter: (id: string) =>
      trackedInvoke('novel-chapter-delete', id) as Promise<boolean>,
    purgeChapter: (id: string) =>
      trackedInvoke('novel-chapter-purge', id) as Promise<boolean>,
    setChapterStatus: (id: string, status: string) =>
      trackedInvoke('novel-chapter-status', id, status) as Promise<boolean>,
    saveChapterOutline: (id: string, note: string) =>
      trackedInvoke('novel-chapter-outline', id, note) as Promise<boolean>,
    saveChapterOrder: (updates: Array<{ id: string; sort: number; volumeId: string }>) =>
      trackedInvoke('novel-chapter-order', updates) as Promise<boolean>,
    addVolume: (volume: unknown) =>
      trackedInvoke('novel-volume-add', volume) as Promise<boolean>,
    renameVolume: (id: string, name: string) =>
      trackedInvoke('novel-volume-rename', id, name) as Promise<boolean>,
    saveVolumeOrder: (updates: Array<{ id: string; sort: number }>) =>
      trackedInvoke('novel-volume-order', updates) as Promise<boolean>,
    deleteVolume: (id: string) =>
      trackedInvoke('novel-volume-delete', id) as Promise<boolean>,
    purgeVolume: (id: string) =>
      trackedInvoke('novel-volume-purge', id) as Promise<boolean>,
    saveEntity: (entity: unknown) =>
      trackedInvoke('novel-entity-save', entity) as Promise<boolean>,
    addLink: (link: unknown) => trackedInvoke('novel-link-add', link) as Promise<boolean>,
    removeLink: (id: string) => trackedInvoke('novel-link-remove', id) as Promise<boolean>,
    /**
     * 关系图提交（R27 / S3）：新建关系 + 改备注 + 画布文档，单事务。
     * 与 addLink 的区别：addLink 是主窗口「单条新增」的老通道，没有事务与 rev；
     * 图窗口一次确认要写多条，必须走这条。
     */
    graphCommit: (request: unknown) =>
      trackedInvoke('novel-graph-commit', request),
    saveNote: (note: unknown) => trackedInvoke('novel-note-save', note) as Promise<boolean>,
    removeNote: (id: string) => trackedInvoke('novel-note-remove', id) as Promise<boolean>,
    // 灵感归属迁移（书架全局灵感库）：归档到作品；workId 传 '' 退回未归属池
    moveNote: (id: string, workId: string) =>
      trackedInvoke('novel-note-move', id, workId) as Promise<boolean>,
    saveOutlineEntry: (entry: unknown) =>
      trackedInvoke('novel-outline-entry-save', entry) as Promise<boolean>,
    removeOutlineEntry: (id: string) =>
      trackedInvoke('novel-outline-entry-remove', id) as Promise<boolean>,
    // ── 小说设定（1.36.0：取代原等级体系管理） ──
    settingCategoryAdd: (workId: string, id: string, name: string, kind: 'realm' | 'custom', color?: string) =>
      trackedInvoke('novel-setting-category-add', workId, id, name, kind, color) as Promise<{ id: string; kind: 'realm' | 'custom' } | null>,
    settingCategoryUpdate: (id: string, patch: unknown) =>
      trackedInvoke('novel-setting-category-update', id, patch) as Promise<boolean>,
    settingCategoryDelete: (id: string) =>
      trackedInvoke('novel-setting-category-delete', id) as Promise<boolean>,
    settingCategoryOrder: (updates: Array<{ id: string; sortOrder: number }>) =>
      trackedInvoke('novel-setting-category-order', updates) as Promise<boolean>,
    /** index 为插入位置（0-based），-1 表示追加到末尾 */
    settingLevelAdd: (categoryId: string, id: string, name: string, index: number) =>
      trackedInvoke('novel-setting-level-add', categoryId, id, name, index) as Promise<{ id: string; rank: number } | null>,
    /** 批量新增等级项：全部追加到末尾，返回实际插入条数（1.37.0） */
    settingLevelBatchAdd: (categoryId: string, items: Array<{ id: string; name: string; subLevels?: number; subPattern?: string }>) =>
      trackedInvoke('novel-setting-level-batch-add', categoryId, items) as Promise<number>,
    settingLevelUpdate: (id: string, patch: unknown) =>
      trackedInvoke('novel-setting-level-update', id, patch) as Promise<boolean>,
    settingLevelDelete: (id: string) =>
      trackedInvoke('novel-setting-level-delete', id) as Promise<boolean>,
    settingLevelOrder: (updates: Array<{ id: string; rank: number }>) =>
      trackedInvoke('novel-setting-level-order', updates) as Promise<boolean>,
    settingLevelSplit: (levelId: string, segments: Array<{ name: string; from: number; to: number }>) =>
      trackedInvoke('novel-setting-level-split', levelId, segments) as Promise<boolean>,
    settingLevelMerge: (levelId: string) =>
      trackedInvoke('novel-setting-level-merge', levelId) as Promise<boolean>,
    settingExport: (workId: string) =>
      trackedInvoke('novel-setting-export', workId) as Promise<{ version: number; exportedAt: string; categories: unknown[] }>,
    settingImport: (workId: string, payload: unknown, mode: 'merge' | 'replace') =>
      trackedInvoke('novel-setting-import', workId, payload, mode) as Promise<{ imported: number; skipped: number }>,
    settingTemplateList: () =>
      trackedInvoke('novel-setting-template-list') as Promise<Array<{ id: string; name: string; createdAt: number; categories: unknown[] }>>,
    settingTemplateSave: (id: string, name: string, workId: string, categoryIds: string[]) =>
      trackedInvoke('novel-setting-template-save', id, name, workId, categoryIds) as Promise<boolean>,
    settingTemplateApply: (templateId: string, workId: string) =>
      trackedInvoke('novel-setting-template-apply', templateId, workId) as Promise<number>,
    settingTemplateDelete: (id: string) =>
      trackedInvoke('novel-setting-template-delete', id) as Promise<boolean>,
    // ── 全局设定中心（1.4x，独立窗口）：全局库 CRUD + 导出 ──
    globalSettingLoad: () =>
      trackedInvoke('novel-global-setting-load') as Promise<{ categories: unknown[] }>,
    globalCategoryAdd: (id: string, name: string, kind: 'realm' | 'custom', color?: string) =>
      trackedInvoke('novel-global-setting-category-add', id, name, kind, color) as Promise<{ id: string; kind: 'realm' | 'custom' } | null>,
    globalCategoryUpdate: (id: string, patch: unknown) =>
      trackedInvoke('novel-global-setting-category-update', id, patch) as Promise<boolean>,
    /** confirm 缺省 / 非 true 时只回传 refCount 供二次确认，不删除（D4） */
    globalCategoryDelete: (id: string, confirm?: boolean) =>
      trackedInvoke('novel-global-setting-category-delete', id, confirm) as Promise<{ ok: boolean; refCount: number }>,
    globalCategoryOrder: (updates: Array<{ id: string; sortOrder: number }>) =>
      trackedInvoke('novel-global-setting-category-order', updates) as Promise<boolean>,
    globalLevelAdd: (categoryId: string, id: string, name: string, index: number) =>
      trackedInvoke('novel-global-setting-level-add', categoryId, id, name, index) as Promise<{ id: string; rank: number } | null>,
    globalLevelBatchAdd: (categoryId: string, items: Array<{ id: string; name: string; subLevels?: number; subPattern?: string }>) =>
      trackedInvoke('novel-global-setting-level-batch-add', categoryId, items) as Promise<number>,
    globalLevelUpdate: (id: string, patch: unknown) =>
      trackedInvoke('novel-global-setting-level-update', id, patch) as Promise<boolean>,
    globalLevelDelete: (id: string) =>
      trackedInvoke('novel-global-setting-level-delete', id) as Promise<boolean>,
    globalLevelOrder: (updates: Array<{ id: string; rank: number }>) =>
      trackedInvoke('novel-global-setting-level-order', updates) as Promise<boolean>,
    globalLevelSplit: (levelId: string, segments: Array<{ name: string; from: number; to: number }>) =>
      trackedInvoke('novel-global-setting-level-split', levelId, segments) as Promise<boolean>,
    globalLevelMerge: (levelId: string) =>
      trackedInvoke('novel-global-setting-level-merge', levelId) as Promise<boolean>,
    globalSettingExport: () =>
      trackedInvoke('novel-global-setting-export') as Promise<{ version: number; exportedAt: string; categories: unknown[] }>,
    /** 引用方名单（R12）：某全局分类被哪几部书引用；只读，不写库 */
    globalCategoryRefs: (categoryId: string) =>
      trackedInvoke('novel-global-setting-refs', categoryId) as Promise<Array<{ workId: string; workName: string }>>,
    // ── 全局设定中心：本书「引用 / 上架」（写目标含本书侧镜像行，落在本书域通道） ──
    referenceGlobal: (workId: string, globalCategoryId: string) =>
      trackedInvoke('novel-setting-reference-global', workId, globalCategoryId) as Promise<boolean>,
    publishGlobal: (workId: string, categoryId: string, conflict: 'duplicate' | 'cancel') =>
      trackedInvoke('novel-setting-publish-global', workId, categoryId, conflict) as Promise<{ ok: boolean; globalCategoryId?: string; conflict?: boolean }>,
    // ── 书籍导入（TXT）：主进程只负责选文件 + 读字节 / 批量落库 ──
    /** 弹文件选择框并读回字节；取消返回 null */
    importPickFile: () =>
      trackedInvoke('novel-import-pick-file') as Promise<
        { fileName: string; bytes: ArrayBuffer; size: number } | null
      >,
    /** 解析结果单事务落库（作品 + 卷 + 章） */
    importBook: (payload: unknown) =>
      trackedInvoke('novel-import-book', payload) as Promise<
        { ok: boolean; chapterCount: number; wordCount: number } | { ok: false; error: string }
      >,
    // ── 导出（R13）与埋点（R14） ──
    /** 通用文本导出：主进程弹保存框 + 写盘；取消返回 null */
    exportFile: (defaultName: string, content: string, ext?: string, filterName?: string) =>
      trackedInvoke('novel-export-file', defaultName, content, ext, filterName) as Promise<{ path: string } | null>,
    /**
     * 取景：把当前窗口的某一块截成 PNG（R27 / S5）。
     * rect 单位是 DIP（= CSS px）；失败时 `code` 区分「空帧」「窗口没了」「参数错」，
     * `message` 已经是可以直接给用户看的一句话。
     */
    captureWindow: (rect: { x: number; y: number; width: number; height: number }) =>
      trackedInvoke('relation-window-export', rect) as Promise<
        | { ok: true; png: Uint8Array; width: number; height: number }
        | { ok: false; code: 'empty' | 'unavailable' | 'db'; message: string }
      >,
    /**
     * 二进制落盘：只收字节，取消返回 null。
     * ⚠️ 不要换成 `exportFile` —— 那条是 utf8 写，写 PNG 会坏且不报错。
     */
    exportBinary: (defaultName: string, data: Uint8Array, ext?: string, filterName?: string) =>
      trackedInvoke('novel-export-binary', defaultName, data, ext, filterName) as Promise<{ path: string } | null>,
    usageToday: () =>
      trackedInvoke('novel-usage-today') as Promise<{ todayWords: number; saveCount: number; streakDays: number }>,
    usageLog: (event: string, payload: Record<string, unknown>) =>
      trackedInvoke('novel-usage-log', event, payload) as Promise<boolean>,
    // ── 行囊 CharacterPack（PRD v1.5，文档已归档） ──
    pack: {
      load: (workId: string) => trackedInvoke('novel-pack-load', workId),
      /** 整文档事务保存：写前先落回退点，成功后清空草稿；返回 false 表示已整体回滚 */
      save: (payload: unknown) =>
        trackedInvoke('novel-pack-save', payload) as Promise<boolean>,
      draftSet: (characterId: string, payload: string, dirtyCount: number) =>
        trackedInvoke('novel-pack-draft-set', characterId, payload, dirtyCount) as Promise<boolean>,
      draftClear: (characterId: string) =>
        trackedInvoke('novel-pack-draft-clear', characterId) as Promise<boolean>,
      recordList: (characterId: string, limit?: number) =>
        trackedInvoke('novel-pack-record-list', characterId, limit),
      /** 境界幂等写入（同一来源+关系只保留一行） */
      linkSet: (link: unknown) =>
        trackedInvoke('novel-link-set', link) as Promise<boolean>,
      /** 主角绑定读数：null 表示该作品还没建过行囊角色（右侧要素栏就不显示主角角标） */
      protagonistGet: (workId: string) =>
        trackedInvoke('novel-pack-protagonist-get', workId),
      /** 设为主角 / 解除主角：entityId 传空串即解绑（同一格，换一个就换主角） */
      protagonistSet: (workId: string, entityId: string) =>
        trackedInvoke('novel-pack-protagonist-set', workId, entityId) as Promise<boolean>,
      /** 改主角名：绑定了实体就改实体名（名字的单一事实源在要素库） */
      rename: (workId: string, name: string) =>
        trackedInvoke('novel-pack-rename', workId, name) as Promise<{
          ok: boolean
          displayName: string
          target: 'entity' | 'character'
        }>,
      /**
       * 快速记账（REQ-027）：正文选区 → 记入背包。
       * 面板开着时渲染层自己改内存文档，不会走到这里；这条通道服务「面板没挂载」
       * 的场景，主进程会按「有草稿并入草稿、没有才直插正式表」落库。
       */
      quickAdd: (workId: string, name: string, chapterId: string, category: string) =>
        trackedInvoke('novel-pack-quick-add', workId, name, chapterId, category) as Promise<
          { id: string; characterId: string } | null
        >,
    },
    // ── 正文字体（应用级资源，跨用户共享；下载→@font-face 挂载） ──
    font: {
      download: (url: string, family: string) =>
        trackedInvoke('novel-font-download', { url, family }) as Promise<
          | { ok: true; entry: { family: string; fileName: string; size: number; fileUrl: string } }
          | { ok: false; error: string }
        >,
      list: () =>
        trackedInvoke('novel-font-list') as Promise<
          Array<{ family: string; fileName: string; size: number; fileUrl: string }>
        >,
      delete: (fileName: string) =>
        trackedInvoke('novel-font-delete', fileName) as Promise<boolean>,
    },
  },

  // ── AI 助手（语义化 IPC，数据存独立 ai.db，仅 full/novel 版注册） ──
  // 对 §8.7「主进程不代理 HTTP」契约的刻意豁免（凭据安全 + 端点无法枚举），
  // 理由见 docs/prd/prd-ai-config/ai-architecture-decision.md 第五节·A。
  // Key 经 safeStorage 加密存主进程，渲染层只拿 hasApiKey 布尔，绝无明文 Key。
  ai: {
    getConfig: () => trackedInvoke('ai-config-get'),
    saveConfig: (payload: {
      enabled?: boolean
      provider?: 'openai' | 'ollama'
      endpoint?: string
      model?: string
      apiKey?: string
      contextLen?: number
    }) => trackedInvoke('ai-config-save', payload) as Promise<{ ok: boolean; error?: string }>,
    test: () => trackedInvoke('ai-config-test'),
    generate: (payload: {
      system?: string
      prompt: string
      count?: number
      temperature?: number
    }) => trackedInvoke('ai-generate', payload),
    listLogs: (payload?: { limit?: number; offset?: number }) =>
      trackedInvoke('ai-log-list', payload),
    clearLogs: () => trackedInvoke('ai-log-clear'),
  },

  // ── 记账（语义化 IPC，数据存 userDb 的 ledger_* 表） ──
  ledger: {
    listTransactions: (range?: { start?: string; end?: string }) =>
      trackedInvoke('ledger-transaction-list', range),
    addTransaction: (tx: unknown) =>
      trackedInvoke('ledger-transaction-add', tx),
    updateTransaction: (id: string, updates: Record<string, unknown>) =>
      trackedInvoke('ledger-transaction-update', id, updates) as Promise<boolean>,
    deleteTransaction: (id: string) =>
      trackedInvoke('ledger-transaction-delete', id) as Promise<boolean>,
    listCategories: () => trackedInvoke('ledger-category-list'),
    upsertCategory: (category: unknown) =>
      trackedInvoke('ledger-category-upsert', category) as Promise<boolean>,
    deleteCategory: (id: string, fallbackId: string) =>
      trackedInvoke('ledger-category-delete', id, fallbackId) as Promise<boolean>,
  },

  send: (channel: string, data: unknown) => {
    const validChannels = [
      'login-confirm',
      'novel-window-open',
      // 设置窗口开关（novel 版主窗标题栏的设置入口）
      'settings-window-open',
      // 行囊独立窗口开关（小说窗口顶栏入口，full/novel 版）
      'pack-window-open',
      // 跨窗口导航：行囊窗口请求打开小说窗口的设定中心（UI-03）
      'novel-open-setting-center',
      // 全局设定中心独立窗口开关（书架入口，full/novel 版）
      'global-setting-window-open',
      // 人物关系网络独立窗口开关（右栏工具箱入口，full/novel 版，R27）
      'relation-window-open',
      // 退出登录（SettingsWindow 账号区发起，主进程编排回登录窗）
      'auth-logout',
      // WindowHeader 窗口控制（最小化/最大化/关闭）与最大化状态查询
      'window-control',
      'window-maximize-query',
      // 本地日志：IPC 失败 / 慢调用的观测上报（fire-and-forget）
      'log-ipc',
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  // 返回取消订阅函数，组件卸载时可移除监听，避免重复注册
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = [
      'activity-notify',
      'window-maximize-state',
      // 行囊窗口「真的可见」的回执：顶栏那颗按钮据此从「正在打开」恢复
      'pack-window-shown',
      // 全局设定中心窗口「真的可见」的回执：书架那颗按钮据此退出「正在打开」
      'global-setting-window-shown',
    ]
    if (validChannels.includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => func(...args)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
    return () => {}
  },

  // ── 跨窗口通信 ──
  windowAPI: {
    broadcast: (event: string, data?: unknown) =>
      trackedInvoke('window-broadcast', event, data),
    /**
     * 向指定窗口投递消息。
     *
     * 第 4 参保持旧的布尔 `raise` 语义（兼容既有调用）；第 5 参可声明
     * `create`（窗口没开就先拉起）与 `queue`（没开就入队，等它起来补投）。
     *
     * ⚠️ 进 IPC 前**压成一个选项参数**（`buildWindowSendOptions`）：主进程只该
     * 有「一个选项参数」这个概念。曾经这里把 `raise` 与 `options` 摆在两个位置，
     * 主进程按位读第 4 个，`{create:true}` 落在第 5 位被丢掉 —— 于是「窗口没开
     * 就拉起」从来没生效，用户看到的是「主窗口没能打开」。契约与互逆用例见
     * `electron/window-send-options.ts`。
     *
     * 返回 `{ delivered, queued }`：`delivered=false` 表示既送不到也拉不起来
     * （如 lite 版没有该窗口），调用方必须给用户可见提示 —— 静默失败会让
     * 用户以为按钮坏了。
     */
    sendTo: (
      target: string,
      event: string,
      data?: unknown,
      raise?: boolean,
      options?: WindowSendOptions,
    ) =>
      trackedInvoke(
        'window-send-to',
        target,
        event,
        data,
        buildWindowSendOptions(raise, options),
      ) as Promise<{
        delivered: boolean
        queued: boolean
      }>,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const wrapper = (_event: unknown, ...args: unknown[]) => handler(...args)
      let byChannel = listenerWrappers.get(handler)
      if (!byChannel) {
        byChannel = new Map()
        listenerWrappers.set(handler, byChannel)
      }
      // 同一 handler 重复注册同一频道：先摘掉旧的，避免叠加两条Notify
      const previous = byChannel.get(event)
      if (previous) ipcRenderer.removeListener(event, previous)
      byChannel.set(event, wrapper)
      ipcRenderer.on(event, wrapper)

      // 待投递消息可能早于本监听（窗口刚被拉起时）：登记完立刻补投一次
      let handlers = eventHandlers.get(event)
      if (!handlers) {
        handlers = new Set()
        eventHandlers.set(event, handlers)
      }
      handlers.add(handler)
      flushPendingInbox()
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      const registered = eventHandlers.get(event)
      if (registered) {
        registered.delete(handler)
        if (registered.size === 0) eventHandlers.delete(event)
      }
      const byChannel = listenerWrappers.get(handler)
      const wrapper = byChannel?.get(event)
      if (wrapper) {
        ipcRenderer.removeListener(event, wrapper)
        byChannel?.delete(event)
        if (byChannel && byChannel.size === 0) listenerWrappers.delete(handler)
        return
      }
      // 兜底：监听器不是由 windowAPI.on 注册的（其它模块 ipcRenderer.on 直通），按引用删
      ipcRenderer.removeListener(event, handler)
    },
    // ── 关闭守卫（electron/close-guard.ts）──
    // 有未保存改动时武装本窗口；主进程在真要销毁前会发 `window-close-request`
    // （用上面的 `on` 订阅，它会先摘掉同名旧监听再登记），渲染层用 respondClose 答复。
    setCloseGuard: (enabled: boolean) =>
      ipcRenderer.send('window-close-guard', enabled),
    respondClose: (allow: boolean) =>
      ipcRenderer.send('window-close-response', allow),
  },

  // ── 备忘文件操作 ──
  memo: {
    list: () => trackedInvoke('memo-list') as Promise<{ name: string; updatedAt: string }[]>,
    read: (filename: string) => trackedInvoke('memo-read', filename) as Promise<string>,
    write: (filename: string, content: string) => trackedInvoke('memo-write', filename, content) as Promise<boolean>,
    rename: (oldFilename: string, newFilename: string) => trackedInvoke('memo-rename', oldFilename, newFilename) as Promise<boolean>,
    delete: (filename: string) => trackedInvoke('memo-delete', filename) as Promise<boolean>,
    openInExplorer: (filename: string) => trackedInvoke('memo-open-in-explorer', filename) as Promise<boolean>,
    import: () => trackedInvoke('memo-import') as Promise<string[]>,
    exportFile: (filename: string, format: 'txt' | 'docx') =>
      trackedInvoke('memo-export', filename, format) as Promise<boolean>,
    // ── 备份包（zip：manifest + memos/*.md，追加合并导入、重名自动改写） ──
    exportBackup: () =>
      trackedInvoke('memo-backup-export') as Promise<{
        canceled: boolean
        filePath: string | null
        count: number
      }>,
    importBackup: () =>
      trackedInvoke('memo-backup-import') as Promise<{
        canceled: boolean
        count: number
        skipped: string[]
      }>,
  },

  findInPage: (value?: string) =>
    trackedInvoke('find-in-page', value) as Promise<boolean>,

  // ── 打卡（语义化 IPC，数据存 userDb 的 checkins 表） ──
  checkin: {
    status: () =>
      trackedInvoke('checkin-status') as Promise<{
        date: string
        checkedIn: boolean
        resetAt: string
      }>,
    today: () =>
      trackedInvoke('checkin-today') as Promise<{ date: string; created: boolean }>,
    dates: (start: string, end: string) =>
      trackedInvoke('checkin-dates', start, end) as Promise<string[]>,
  },

  // ── 本地日志（渲染层 → 主进程落盘） ──
  // 目录形如 {userData}/user-data/{email-hash}/logs/{窗口名}/YYYY-MM-DD.log，
  // 未登录写 logs/_anonymous/。窗口名由主进程反查，渲染层不必自报。
  log: {
    write: (entry: {
      level: 'debug' | 'info' | 'warn' | 'error'
      module: string
      message: string
      meta?: unknown
    }) => ipcRenderer.invoke('log-write', entry) as Promise<boolean>,
    getConfig: () =>
      ipcRenderer.invoke('log-config-get') as Promise<{
        level: 'debug' | 'info' | 'warn' | 'error'
        ipc: boolean
        retentionDays: number
      }>,
    setConfig: (patch: {
      level?: 'debug' | 'info' | 'warn' | 'error'
      ipc?: boolean
      retentionDays?: number
    }) =>
      ipcRenderer.invoke('log-config-set', patch) as Promise<{
        level: 'debug' | 'info' | 'warn' | 'error'
        ipc: boolean
        retentionDays: number
      }>,
    openDir: (windowName?: string) =>
      ipcRenderer.invoke('log-open-dir', windowName) as Promise<boolean>,
    switchUser: (reason: string) =>
      ipcRenderer.invoke('log-switch-user', reason) as Promise<string>,
  },

  // ── 快捷键（1.47.0：统一在设置窗口管理，应用级键由主进程注册） ──
  shortcut: {
    get: () =>
      trackedInvoke('shortcut-config-get') as Promise<{
        bindings: Record<string, string>
        globals: string[]
      }>,
    set: (config: { bindings: Record<string, string>; globals: string[] }) =>
      trackedInvoke('shortcut-config-set', config) as Promise<{
        config: { bindings: Record<string, string>; globals: string[] }
        /** 注册失败（被系统或其他应用占用）的应用级快捷键 id */
        globalFailures: string[]
      }>,
  },
})
