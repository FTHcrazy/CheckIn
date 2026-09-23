# CheckIn 项目架构设计与开发规范

本文档描述 CheckIn 项目的架构设计、模块划分、依赖关系与开发规范，供所有开发者遵循。

---

## 1. 全局架构概览

CheckIn 采用 Electron 双进程架构，渲染进程（React）与主进程（Node.js）通过 IPC 通信，主进程负责系统资源访问与数据持久化。

### 1.1 架构分层

```text
┌─────────────────────────────────────────────────────────────┐
│                     渲染进程 (Renderer)                      │
├─────────────────────────────────────────────────────────────┤
│  Windows (窗口层：一个子目录 = 一个独立窗口)                  │
│  ├─ BaseWindow (主窗口)                                      │
│  │  └─ pages: Todo / Memo / Daily / Code / User / Home      │
│  ├─ LoginWindow (登录窗口)                                   │
│  └─ WorkerWindow (临时工作窗口，即关即销)                    │
├─────────────────────────────────────────────────────────────┤
│  Shared (跨窗口共享层)                                       │
│  ├─ components / services / ipc / types / styles            │
├─────────────────────────────────────────────────────────────┤
│  Hooks (Business Logic Layer)                               │
│  └─ useTodoPage / useXxxPage                                │
├─────────────────────────────────────────────────────────────┤
│  Services (Data Access Layer)                               │
│  └─ daily.ts / code.ts                                      │
├─────────────────────────────────────────────────────────────┤
│  IPC Bridge (window.electronAPI)                            │
└─────────────────────────────────────────────────────────────┘
                            ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                      主进程 (Main)                           │
├─────────────────────────────────────────────────────────────┤
│  IPC Handlers (electron/main.ts + electron/handlers/)       │
├─────────────────────────────────────────────────────────────┤
│  Database Layer (electron/db.ts)                            │
│  └─ authDb (应用级) + userDb (用户级)                        │
├─────────────────────────────────────────────────────────────┤
│  System Services                                            │
│  └─ File System / Tray / Notifications / Background Tasks   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

1. **进程隔离**：渲染进程不直接访问系统资源，所有操作通过主进程暴露的 API
2. **用户数据隔离**：每个用户独立 SQLite 数据库，存储在 `user-data/{email-hash}/`
3. **窗口隔离**：一个独立窗口一个目录（`src/windows/XxxWindow/`），窗口之间禁止互相导入；窗口内自带入口 HTML、入口 TSX 与私有页面
4. **模块自治**：每个页面模块拥有独立的组件、样式、业务逻辑，避免跨页面耦合
5. **样式就近**：子组件样式与组件文件同级，严禁样式上移至父组件

---

## 2. 模块边界与职责

### 2.1 主进程模块 (`electron/`)

| 模块 | 职责 | 边界 |
|------|------|------|
| **main.ts** | 窗口生命周期管理、IPC 通道注册、托盘图标、应用启动流程 | 仅处理窗口和系统级操作，不包含业务逻辑 |
| **handlers/** | 语义化 IPC handler 按模块注册（`activity-handlers.ts` / `todo-handlers.ts` / `novel-handlers.ts` / `user-handlers.ts` / `memo-handlers.ts`），持有预定义 SQL | 每个 handler 文件只负责一个业务模块；SQL 只出现在 handlers 与 db.ts，禁止出现在渲染进程 |
| **preload.ts** | 通过 `contextBridge` 暴露安全的 API 给渲染进程 | 仅做 API 转发，不实现业务逻辑 |
| **db.ts** | SQLite 数据库初始化、双库管理（authDb/userDb）、通用 CRUD 封装 | 提供底层数据库操作，不感知上层业务 |
| **activitiesTask.ts** | 后台活动提醒轮询、系统事件监听（睡眠/锁屏） | 独立后台任务，通过 IPC 通知渲染进程 |
| **windowManager.ts** | 窗口管理池：注册/注销/广播/定点发送 | 只管理 BrowserWindow 实例，不感知业务 |

**模块边界规则**：
- `main.ts` 仅承担窗口生命周期、托盘、协议、窗口级 IPC（broadcast/window-control/find-in-page 等），**一切业务 IPC（user / memo / todo / activity / novel 等）一律抽到 `handlers/` 下独立模块**，禁止在 `main.ts` 内联业务逻辑或 SQL
- `db.ts` 不导入 `main.ts` 的任何内容；`db.ts` 维护当前用户邮箱（`getCurrentUserEmail()`），业务 handler 通过它定位用户数据目录，不依赖 `main.ts` 闭包
- `activitiesTask.ts` 通过 `ipcMain` 注册通道，不直接调用 `main.ts` 函数
- `preload.ts` 仅读取 `db.ts` 和 `main.ts` 暴露的 IPC 通道

### 2.2 渲染进程模块 (`src/`)

#### 2.2.0 窗口层 (`windows/`)

**一个独立窗口 = `src/windows/` 下的一个子目录**，目录内自包含该窗口的全部入口资源：

```text
src/windows/XxxWindow/
├── index.html      # 窗口入口 HTML（vite rollupOptions.input 登记）
├── main.tsx        # 入口：组装 Provider / Router，注册本窗口级 IPC 桥接
├── App.tsx         # 窗口根组件
└── (私有资源：pages/、index.scss 等)
```

| 窗口 | 路径 | 入口 HTML | 职责 |
|------|------|----------|------|
| **BaseWindow** | `windows/BaseWindow/` | `src/windows/BaseWindow/index.html` | 主窗口，承载全部业务页面（路由在 `App.tsx`） |
| **LoginWindow** | `windows/LoginWindow/` | `src/windows/LoginWindow/index.html` | 登录/欢迎窗口 |
| **WorkerWindow** | `windows/WorkerWindow/` | `src/windows/WorkerWindow/index.html` | 小说编辑器窗口（NovelPage），即关即销、重新打开即全新实例；数据由 `novel_*` 表持久化，崩溃恢复由会话标记驱动 |

**窗口边界规则**：
- 窗口之间**禁止互相导入**（如 `LoginWindow` 不得导入 `BaseWindow/pages` 的任何内容）
- 新增窗口时：在 `src/windows/` 建目录 → `vite.config.ts` 的 `rollupOptions.input` 登记 HTML → `electron/main.ts` 的 `RENDERER_ENTRIES` 登记加载路径
- 仅需某窗口处理的 IPC 推送，封装在 `shared/ipc/` 的显式注册函数中，由该窗口入口调用一次（如 `registerActivityNotifyBridge()`），避免模块加载副作用扩散

#### 2.2.1 共享层 (`shared/`)

`src/shared/` 存放**跨窗口/跨页面复用**的代码，窗口私有代码禁止放入：

| 模块 | 路径 | 职责 |
|------|------|------|
| **components** | `shared/components/` | 跨窗口共享 UI：Page（页面容器）、NavHeader（导航栏）、WindowHeader（窗口标题栏） |
| **services** | `shared/services/` | 数据访问：daily.ts、code.ts |
| **ipc** | `shared/ipc/` | 窗口级 IPC 桥接注册（显式调用，带防重复守卫） |
| **types** | `shared/types/` | 全局类型：electron.d.ts（window.electronAPI） |
| **styles** | `shared/styles/` | themes.scss（四套主题 `--app-*` 变量）、variables.scss（SCSS 变量）、window-shell.scss（圆角窗口外壳） |

**边界规则**：
- 只有两个以上窗口/页面需要时才允许放入 `shared/`；只有一个使用方的代码留在使用方目录内
- 各窗口统一用 `shared/theme/ThemeProvider` 包裹 App（内部已含 antd ConfigProvider，主题变量来自 `shared/styles/themes.scss`），禁止各窗口重复定义 theme

#### 2.2.1.1 组件分层规范：全局组件 vs 当前模块组件

- **全局组件**：放置于 `src/shared/components/`，用于跨窗口/跨页面复用的通用 UI，如 `Page`、`NavHeader`、通用 `EmptyState` 等。
- **当前模块组件**：放置于各页面目录内的 `components/`，仅供该页面或该模块内部使用，如 `TodoPage/components/NoteModal/`。
- **组件必须以文件夹形式存在**：每个组件都应为独立目录，目录内统一管理其逻辑、样式和入口，禁止出现“单文件组件 + 兄弟样式文件”的散乱结构。
- **样式统一命名**：组件目录中的样式文件必须统一命名为 `index.scss`，并在组件入口文件中统一引入。
- **逻辑归位**：不负责 UI 渲染的逻辑，如状态转换、表单处理、数据拉取、事件编排、缓存读写，原则上维护在 `hooks/`、`services/` 或 `store/` 中，组件只保留最小渲染职责。
- **全局状态库优先级**：如果必须引入全局状态管理库，优先采用 `Zustand`，避免使用更重的状态管理方案；仅在确实需要跨组件共享状态时才引入。

#### 2.2.2 数据服务层 (`services/`)

| 模块 | 职责 | 数据来源 | 被谁使用 |
|------|------|---------|---------|
| **daily.ts** | 日程活动 CRUD + 时间工具函数 | SQLite (via IPC) | DailyPage |
| **code.ts** | Git Webhook 日志查询 | 外部 HTTP API | CodePage |

**边界规则**：
- Service 层封装 IPC 调用，提供语义化 API（如 `addActivity()`）
- Service 层不包含 UI 逻辑，不导入 React
- Pages 通过 Service 层访问数据，不直接调用 `window.electronAPI.db`

#### 2.2.3 页面模块 (`windows/BaseWindow/pages/`)

页面模块只属于 BaseWindow 主窗口，路径为 `src/windows/BaseWindow/pages/`：

| 页面 | 核心组件 | 业务逻辑 | 数据源 | 私有子组件 |
|------|---------|---------|--------|-----------|
| **TodoPage** | TodoPage.tsx | hooks/useTodoData + useTodoEditorState + useTodoViewState | 语义化 todo IPC | TodoOutlineSidebar, TodoListItem, TodoToolbar, TodoSection, NoteModal, WorkHourModal, ChildInput, EditableText |
| **MemoPage** | MemoPage.tsx | hooks/useMemoData + useMemoEditorState + useMemoViewState | memo IPC（文件系统） | MemoSidebar, MemoHeader, MemoEditor, MemoPreview, MemoListItem |
| **DailyPage** | DailyPage.tsx | hooks/useDailyPage.ts | daily.ts (语义化 activity IPC) | 无 |
| **CodePage** | CodePage.tsx | hooks/useCodePage.ts | code.ts (HTTP via 主进程) | 无 |
| **UserPage** | UserPage.tsx | 内联 Form | user IPC (SQLite) | 无 |

**页面模块边界**：
- 页面之间**无直接依赖**，通过路由跳转
- 页面私有子组件**禁止**被其他页面导入
- 共享组件（Page, NavHeader）放在 `shared/components/`，所有页面可用

---

## 3. 组件依赖关系图

```text
windows/BaseWindow/
├─ main.tsx (入口：注册 IPC 桥接)
├─ App.tsx
│  ├─ ThemeProvider (含 antd ConfigProvider，theme/locale 来自 shared/theme + themes.scss)
│  ├─ ActivityNotifier (全局 IPC 监听)
│  └─ Routes
│     ├─ HomePage
│     ├─ TodoPage
│     │  ├─ Page (共享)
│     │  ├─ TodoOutlineSidebar (私有)
│     │  ├─ NoteModal (私有)
│     │  └─ WorkHourModal (私有)
│     ├─ MemoPage
│     │  ├─ Page
│     │  ├─ MemoSidebar (私有)
│     │  ├─ MemoHeader (私有)
│     │  ├─ MemoEditor (私有)
│     │  └─ MemoPreview (私有)
│     ├─ DailyPage
│     │  └─ Page
│     ├─ CodePage
│     │  └─ Page
│     └─ UserPage
│        └─ Page
└─ pages/ (仅属于 BaseWindow)

