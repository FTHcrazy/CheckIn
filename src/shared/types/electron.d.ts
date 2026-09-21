// Electron API 类型声明

interface ActivityAddParams {
  id: string
  date: string
  startTime: string
  endTime: string
  name: string
  color: string
}

interface ActivityUpdateParams {
  date?: string
  startTime?: string
  endTime?: string
  name?: string
  color?: string
}

interface ActivityRow {
  id: string
  date: string
  start_time: string
  end_time: string
  name: string
  color: string
}

interface TodoRow {
  id: number
  parent_id: number | null
  content: string
  done: number
  note: string | null
  important: number
  work_hour: number | null
  created_at: string
  done_at: string | null
}

// ── 小说编辑器 DTO（与 electron/handlers/novel-handlers.ts 的 Dto 定义保持一致） ──
// 本文件因 export interface ElectronAPI 已是模块环境：DTO 必须显式 export，
// 渲染进程各页面（NovelPage / BookshelfPage 等）才能 import type 共用同一契约。

export interface NovelWorkDTO {
  id: string
  name: string
  createdAt: number
}

export interface NovelVolumeDTO {
  id: string
  workId: string
  name: string
  sort: number
}

export interface NovelChapterDTO {
  id: string
  workId: string
  volumeId: string
  title: string
  content: string
  wordCount: number
  status: "draft" | "done"
  sort: number
  updatedAt: number
  outlineNote?: string
}

export interface NovelSnapshotDTO {
  id: string
  chapterId: string
  content: string
  deltaWords: number
  createdAt: number
}

export interface NovelNoteDTO {
  id: string
  workId: string
  content: string
  createdAt: number
  pinned: boolean
  foreshadowId?: string
}

export interface NovelOutlineEntryDTO {
  id: string
  workId: string
  kind: "foreshadow"
  volumeId: string
  chapterId?: string
  title: string
  note: string
  status: "open" | "resolved"
  createdAt: number
}

export interface NovelEntityDTO {
  id: string
  workId: string
  type: NovelEntityTypeDTO
  name: string
  aliases: string[]
  summary: string
  content: string
  fields: Record<string, string>
  sort: number
}

export interface NovelLinkDTO {
  id: string
  fromType: NovelEntityTypeDTO
  fromId: string
  toType: NovelEntityTypeDTO
  toId: string
  relation: string
  note?: string
}

export interface NovelLevelSystemDTO {
  id: string
  workId: string
  name: string
  rungs: Array<{ id: string; name: string; rank: number; note?: string }>
}

export interface NovelBundleDTO {
  works: NovelWorkDTO[]
  volumes: NovelVolumeDTO[]
  chapters: NovelChapterDTO[]
  entities: NovelEntityDTO[]
  links: NovelLinkDTO[]
  levelSystems: NovelLevelSystemDTO[]
  notes: NovelNoteDTO[]
  outlineEntries: NovelOutlineEntryDTO[]
  recovery: { snapshotTime: number; deltaWords: number } | null
}

export interface ElectronAPI {
  /** 网络会话配置（一次性）：写入认证 Cookie 到 session jar */
  httpSession: {
    setCookie: (url: string, cookie: string) => Promise<boolean>
  }

  // ── 活动管理 ──
  activity: {
    list: () => Promise<ActivityRow[]>
    listByDate: (date: string) => Promise<ActivityRow[]>
    activeDates: (start: string, end: string) => Promise<string[]>
    add: (params: ActivityAddParams) => Promise<ActivityAddParams>
    update: (params: { id: string; updates: ActivityUpdateParams }) => Promise<void>
    delete: (id: string) => Promise<void>
  }

  // ── Todo 管理 ──
  todo: {
    list: () => Promise<TodoRow[]>
    add: (content: string, workHour: number | null) => Promise<{ lastInsertRowid: number }>
    addChild: (parentId: number, content: string, workHour: number | null) => Promise<void>
    delete: (id: number) => Promise<void>
    updateContent: (id: number, content: string, workHour: number | null) => Promise<void>
    updateNote: (id: number, note: string | null) => Promise<void>
    deleteNote: (id: number) => Promise<void>
    updateWorkHour: (id: number, workHour: number | null) => Promise<void>
    deleteWorkHour: (id: number) => Promise<void>
    toggleImportant: (id: number, important: number) => Promise<void>
    toggle: (id: number, checked: boolean) => Promise<void>
    toggleChild: (id: number, checked: boolean) => Promise<void>
    toggleParent: (id: number, checked: boolean) => Promise<void>
  }

  user: {
    get: () => Promise<{ id: number; email: string } | null>
    login: (email: string) => Promise<boolean>
    update: (email: string) => Promise<boolean>
  }