windows/LoginWindow/
├─ main.tsx (入口)
└─ App.tsx (登录/欢迎表单)

windows/WorkerWindow/
├─ main.tsx (入口：注册本窗口级 IPC 桥接)
└─ App.tsx
   └─ NovelPage (小说编辑器，三栏布局)
      ├─ Page (共享)
      ├─ ChapterTree (左栏章节树，虚拟滚动)
      ├─ EditorPane (中央码字区，CodeMirror 6)
      ├─ 支撑面板 (大纲 / 要素库 / 灵感速记 / 全书检索)
      └─ hooks/useNovelData + services/novel-service (经 IPC 持久化到 novel_* 表)
```

**依赖规则**：
- **单向依赖**：Pages → Services → IPC → Main，禁止反向调用
- **窗口隔离**：`LoginWindow` 与 `BaseWindow` 之间禁止互相导入，共享代码只能经由 `shared/`
- **平级禁止**：`TodoPage` 不导入 `MemoPage` 的任何内容
- **私有保护**：`pages/TodoPage/components/NoteModal` 仅被 `TodoPage` 使用
- **WorkerWindow 数据层**：`NovelPage` 经 `services/novel-service` → `novel IPC` → `novel-handlers` → `novel_*` 表持久化；崩溃恢复由会话级 `running` 标记驱动（窗口正常关闭 / 应用退出时清除，异常退出下次启动触发恢复横幅）

---

## 4. 数据流向

### 4.1 用户操作流（以添加 Todo 为例）

```text
User Input
    ↓
TodoPage.tsx (UI)
    ↓ 调用 handleAdd()
useTodoPage.ts (Hook)
    ↓ window.electronAPI.todo.add(content, workHour)
preload.ts (Bridge)
    ↓ ipcRenderer.invoke('todo-add', { content, workHour })
main.ts (IPC Handler 注册)
    ↓ todo-handlers.ts (handle)
db.ts → dbRun(sql, params)
SQLite
    ↓ 返回 { lastInsertRowid }
    ↑ 逐层返回
useTodoPage.ts
    ↓ setItems([...items, newTodo])
TodoPage.tsx
    ↓ React Re-render
UI Update
```

### 4.2 后台任务流（活动提醒）

```text
activitiesTask.ts
    ↓ 定时轮询（每分钟）
db.ts (查询即将开始的活动)
    ↓ 匹配到活动
main.ts (BrowserWindow.webContents.send)
    ↓ IPC 事件 'activity-notify'
TodoPage.tsx (ActivityNotifier 组件)
    ↓ window.addEventListener('activity-notify')
    ↓ 显示通知 + 自动跳转到 /daily
DailyPage.tsx
```

### 4.3 文件操作流（以保存 Memo 为例）

```text
MemoEditor.tsx
    ↓ 调用 onSave()
MemoPage.tsx
    ↓ window.electronAPI.memo.write(filename, content)
preload.ts
    ↓ ipcRenderer.invoke('memo-write', filename, content)
memo-handlers.ts (handle)
    ↓ fs.writeFileSync(filePath, content)
File System
```

---

## 5. 目录结构与文件组织

### 5.1 标准目录树

```text
CheckIn/
├── electron/                              # 主进程代码
│   ├── main.ts                            # 入口 + 窗口加载（RENDERER_ENTRIES）+ 系统级 IPC
│   ├── handlers/                          # 语义化 IPC handler（按模块拆分）
│   │   ├── activity-handlers.ts           # 日程活动 CRUD
│   │   ├── todo-handlers.ts               # Todo CRUD + 父子级联
│   │   ├── novel-handlers.ts              # 小说编辑器（novel_* 表 + 快照 + 崩溃恢复）
│   │   ├── user-handlers.ts               # 用户登录 / 缓存读写
│   │   └── memo-handlers.ts               # 备忘文件 CRUD + 导入导出
│   ├── preload.ts                         # API 暴露
│   ├── db.ts                              # 数据库管理
│   ├── windowManager.ts                   # 窗口管理池
│   └── activitiesTask.ts                  # 后台任务
├── src/
│   ├── windows/                           # 窗口层：一个子目录 = 一个独立窗口
│   │   ├── BaseWindow/                    # 主窗口
│   │   │   ├── index.html                 # 窗口入口 HTML
│   │   │   ├── main.tsx                   # 入口（Provider/Router + IPC 桥接注册）
│   │   │   ├── App.tsx                    # 路由 + 全局 Provider + ActivityNotifier
│   │   │   ├── index.scss                 # 窗口级全局样式重置
│   │   │   └── pages/                     # 仅属于主窗口的页面模块
│   │   │       ├── HomePage/
│   │   │       │   ├── index.tsx
│   │   │       │   └── index.scss
│   │   │       ├── TodoPage/
│   │   │       │   ├── TodoPage.tsx
│   │   │       │   ├── index.scss
│   │   │       │   ├── todo-utils.ts
│   │   │       │   ├── hooks/
│   │   │       │   │   └── useTodoPage.ts
│   │   │       │   └── components/
│   │   │       │       ├── NoteModal/
│   │   │       │       │   ├── index.tsx
│   │   │       │       │   └── index.scss
│   │   │       │       ├── WorkHourModal/
│   │   │       │       │   ├── index.tsx
│   │   │       │       │   └── index.scss
│   │   │       │       └── TodoOutlineSidebar/
│   │   │       │           ├── index.tsx
│   │   │       │           └── index.scss
│   │   │       ├── MemoPage/
│   │   │       ├── DailyPage/
│   │   │       ├── CodePage/
│   │   │       └── UserPage/
│   │   ├── LoginWindow/                   # 登录窗口
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   └── index.scss
│   │   └── WorkerWindow/                  # 小说编辑器窗口（NovelPage，即关即销）
│   │       ├── index.html
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── index.scss
│   │       └── pages/
│   │           └── NovelPage/             # 小说编辑器（三栏 + 快照/设置抽屉）
│   │               ├── NovelPage.tsx
│   │               ├── types.ts            # 领域模型（NovelBundle / NovelRecovery）
│   │               ├── novel-config.ts
│   │               ├── novel-utils.ts      # 纯函数（字数/词库/检索片段）
│   │               ├── services/
│   │               │   └── novel-service.ts  # 封装 novel IPC
│   │               ├── hooks/
│   │               │   ├── useNovelPage.ts
│   │               │   ├── useNovelData.ts          # 数据持久化
│   │               │   └── useNovelEditorState.ts    # 编辑器状态/快照
│   │               └── components/
│   │                   └── RestoreBanner/  # 崩溃恢复横幅
│   └── shared/                            # 跨窗口共享层
│       ├── components/                    # 共享 UI（Page、NavHeader…）
│       ├── services/                      # 数据服务（daily.ts、code.ts）
│       ├── ipc/                           # 窗口级 IPC 桥接（activityNotifyBridge.ts）
│       ├── types/                         # 全局类型（electron.d.ts）
│       └── styles/                        # themes.scss、variables.scss、window-shell.scss
├── vite.config.ts                         # rollupOptions.input 与 windows/* 一一对应；主进程 external 列 Node 运行时模块（electron/better-sqlite3/mammoth/docx）
├── tsconfig.json
└── package.json
```

### 5.2 页面模块内部结构规范

复杂页面（逻辑 >100 行）必须遵循以下结构：

```text
windows/BaseWindow/pages/XxxPage/
├── XxxPage.tsx           # 主组件（UI 渲染）
├── index.scss            # 页面级布局样式
├── xxx-utils.ts          # (可选) 纯函数工具
├── services/             # (可选) 页面专属数据服务（封装 IPC，不内联 SQL）
│   └── xxx-service.ts
├── hooks/
│   └── useXxxPage.ts    # 业务逻辑 Hook
├── components/
│   ├── SubA/
│   │   ├── index.tsx
│   │   └── index.scss
│   └── SubB/
│       ├── index.tsx
│       └── index.scss
└── store/                # 如需状态共享，可放模块级 store
    └── useXxxStore.ts
```

**组件文件组织要求**：
- 组件必须以目录形式存在，目录名即组件名。
- 每个组件目录内统一放置 `index.tsx` 与 `index.scss`，禁止使用 `Component.tsx + Component.scss` 这类命名方式。
- 组件目录仅管理该组件自身的样式、逻辑和导出；不允许把多个无关组件的样式堆积到同一父级 `index.scss` 中。
- 只有全局共享的 UI 才允许放在 `src/shared/components/`，页面私有组件必须保持在对应页面的 `components/` 中。

---

## 6. 开发规范

### 6.0 TypeScript 规范

**核心原则：强类型优先，禁止 `any`，减少隐式不安全行为。**

```typescript
// ❌ 禁止：any 逃逸
const item: any = response.data;
const list = records as any;

// ✅ 推荐：显式类型 + 细化判断
type TodoStatus = 'todo' | 'done';

interface TodoItem {
  id: number;
  content: string;
  status: TodoStatus;
}

function normalizeTodo(item: Partial<TodoItem> | null): TodoItem | null {
  if (!item) return null;
  return {
    id: item.id ?? 0,
    content: item.content ?? '',
    status: item.status ?? 'todo',
  };
}
```

**强制要求**：
- 禁止在 TypeScript 中使用 `any`，包括 `as any`、参数 `any`、返回值 `any`、对象字面量绕过类型等。
- 对于不确定的数据，使用 `unknown` + 类型守卫，或定义明确的 `interface` / `type`。
- 公开导出的函数、hook、服务方法必须给出明确的参数和返回值类型。
- 避免 `ts-ignore`、`@ts-nocheck` 和隐式 `any`；如果必须兼容第三方类型，优先使用类型声明文件或更准确的类型断言，而不是 `any`。
- 对于 API 响应、IPC 参数、数据库返回值等外部输入，必须先做类型校验，再进入业务逻辑。

### 6.1 样式规范

**原则：样式就近，严禁上移**

```scss
// ❌ 错误：将子组件样式写在父组件 index.scss
// pages/TodoPage/index.scss
.todo-item { ... }
.todo-item-checkbox { ... }  // 这是 TodoItem 子组件的样式

// ✅ 正确：子组件样式独立
// pages/TodoPage/components/TodoItem.scss
.todo-item { ... }
.todo-item-checkbox { ... }
```

**命名规范：BEM 或组件前缀**

```scss
// BEM 风格
.todo-section { }
.todo-section__header { }
.todo-section--collapsed { }