  // ── 小说编辑器（数据存 userDb 的 novel_* 表） ──
  novel: {
    editorLoad: () => Promise<NovelBundleDTO>
    /** 读取 userDb config（R5 设置持久化 / R6 位置记忆共用；键不存在返回 null） */
    configGet: (key: string) => Promise<string | null>
    configSet: (key: string, value: string) => Promise<boolean>
    addWork: (work: NovelWorkDTO) => Promise<boolean>
    renameWork: (id: string, name: string) => Promise<boolean>
    deleteWork: (id: string) => Promise<boolean>
    /** 一键重置为模板书籍（调试）：清空全部 novel_* 表并重新播种，返回摘要 */
    resetTemplate: () => Promise<{ volumes: number; chapters: number; words: number; entities: number }>
    saveChapter: (id: string, content: string, wordCount: number) => Promise<boolean>
    listSnapshots: (chapterId: string) => Promise<NovelSnapshotDTO[]>
    addChapter: (chapter: NovelChapterDTO) => Promise<boolean>
    renameChapter: (id: string, title: string) => Promise<boolean>
    deleteChapter: (id: string) => Promise<boolean>
    setChapterStatus: (id: string, status: "draft" | "done") => Promise<boolean>
    saveChapterOutline: (id: string, note: string) => Promise<boolean>
    saveChapterOrder: (updates: Array<{ id: string; sort: number; volumeId: string }>) => Promise<boolean>
    addVolume: (volume: NovelVolumeDTO) => Promise<boolean>
    renameVolume: (id: string, name: string) => Promise<boolean>
    saveVolumeOrder: (updates: Array<{ id: string; sort: number }>) => Promise<boolean>
    saveEntity: (entity: NovelEntityDTO) => Promise<boolean>
    addLink: (link: NovelLinkDTO) => Promise<boolean>
    removeLink: (id: string) => Promise<boolean>
    saveNote: (note: NovelNoteDTO) => Promise<boolean>
    removeNote: (id: string) => Promise<boolean>
    /** 灵感归属迁移（书架全局灵感库）：归档到作品；workId 传 '' 退回未归属池 */
    moveNote: (id: string, workId: string) => Promise<boolean>
    saveOutlineEntry: (entry: NovelOutlineEntryDTO) => Promise<boolean>
    removeOutlineEntry: (id: string) => Promise<boolean>
    // ── 等级体系管理（R25） ──
    levelSystemAdd: (system: { id: string; workId: string; name: string }) => Promise<boolean>
    levelSystemRename: (id: string, name: string) => Promise<boolean>
    levelSystemDelete: (id: string) => Promise<boolean>
    /** 向体系追加等级项，rank 由主进程按 MAX(rank)+1 分配；返回新等级项 */
    levelAdd: (systemId: string, id: string, name: string) => Promise<{ id: string; name: string; rank: number } | null>
    levelRename: (id: string, name: string) => Promise<boolean>
    levelDelete: (id: string) => Promise<boolean>
    levelOrder: (updates: Array<{ id: string; rank: number }>) => Promise<boolean>
    // ── 导出（R13）：主进程弹保存框 + 写盘；用户取消返回 null ──
    exportTxt: (defaultName: string, content: string) => Promise<{ path: string } | null>
    // ── 使用埋点（R14） ──
    /** 今日新增字数（chapter_save 事件 delta 净增）、保存次数与连续码字天数，0 点按主进程本地时间 */
    usageToday: () => Promise<{ todayWords: number; saveCount: number; streakDays: number }>
    usageLog: (event: string, payload: Record<string, unknown>) => Promise<boolean>
  }

  send: (channel: string, data: unknown) => void
  /** 返回取消订阅函数，用于组件卸载时移除监听 */
  receive: (channel: string, func: (...args: unknown[]) => void) => () => void

  // ── 跨窗口通信 ──
  windowAPI: {
    broadcast: (event: string, data?: unknown) => Promise<void>
    sendTo: (target: string, event: string, data?: unknown) => Promise<void>
    on: (event: string, handler: (...args: unknown[]) => void) => void
    off: (event: string, handler: (...args: unknown[]) => void) => void
  }

  memo: {
    list: () => Promise<{ name: string; updatedAt: string }[]>
    read: (filename: string) => Promise<string>
    write: (filename: string, content: string) => Promise<boolean>
    rename: (oldFilename: string, newFilename: string) => Promise<boolean>
    delete: (filename: string) => Promise<boolean>
    openInExplorer: (filename: string) => Promise<boolean>
    import: () => Promise<string[]>
    exportFile: (filename: string, format: "txt" | "docx") => Promise<boolean>
  }

  findInPage: (value?: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