// 组件前缀风格
.memo-sidebar { }
.memo-sidebar-header { }
```

### 6.1.1 主题与换肤规范

**原则：业务样式只写 `var(--app-*)`，禁止硬编码色值**

四套主题共用同一组 CSS 变量（见 `shared/styles/themes.scss`），由 `<html data-theme>` 切换：

| 主题 id | 名称 | 说明 |
|---------|------|------|
| `aurora` | 柔雾紫蓝 | 默认主题 |
| `cream` | 奶油暖橘 | 暖阳奶油 |
| `mint` | 薄荷清新 | 薄荷新绿 |
| `midnight` | 月夜暗色 | 暗色，antd 走 `darkAlgorithm` |

```scss
// ❌ 错误：硬编码色值，换肤后不跟随
.card { background: #fff; border: 1px solid #eee; color: #333; }

// ✅ 正确：全部走主题变量
.card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-text);
}
```

**接入要求（三个窗口都要遵守，保证「所有窗口同一套主题色」）**：

1. 窗口入口 `import "@/shared/styles/themes.scss"`，并在 `createRoot` **之前**调用
   `initThemeFromStorage()`（首帧就带上正确主题，避免暗色白闪）
2. 用 `ThemeProvider` 包裹 App —— 它内部已含 `ConfigProvider`，**窗口入口不要再各包一层**
3. 需要读取/切换主题时用 `useTheme()`（`shared/theme`），不要在组件里直接读 `data-theme`

**新增主题时同步 4 处**（漏一处就会换肤后局部掉色）：

| # | 文件 | 改动 |
|---|------|------|
| 1 | `shared/styles/themes.scss` | 新增 `[data-theme="xxx"]` 变量块，变量集合须与默认主题完全一致 |
| 2 | `shared/theme/themes.ts` | `ThemeId` 联合类型 + `THEME_LIST` 追加一项（含 antd 色板具体色值） |
| 3 | `ThemeProvider.tsx` | 暗色主题确认走 `darkAlgorithm`（`meta.isDark` 为 true 即可，无需改码） |
| 4 | 单测 | `themes.test.ts` 会自动校验变量集合一致性，跑 `pnpm test` 确认 |

> 注意：antd 的 `token` 必须传**具体色值**，不能传 `var(--app-*)` —— antd 要基于它们做派生色运算。

**覆盖范围：样式文件 + TSX 内联样式，两侧都禁止硬编码色值**

```tsx
// ❌ 错误：内联色同样会在暗色主题下变成浅色斑块
<PlusOutlined style={{ color: "#52c41a" }} />

// ✅ 正确：内联样式里 var() 也是合法的
<PlusOutlined style={{ color: "var(--app-success)" }} />
```

**主题切换入口唯一**：全局只在首页侧边栏底部（`HomeSidebar`）挂 `ThemeSwitcher`。
`WindowHeader`、登录窗口等标题栏位置**不要再放切换器**，避免同一功能多处出现。

**允许保留的硬编码（不要"顺手优化"掉）**：

| 位置 | 保留原因 |
|------|---------|
| `WindowHeader` 关闭按钮 `#e81123` / `#c50f1f` | Windows 标题栏惯例色，跟随主题反而违和 |
| `MemoPreview` 代码块 `pre` 深色底 | 明暗主题统一用深色，代码可读性优先 |
| `DailyPage` `.block-name` 白字、`.activity-color` / `.color-option` | 压在**用户自定义**的活动配色上，与主题无关 |
| `shared/services/daily.ts` 的 `ACTIVITY_COLORS` | 供用户挑选的调色板，属业务数据 |
| `shared/styles/variables.scss` 的 `$primary-color` 等 | 已废弃，仅供历史样式引用；新样式一律用 `--app-*` |

### 6.1.2 UI 组件库优先规范

**原则：组件库（Ant Design）已提供能力的控件，一律用组件库组件，禁止用原生控件替代。**

原生控件在暗色主题下不会跟随 antd 的 `darkAlgorithm`（会变成浅色斑块），且缺少
键盘可达性、弹层定位与空态处理。新写代码按下表选型：

| 场景 | 必须使用 | 禁止 |
|------|---------|------|
| 下拉选择（单选 / 多选 / 带禁用项） | `Select` | 原生 `<select>` + `<option>` |
| 日期 / 时间选择 | `DatePicker` / `TimePicker` | 原生 `<input type="date">` |
| 弹窗 / 抽屉 / 确认框 | `Modal` / `Drawer` / `Popconfirm` | 手写 `position: fixed` 遮罩 |
| 浮层提示 / 长按说明 | `Tooltip` / `Popover` | 手写 `title` 属性外的自建浮层 |
| 开关 / 复选 / 单选组 | `Switch` / `Checkbox` / `Radio.Group` | 原生 `<input type="checkbox">` |
| 分段切换 / 标签页 | `Segmented` / `Tabs` | 手写按钮组再自行维护选中态 |

**例外（保留原生控件不算违规）**：

| 场景 | 保留原因 |
|------|---------|
| 码字区 / 编辑器（CodeMirror） | 深度定制的光标、输入法与滚动行为，组件库无法承载 |
| 面板内的即时输入（检索框、速记框、一行重命名） | 需要零弹层、零延迟的受控输入，且样式已走 `var(--app-*)` |
| 行内自增高度的输入（`textarea` 自适应） | antd `Input.TextArea` 的 autoSize 与面板密度不符 |

**接入要求**：

1. 组件库组件的默认外观必须覆盖为面板密度与主题变量（`height` / `border-radius` /
   `background: var(--app-input-bg)` / `color: var(--app-text)`），**禁止**直接套用默认尺寸。
2. 弹层类组件（`Select` / `Tooltip` / `Popover` / `DatePicker`）的下拉挂在 `body`
   的 portal 上，**样式必须写在组件根选择器之外**，并通过 `classNames={{ popup: { root: "..." } }}` 挂类命中，
   否则换肤后弹层掉色。（`popupClassName` 在 antd 6.6+ 已废弃，统一改用 `classNames.popup.root`）
3. **antd 6 的 Select 边框/背景画在根元素 `.ant-select` 上**（v5 的 `.ant-select-selector`
   已移除，`.ant-select-content` 只是根内无边框的内容子元素）。覆盖外观必须改根元素的
   `--ant-select-*` CSS 变量（`border-color` / `background-color` / `border-radius` /
   `padding-horizontal` / `font-size` / `color`，antd 自身的 hover/focus/disabled 联动即基于这些变量），
   **禁止**再给内层 `.ant-select-content` 加 `border`——根内加边框会出现双边框。
4. 组件库组件仍须遵守 6.1.1：**不得硬编码色值**，覆盖样式一律用 `var(--app-*)`。

```tsx
// ❌ 错误：原生 select，暗色主题下白底黑字
<select value={kind} onChange={(e) => setKind(e.target.value)}>
  <option value="person">人名</option>
</select>

// ✅ 正确：组件库 Select + popupClassName + 主题变量覆盖
<Select
  size="small"
  popupClassName="nv-name__dropdown"
  value={kind}
  options={kindOptions}
  onChange={setKind}
/>
```

### 6.2 状态管理规范

**逻辑抽取标准**：

- 组件中尽量只负责渲染、事件触发和 UI 状态显示。
- 不负责 UI 渲染的逻辑，包括数据处理、状态转换、异步请求、缓存交互、事件编排等，应尽量维护到 `hooks/`、`services/` 或 `store/` 中。
- 对于复杂状态流，优先使用 `hooks` 进行聚合；如果状态需要跨页面共享，再考虑 `Zustand`。
- 不要在组件中塞入大量副作用逻辑，避免把页面变成“巨型容器”导致难以维护。

```typescript
// ✅ 简单页面：内联管理
function UserPage() {
  const [email, setEmail] = useState('');
  const handleSubmit = async () => { ... };
  return <Form>...</Form>;
}

// ✅ 复杂页面：抽取 Hook
// hooks/useTodoPage.ts
export function useTodoPage() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const handleAdd = async () => { ... };
  const handleDelete = async (id: number) => { ... };
  const todoItems = useMemo(() => items.filter(i => !i.done), [items]);
  return { items, todoItems, handleAdd, handleDelete };
}

// TodoPage.tsx
function TodoPage() {
  const { items, todoItems, handleAdd, handleDelete } = useTodoPage();
  return <div>...</div>;
}
```

**跨组件共享状态优先用 Zustand（见 6.2.1 全局状态库优先级）**。出现下列任一信号时，
不要再靠提升 props 解决，直接建模块级 `store/useXxxStore.ts`：

1. 子组件状态挂在 `useEffect` 上，而依赖数组里含父层传入的**回调**（回调身份随数据变化 →
   effect 反复重跑 → 加载态闪现 / 请求重复发出）；
2. 父层任何一次重渲染都会清空子组件本应保留的结果（如跳章保存触发数据更新）；
3. 面板按条件渲染卸载后，切回来希望保留上次的输入与结果（组件卸载会丢状态）。

store 只存状态与调度动作，通过模块级「runner 注册」拿到数据层函数
（不在 store 里 import hooks / service），组件挂载时注册、卸载时注销，
**注册动作不得触发任何请求**。

已落地 store（模块级单例，跨路由保活，均遵循 runner 注册范式）：

| 页面 | store 文件 | 职责 | 来源 |
|------|-----------|------|------|
| NovelPage | `store/useSearchStore.ts` | 全书检索 keyword/scope/hits/loading/recent + 防抖调度 | 1.15.0 |
| NovelPage | `store/useHoverStore.ts` | 术语悬停 target，仅 `HoverEntityCard` 订阅 | P0-2 |
| NovelPage | `store/useAppearanceStore.ts` | 要素出场章数索引，按章内容级增量缓存 | P0-3 |
| NovelPage | `store/useNovelEditorStore.ts` | 编辑器草稿与打字统计，仅 `EditorPane`/`StatusBar`/`NovelTopBar` 订阅 | P0-1 |
| MemoPage | `store/useMemoStore.ts` | 备忘 content/selected/编辑态（files 仍在 `useMemoData`） | P1-1 |
| MemoPage | `store/useMemoSearchStore.ts` | 备忘搜索 keyword/index + 高亮派生防抖 | P1-1 |
| LedgerPage | `store/useLedgerViewStore.ts` | 记账周期/区间/关键词/类型/分类/饼图口径 | P1-2 |

> CodePage 的邮箱查询未单独建 store，而是把 `useCodePage` 改为显式「查询」动作调度：输入框只持有草稿，月度统计与列表查询统一收敛到 `loadData` 入口（P1-3），同样切断了「输入 → effect → fetch」链。
> 选用信号见上方三条；命中任一即建模块级 `store/useXxxStore.ts`，不在 store 内 import hooks/service。

### 6.2.1 页面状态与组件职责规范

所有复杂页面（如 Todo、Memo、Daily、Code）统一采用“页面组合 + 分层 Hook + 私有组件”的结构。页面组件只负责编排，不直接承载数据访问、复杂筛选、表单编排或列表项业务逻辑。

#### Hook 分层

- `hooks/useXxxData.ts`：负责当前页面的数据加载、数据访问接口调用、CRUD、数据转换和领域派生数据；不负责弹窗、输入框、筛选或布局状态。
- `hooks/useXxxEditorState.ts`：负责当前页面的输入草稿、编辑对象、表单状态、临时选择和弹窗开关；通过参数接收数据层动作，不直接访问 IPC 或 HTTP。
- `hooks/useXxxViewState.ts`：负责搜索筛选、排序视图、分区折叠、选中项、滚动定位、加载动画和其他页面展示状态。
- `hooks/useXxxPage.ts`：复杂页面只允许作为组合层，将数据、编辑和视图 Hook 组合给页面；不得重新聚合所有状态和业务逻辑。简单页面可以不创建该组合层。
- Hook 应按职责拆分，而不是按页面大小堆叠。一个 Hook 同时包含数据请求、表单草稿和布局状态时，必须继续拆分。

#### 页面与组件职责

- `XxxPage.tsx`：组合 Hook 和页面组件，连接状态与回调；禁止实现列表项菜单、递归渲染、复杂表单流程或具体弹窗细节。
- `components/XxxListItem/`：负责单个列表项的展示和行级交互；递归子项应由该组件或专用树节点组件负责，不应回流到页面组件。
- `components/XxxToolbar/`：负责页面工具栏、创建入口、搜索和视图控制；输入法守卫等输入框专属逻辑必须在实际持有输入框的组件内部调用。
- `components/XxxSection/`：负责分区标题、空状态和列表容器；列表项通过明确的最小 props 或渲染器注入。
- `components/XxxSidebar/`：负责侧栏展示和选择回调，不负责主内容区的数据请求或滚动实现。
- 独立弹窗组件只负责自身 UI 和表单交互。多个弹窗如果只是页面中的直接使用点，不得新增只做 props 转发的 `XxxModals` 包装组件，应直接在对应页面或使用组件中罗列。
- 页面私有组件必须放在所属页面的 `components/` 下，禁止跨页面互相导入；跨页面复用的组件才允许提升到 `shared/components/`。

#### 状态归属原则

- 数据状态归 `useXxxData`，编辑草稿和表单状态归 `useXxxEditorState`，筛选/折叠/滚动/动画状态归 `useXxxViewState`。
- Hook 暴露的状态应尽量在直接使用它的组件中消费，避免页面父组件先定义或集中读取状态，再通过多层 props 透传给实际使用组件。
- 父组件仅保留真正需要跨组件共享、参与页面级编排或决定布局的状态；局部交互状态应下沉到直接使用它的组件或对应 Hook。
- 组件需要多个状态 Hook 时，优先在该组件内部组合这些 Hook；只有状态需要被兄弟组件共享时，才提升到最近的共同父组件，并通过最小化 props 传递。
- 子组件通过明确的最小 props 接收状态和动作，禁止直接读取其他页面组件的状态或调用 `window.electronAPI`、文件系统和外部 HTTP 接口。
- 组件内部只保留自身交互所需的短生命周期状态；跨组件共享状态必须提升到对应 Hook 或模块级 store。
- 组件需要的展示规则、长度限制和领域常量应放在所属页面的配置或工具文件中，不得散落在多个 JSX 分支中。
- 长文本展示统一使用配置化字符限制；截断文本需要通过 Tooltip 或等价交互展示原文，编辑态必须使用完整原文。
- 输入法守卫属于输入组件的局部交互逻辑，应由实际持有输入框的组件调用，不通过父页面层层传递。

#### TodoPage 落地示例

- Todo 数据、编辑状态和视图状态分别由 `useTodoData`、`useTodoEditorState`、`useTodoViewState` 管理。
- `TodoListItem` 负责 Todo 行项目、右键菜单和子任务递归；`TodoToolbar` 负责新增/搜索；`TodoSection` 负责待办和已完成分区。
- 标题和备注的展示长度由 `TodoPage/todo-config.ts` 配置，使用字符级截断并通过 Tooltip 展示原文。

### 6.3 IPC 通信规范

**新增 IPC 通道流程**：

1. **主进程** (`electron/main.ts`)：注册 `ipcMain.handle()`
2. **预加载** (`electron/preload.ts`)：暴露到 `window.electronAPI`
3. **类型声明** (`src/shared/types/electron.d.ts`)：更新接口定义

**命名规范**：`模块-操作`

```typescript
// main.ts
ipcMain.handle('todo-add', async (event, content: string) => { ... });
ipcMain.handle('todo-list', async () => { ... });
ipcMain.handle('memo-read', async (event, filename: string) => { ... });
```

### 6.4 布局动画规范

**平滑过渡：CSS transition 优于条件渲染**

```tsx
// ❌ 错误：条件渲染破坏动画
{!collapsed && <Sidebar />}

// ✅ 正确：始终渲染，CSS 控制
<div className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
  <Sidebar />
</div>
```

```scss
.sidebar {
  width: 260px;
  opacity: 1;
  transition: width 0.3s ease, opacity 0.25s ease;

  &--collapsed {
    width: 0;
    opacity: 0;
  }
}
```

### 6.6 单元测试规范

**核心原则：修改任何功能前后必须运行该功能的单元测试，防止修复引入回归。**

技术栈：`vitest` + `@testing-library/react` + `jsdom`（配置见 `vitest.config.ts`，测试环境初始化见 `vitest.setup.ts`）。

**强制要求**：

1. **修改前先跑基线**：修复 bug 或重构前，先运行对应模块的单测确认当前为绿色基线；若没有测试，先为该行为补充测试再动手修改（红 → 绿流程）。
2. **修改后必须重跑**：每次修改完成后，运行被改模块的单测验证行为未回归，再提交。全量回归在交付前执行 `pnpm test`。
3. **测试文件就近存放**：与被测代码同目录，统一命名 `*.test.ts` / `*.test.tsx`（如 `todo-utils.test.ts` 与 `todo-utils.ts` 同级）。禁止集中放到独立的 `tests/` 目录。
4. **纯函数必须有单测**：页面内的 `xxx-utils.ts`、`shared/services/` 中的工具函数（时间换算、解析、格式化、转义等）是单测的最低覆盖对象；新增或修改这些函数时必须同步新增/更新测试。
5. **可测性优先**：新增逻辑优先设计为不依赖 `window.electronAPI` / DOM 的纯函数（参数进、结果出），IPC 与文件访问留在 hooks/handlers 层，便于测试。
6. **测试只断言行为**：断言函数的输入输出与副作用语义，不断言实现细节（如内部调用了哪个私有函数），避免重构时大面积误伤。

**常用命令**：

```bash
pnpm test        # 全量运行一次（CI / 交付前）
pnpm test:watch  # watch 模式，开发时增量运行
```

### 6.5 数据库迁移规范

**表结构变更必须使用增量迁移**：

```typescript
// electron/db.ts
function initializeDataDb(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL,
      done INTEGER DEFAULT 0
    )
  `);

  // 增量迁移：添加 work_hour 列
  const columns = db.prepare("PRAGMA table_info(todos)").all() as Array<{ name: string }>;
  if (!columns.some((col) => col.name === 'work_hour')) {
    db.exec('ALTER TABLE todos ADD COLUMN work_hour REAL');
  }
}
```

---

## 7. 技术债务与改进方向

> 以下为当前仍存在的债务。已解决项（SQL 注入语义化改造、CodePage/DailyPage 抽取 Hook、路由懒加载、`exhaustive-deps` 重新开启、strict 模式、单元测试框架落地）不再列出，历史见 CHANGELOG。

### 7.1 高优先级

| 问题 | 影响 | 改进方案 |
|------|------|---------|
| **硬编码 Token** | `services/code.ts` 的认证 Cookie 为硬编码，过期需改代码（现由 `ensureSessionCookie` 播种到 session jar 生效） | 改为登录时动态获取，存储在 keytar 或加密配置 |

### 7.2 中优先级

| 问题 | 影响 | 改进方案 |
|------|------|---------|
| **类型分散** | 接口定义散落在各文件 | 统一收敛到 `src/shared/types/` 管理 |

### 7.3 低优先级

| 问题 | 影响 | 改进方案 |
|------|------|---------|
| **SCSS 变量不足** | 大量颜色硬编码 | 扩展 `variables.scss`，与 Antd theme token 对齐 |
| **Hook/组件级测试待补充** | 目前单测覆盖工具函数与服务层，hooks 与组件交互尚无测试 | 用 `@testing-library/react` 为关键 hook 补充渲染测试 |

---

## 8. 新增功能检查清单

### 8.1 新增独立窗口

- [ ] 在 `src/windows/` 创建 `XxxWindow/` 目录（`index.html` + `main.tsx` + `App.tsx`）
- [ ] 在 `vite.config.ts` 的 `rollupOptions.input` 登记入口 HTML
- [ ] 在 `electron/main.ts` 的 `RENDERER_ENTRIES` 登记窗口加载路径
- [ ] 入口引入 `@/shared/styles/themes.scss` + `createRoot` 前调用 `initThemeFromStorage()`
- [ ] 用 `ThemeProvider` 包裹 App（内部已含 ConfigProvider，不要再包 `ConfigProvider`）
- [ ] 窗口私有页面/组件放在窗口目录内，禁止其他窗口导入
- [ ] 样式一律使用 `var(--app-*)` 主题变量，禁止硬编码色值（见 6.1.1）

### 8.2 新增页面（BaseWindow）

- [ ] 在 `src/windows/BaseWindow/pages/` 创建目录（如 `NewPage/`）
- [ ] 创建 `NewPage.tsx`（主组件）
- [ ] 创建 `index.scss`（页面样式）
- [ ] 在 `BaseWindow/App.tsx` 添加路由
- [ ] 在 `HomePage/index.tsx` 添加导航卡片
- [ ] 如果逻辑复杂（>100行），抽取 `hooks/useNewPage.ts`

### 8.3 新增子组件

- [ ] 在 `windows/BaseWindow/pages/XxxPage/components/` 创建 `SubComponent/index.tsx`
- [ ] 创建 `SubComponent/index.scss`（样式就近，入口文件引入）
- [ ] 在 `SubComponent/index.tsx` 中 `import './index.scss'`
- [ ] 从父组件 `index.scss` 中移除该组件的样式

### 8.4 新增数据表

- [ ] 在 `electron/db.ts` 的 `initializeDataDb()` 中创建表
- [ ] 编写增量迁移逻辑（检查列是否存在）
- [ ] 在 `shared/services/` 或页面 `services/` 中封装 IPC 调用（渲染层不内联 SQL）
- [ ] 定义 TypeScript 接口（如 `XxxItem`）

### 8.5 新增 IPC 通道

- [ ] 在 `electron/handlers/` 新建 `xxx-handlers.ts`，导出 `registerXxxHandlers()`，在其中注册 `ipcMain.handle(...)`；**禁止在 `main.ts` 内联业务 IPC**
- [ ] 在 `electron/main.ts` 的 `app.whenReady` 中调用 `registerXxxHandlers()` 完成注册
- [ ] 在 `electron/preload.ts` 暴露到 `window.electronAPI`
- [ ] 在 `src/shared/types/electron.d.ts` 更新 `ElectronAPI` 接口
- [ ] 在 Service 层封装调用（如 `shared/services/xxx.ts` 或页面 `services/`）
- [ ] 若 handler 引入新的主进程 Node 依赖，须将其加入 `vite.config.ts` 的 electron `external`（当前：`electron` / `better-sqlite3` / `mammoth` / `docx`），否则 rolldown 会尝试打包其传递依赖而失败

### 8.6 更新日志规范

- **必须维护**：每次功能上线、修复、兼容调整或配置改动，必须同步更新 `CHANGELOG.md`。
- **版本格式**：使用语义化版本，格式为 `[X.Y.Z]`，并写明发布日期，如 `## [1.0.2] - 2026-09-15`。
- **版本递增策略**：有架构调整、新增页面/模块/数据层时升次版本号（`X.Y.Z → X.Y+1.0`）；
  **无架构改动的小功能与修复只升修订号**（`X.Y.Z → X.Y.Z+1`），`CHANGELOG.md` 与
  `package.json` 的 `version` 必须同步修改。
- **章节规范**：优先使用 `Added` / `Changed` / `Fixed` / `Removed` / `Security` 等标准小节；项目主语言为中文时，也可写成对应中文标题。
- **内容要求**：每条记录必须简洁、可追溯，说明“修复了什么”“新增了什么”“影响范围”，禁止空泛描述，如“优化”“调整”而不写具体内容。
- **发布同步**：功能上线前后，确保 `CHANGELOG.md` 与 `package.json` 的版本信息保持一致，避免版本号与修订记录不一致。
- **审查门槛**：代码提交前，检查是否已补充更新日志；如未更新，视为未完成交付的一部分。

```md
# Changelog

## [1.0.2] - 2026-09-15

### Fixed
- 修复 Todo 子任务输入法输入被提前提交的问题。
- 修复中文拼音输入在 Enter / Blur 时被打断的问题。
```

---

### 8.7 新机器环境搭建与依赖管理

- **包管理器**：项目基于 pnpm（lockfile `9.0`），本机基准 pnpm 9.x；pnpm ≥10 默认
  **拦截所有依赖的构建脚本**，必须在 `package.json` 的 `pnpm.onlyBuiltDependencies`
  中显式放行（当前：`electron` / `better-sqlite3` / `esbuild`）——新增带 postinstall
  的依赖时同步补这里，否则 electron 二进制等永远装不上。
- **pnpm ≥10.26 / 11 的字段迁移（已踩坑）**：pnpm 11 **不再读取** `package.json` 的
  `pnpm` 字段（安装时会警告 `pnpm.onlyBuiltDependencies ignored`），且
  `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 也被移除，统一改为 `allowBuilds`
  映射。因此 `pnpm-workspace.yaml` 中必须**同时维护两套白名单**：`onlyBuiltDependencies`
  供 pnpm 9/10 使用，`allowBuilds` 供 pnpm ≥10.26/11 使用，两边都要包含
  `electron` / `better-sqlite3` / `esbuild`。
  > **更正（2026-09-19）**：上面「`allowBuilds` 漏掉 electron → postinstall 被拦 →
  > `dist/electron.exe` 永远缺失」的归因对 **Electron 42 已不成立**——该版本根本
  > 没有 postinstall 脚本，白名单加不加都不影响它。真正的卡点是无镜像 + 无超时的
  > 懒加载下载，详见本节开头的「`pnpm dev` 卡住不动的真正原因」。白名单仍需维护，
  > 但它保护的是 `better-sqlite3` / `esbuild` 这类**真的有构建脚本**的包。
- **镜像配置**：`.npmrc` 已随仓库提交（registry / `electron_mirror` /
  `electron_builder_binaries_mirror` 均指向 npmmirror），新机器 clone 后无需重复配置；
  若仍从 GitHub 下载超时，可临时导出环境变量 `ELECTRON_MIRROR` 强制覆盖。
- **标准安装流程**：
  1. `pnpm install`（确认安装日志中 electron 无 "Ignored build scripts" 警告）
  2. `pnpm electron:rebuild`（better-sqlite3 重编译到 Electron ABI，或直接
     `pnpm electron:setup` 一步到位）
  3. `pnpm dev`
- **`pnpm dev` 卡住不动的真正原因（2026-09-19 定位并根治，务必先读这条）**：
  Electron ≥41（本项目 **42.4.1**）的 `package.json` **已经没有 postinstall 脚本**
  （实测 `pkg.scripts === undefined`，只剩 `bin.electron` / `bin.install-electron`）。
  二进制的安装被推迟到了**首次 `require('electron')`**：
  ```js
  // node_modules/electron/index.js
  没有 path.txt → 在 require 的同步调用栈里 spawnSync(node, install.js)
                → @electron/get 下载 ~140MB → 默认直连 github.com，**无超时、无进度**
  ```
  于是：`node_modules` 重装 / `dist` 丢失 → `pnpm dev` → `require('electron')`
  → **静默同步下载 → 终端毫无动静，看起来就是"卡死"**；用户 Ctrl+C 重来，
  下次又从零开始堵，循环往复。
  - **补充坑**：`.npmrc` 的 `electron_mirror` **只有在包管理器执行安装脚本时**
    才会被转成环境变量 `ELECTRON_MIRROR`。手动跑 `install.js`、或被
    `index.js` 内部 spawn 时一个环境变量都没有 → 直连 github 卡死。
    实测对比：不带镜像 >300s 无响应；带上 `ELECTRON_MIRROR` 后**命中本地缓存 2.1s 完成**。
  - **根治手段（已落地，勿删）**：`scripts/ensure-electron.mjs` 会自己读
    `.npmrc` 的 `electron_mirror` 并**显式注入 `ELECTRON_MIRROR`**，再加超时上限后
    补装二进制。它挂在 `dev`/`dev:debug`/`dev:debug:log`/`electron:dev`/`postinstall`
    最前面（已装好时毫秒级返回，不影响启动手感）；`scripts/start-electron.js`
    另有 fail-fast 守卫，二进制缺失时**拒绝掉进无超时下载**，直接给修复指引。
- **不要在 `ELECTRON_RUN_AS_NODE=1` 的环境里跑 dev（2026-09-19 新增）**：该变量会让
  `electron.exe` 退化成普通 Node，`require('electron')` 返回的是**可执行文件路径字符串**
  而不是 API，主进程直接崩在 `Cannot read properties of undefined (reading 'app')`。
  VS Code / WorkBuddy 等 Electron 宿主有时会把它泄漏到集成终端。`scripts/start-electron.js`
  已显式剔除 `ELECTRON_RUN_AS_NODE` / `ELECTRON_NO_ATTACH_CONSOLE`，
  **不要把这层清理删掉**。
- **相关命令**：`pnpm ensure:electron`（手动补装/修复）、`pnpm dev:doctor`（完整体检）。
- **二进制「看着齐全」但 Electron 仍在几十毫秒内 `exit(1)` 且零输出（2026-09-19 定位）**：
  这是**解压不完整**，`dist/electron.exe` 和 `path.txt` 都可能存在**却依然炸**。
  Electron 官方 win32 zip 有 **75 个条目**（20 个根文件 + `locales/` 55 个 pak +
  `resources/default_app.asar`）；解压被中断时常常只剩 19 个根文件：
  ```
  缺失 dist/locales/*.pak              ← ICU 语言包，缺它 Chromium 浏览器进程秒退且零输出
  缺失 dist/resources/default_app.asar
  ```
  **为什么不自愈**：`install.js` 开头就是 `if (isInstalled()) process.exit(0)`，
  而此时 `path.txt` 往往已写好 → 它认定「已安装」直接返回，往后 `pnpm install`
  永远输出 Already up to date，环境永久半残。
  **怎么诊断**：`pnpm dev:doctor` 第 1 步已加入 `dist/locales` 与
  `dist/resources/default_app.asar` 两项校验。
  **怎么修**：`scripts/ensure-electron.mjs` 会识别「仅 locales/default_app.asar 残缺」
  这一形态，**自动清空 dist 重新解压**（命中本地缓存约 2 秒），无需手工介入。
  诱因提示：`pnpm install` / `ensure:electron` **执行到一半不要中断**——Ctrl+C、
  工具超时、宿主杀进程都会留下半份 dist。
- **已改用扁平化布局 `node-linker=hoisted`（根治方案，勿回退）**：
  `pnpm-workspace.yaml` 中设置了 `node-linker: hoisted`，`node_modules` 是**扁平结构**，
  不存在 `.pnpm` 虚拟存储与任何 junction / symlink。
  - **为什么改**：本机 Windows 上 pnpm 默认的 symlinked 布局会**稳定复现**「包目录被
    创建但内容为空」的问题——甚至**全新安装**一次就会出现约 200 个空目录（`.pnpm`
    内成片 entries=0），进而随机报 `Cannot find module 'debug'` / react-router
    类型缺失等错误。已排除的常见嫌疑：磁盘空间（剩余 1TB+）、Windows 长路径
    （实测可创建 429 字符路径）、pnpm store 完整性（38377 文件、0 空目录）。
    手写脚本补链接也不可靠：按字典序挑版本会把顶层 `typescript` 指向 5.4.3
    （项目要 6.0.3）；补传递依赖会把 `brace-expansion` 指到不兼容版本，直接让
    eslint 崩在 `brace_expansion_1.expand is not a function`。
  - **代价**：允许幽灵依赖（未声明的包也能 import）。对 Electron 应用可接受，
    但**新增依赖务必写进 `package.json`**，不要依赖 hoisting 碰巧可用。
  - **判断当前布局**：`node_modules/.pnpm` 存在 = symlinked；不存在 = hoisted。
- **pnpm 链接半损坏 / `.ignored` 搬迁中断（symlinked 布局下的历史坑，保留备查）**：
  - **症状**：明明 `pnpm install` 显示 `Already up to date`，却报
    `Cannot find module 'electron'` / `'vitest'` / `'eslint'`；或 `node_modules`
    下某个顶层包变成**空目录**，并出现 `node_modules/.ignored/` 目录。
  - **成因**：pnpm 判定某个条目「由其他包管理器安装」时，会把它重命名为
    `.ignored_<原名>`（包内）或搬到 `node_modules/.ignored/<pkg>`（顶层），
    准备删除。Windows 上这一步中断就会**只留下空壳、原内容消失**。
    而 `node_modules/.modules.yaml` 仍记录着这些包「已安装」，于是后续
    `pnpm install`（**包括 `--force`**）一律判定 up to date，永不自愈——
    实测删除 `.modules.yaml` 也无效，pnpm 不会重建链接。
  - **诱因**：跨 pnpm 大版本复用同一个 `node_modules`（pnpm 9 → 10 → 11 的
    `layoutVersion` 不同），或在 `pnpm add` 过程中被打断 / 并发执行。
  - **处置**（按严重程度递进；当前 hoisted 布局下不会出现，仅切回 symlinked 时适用）：
    1. `pnpm check:deps` —— 只体检，有问题退出码 1（适合 CI）。
       在 hoisted 布局下脚本走快速通道：只校验关键包与 electron 二进制，**不做任何改写**
    2. `pnpm fix:deps` —— 应急修复：重建断裂的顶层链接、清理 `.ignored`
       空壳、纠正顶层误指向 peer 变体的链接（electron 的 `dist/` 二进制
       只存在于主变体 `electron@<ver>`，指到 `electron@<ver>_<peer>` 会
       出现「能 import 但没有二进制」的假象）
    3. 若仍报「找不到可用实体」——说明已处于半损坏状态，补丁不可靠，
       彻底重建：删除 `node_modules` → `pnpm install` → `pnpm electron:rebuild`
  - **预防**：
    - `package.json` 已锁定 `"packageManager": "pnpm@11.25.0"`；**升级 pnpm
      大版本后必须删除 `node_modules` 重装**，不要复用旧目录
    - `pnpm add` 不要并发执行、不要中途打断
    - `postinstall` 已挂 `scripts/fix-pnpm-links.mjs --warn-only`，每次安装后
      自动体检（只告警、不阻断安装，避免误报卡住 CI）
- **HTTP 请求架构契约（1.5.0 重构，必读）**：**网络请求一律在渲染进程发起，
  主进程不再代理任何 HTTP**。所有窗口统一使用 `src/shared/http/` 的客户端
  （内部 `fetch` 封装：超时 / 重试 / 中断 / 错误归一 / 响应剥壳）：
  - 按业务划分作用域取实例：`getScopedHttpClient("news" | "git", config)`，
    每个渲染进程（= 每个窗口）持有独立实例，请求彼此隔离，
    页面卸载时用 `useHttpClient()` 或 `abortScope()` 中断在途请求；
  - 主进程只做**一次性**会话配置（见 `electron/httpSession.ts`）：
    ① `onHeadersReceived` 注入 CORS 响应头；② `http-session-set-cookie`
    把凭据写入 session jar。**不要**新增任何逐请求转发用的 IPC 通道；
  - `Cookie` 是 forbidden header，渲染进程无法手动设置：走
    `ensureSessionCookie()` + `credentials: "include"`，由网络栈自动携带；
  - 新增接口请直接复用 `createHttpClient` / `getScopedHttpClient`，
    禁止在业务里裸调 `fetch`，以免各窗口标准不一；
  - 编码问题已成为历史：响应由 Chromium 网络栈按 UTF-8 解码，
    不再有主进程 `Buffer.concat` 截段乱码（原 1.4.8 契约已随架构废弃）。

## 9. 附录

### 9.1 技术栈版本

| 技术 | 版本 |
|------|------|
| React | ^19.2.6 |
| TypeScript | ~6.0.2 |
| Vite | ^8.0.12 |
| Electron | ^42.4.1 |
| Ant Design | ^6.6.2 |
| better-sqlite3 | ^12.11.1 |
| react-virtuoso | ^4.18.13 |
| framer-motion | ^12.23.12 |

### 9.2 关键文件索引

| 文件 | 路径 | 作用 |
|------|------|------|
| 主进程入口 | `electron/main.ts` | 窗口管理、IPC 注册 |
| 数据库初始化 | `electron/db.ts` | 双库管理、表结构迁移 |
| API 暴露 | `electron/preload.ts` | contextBridge 白名单 |
| 路由配置 | `src/windows/BaseWindow/App.tsx` | HashRouter + Routes |
| 全局类型 | `src/shared/types/electron.d.ts` | window.electronAPI 接口 |
| 样式变量 | `src/shared/styles/variables.scss` | SCSS 变量与 mixins（**颜色变量已废弃**，仅供历史样式引用） |
| 主题变量 | `src/shared/styles/themes.scss` | 四套主题的 `--app-*` CSS 变量 |
| 主题模块 | `src/shared/theme/` | 主题清单、存储、Provider 与 `useTheme` |
| 主题切换器 | `src/shared/components/ThemeSwitcher/` | 切换 UI，切换后广播到所有窗口 |
| 窗口入口清单 | `electron/main.ts` 的 `RENDERER_ENTRIES` | 窗口 URL 映射，与 vite input 对应 |

---

**文档版本**: 2.2  
**最后更新**: 2026-09-22  
**维护者**: CheckIn 开发团队
