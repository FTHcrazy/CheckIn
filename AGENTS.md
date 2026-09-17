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
| **handlers/** | 语义化 IPC handler 按模块注册（`todo-handlers.ts`、`activity-handlers.ts`），持有预定义 SQL | 每个 handler 文件只负责一个业务模块；SQL 只出现在 handlers 与 db.ts，禁止出现在渲染进程 |
| **preload.ts** | 通过 `contextBridge` 暴露安全的 API 给渲染进程 | 仅做 API 转发，不实现业务逻辑 |
| **db.ts** | SQLite 数据库初始化、双库管理（authDb/userDb）、通用 CRUD 封装 | 提供底层数据库操作，不感知上层业务 |
| **activitiesTask.ts** | 后台活动提醒轮询、系统事件监听（睡眠/锁屏） | 独立后台任务，通过 IPC 通知渲染进程 |
| **windowManager.ts** | 窗口管理池：注册/注销/广播/定点发送 | 只管理 BrowserWindow 实例，不感知业务 |

**模块边界规则**：
- `db.ts` 不导入 `main.ts` 的任何内容
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
| **WorkerWindow** | `windows/WorkerWindow/` | `src/windows/WorkerWindow/index.html` | 临时工作窗口：即关即销，重新打开即全新实例 |

**窗口边界规则**：
- 窗口之间**禁止互相导入**（如 `LoginWindow` 不得导入 `BaseWindow/pages` 的任何内容）
- 新增窗口时：在 `src/windows/` 建目录 → `vite.config.ts` 的 `rollupOptions.input` 登记 HTML → `electron/main.ts` 的 `RENDERER_ENTRIES` 登记加载路径
- 仅需某窗口处理的 IPC 推送，封装在 `shared/ipc/` 的显式注册函数中，由该窗口入口调用一次（如 `registerActivityNotifyBridge()`），避免模块加载副作用扩散

#### 2.2.1 共享层 (`shared/`)

`src/shared/` 存放**跨窗口/跨页面复用**的代码，窗口私有代码禁止放入：

| 模块 | 路径 | 职责 |
|------|------|------|
| **components** | `shared/components/` | 跨窗口共享 UI：Page（页面容器）、NavHeader（导航栏） |
| **services** | `shared/services/` | 数据访问：daily.ts、code.ts |
| **ipc** | `shared/ipc/` | 窗口级 IPC 桥接注册（显式调用，带防重复守卫） |
| **types** | `shared/types/` | 全局类型：electron.d.ts（window.electronAPI） |
| **styles** | `shared/styles/` | variables.scss（SCSS 变量）、antd-theme.ts（统一 ConfigProvider theme/locale） |

**边界规则**：
- 只有两个以上窗口/页面需要时才允许放入 `shared/`；只有一个使用方的代码留在使用方目录内
- 各窗口的 ConfigProvider 统一从 `shared/styles/antd-theme.ts` 引入 `antdProviderProps`，禁止各窗口重复定义 theme

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
│  ├─ ConfigProvider (Antd，theme 来自 shared/styles/antd-theme)
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
├─ main.tsx (入口)
└─ App.tsx (临时工作窗口，Esc 快捷关闭)
```

**依赖规则**：
- **单向依赖**：Pages → Services → IPC → Main，禁止反向调用
- **窗口隔离**：`LoginWindow` 与 `BaseWindow` 之间禁止互相导入，共享代码只能经由 `shared/`
- **平级禁止**：`TodoPage` 不导入 `MemoPage` 的任何内容
- **私有保护**：`pages/TodoPage/components/NoteModal` 仅被 `TodoPage` 使用

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
main.ts
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
│   │   ├── todo-handlers.ts               # Todo CRUD + 父子级联
│   │   └── activity-handlers.ts           # 日程活动 CRUD
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
│   │   │       │   ├── todo-db.ts
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
│   │   └── WorkerWindow/                  # 临时工作窗口（即关即销）
│   │       ├── index.html
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       └── index.scss
│   └── shared/                            # 跨窗口共享层
│       ├── components/                    # 共享 UI（Page、NavHeader…）
│       ├── services/                      # 数据服务（daily.ts、code.ts）
│       ├── ipc/                           # 窗口级 IPC 桥接（activityNotifyBridge.ts）
│       ├── types/                         # 全局类型（electron.d.ts）
│       └── styles/                        # variables.scss、antd-theme.ts
├── vite.config.ts                         # rollupOptions.input 与 windows/* 一一对应
├── tsconfig.json
└── package.json
```

### 5.2 页面模块内部结构规范

复杂页面（逻辑 >100 行）必须遵循以下结构：

```text
windows/BaseWindow/pages/XxxPage/
├── XxxPage.tsx           # 主组件（UI 渲染）
├── index.scss            # 页面级布局样式
├── xxx-db.ts             # (可选) 页面专属数据库操作
├── xxx-utils.ts          # (可选) 纯函数工具
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
| **硬编码 Token** | `services/code.ts` 的认证 Cookie 为硬编码，过期需改代码（现已改走主进程 `httpRequest` 使 Cookie 生效） | 改为登录时动态获取，存储在 keytar 或加密配置 |

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
- [ ] ConfigProvider 使用 `shared/styles/antd-theme.ts` 的统一配置
- [ ] 窗口私有页面/组件放在窗口目录内，禁止其他窗口导入

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
- [ ] 在 `shared/services/` 或 `xxx-db.ts` 中封装 CRUD 函数
- [ ] 定义 TypeScript 接口（如 `XxxItem`）

### 8.5 新增 IPC 通道

- [ ] 在 `electron/main.ts` 注册 `ipcMain.handle('模块-操作', ...)`
- [ ] 在 `electron/preload.ts` 暴露到 `window.electronAPI`
- [ ] 在 `src/shared/types/electron.d.ts` 更新 `ElectronAPI` 接口
- [ ] 在 Service 层封装调用（如 `shared/services/xxx.ts`）

### 8.6 更新日志规范

- **必须维护**：每次功能上线、修复、兼容调整或配置改动，必须同步更新 `CHANGELOG.md`。
- **版本格式**：使用语义化版本，格式为 `[X.Y.Z]`，并写明发布日期，如 `## [1.0.2] - 2026-09-15`。
- **章节规范**：优先使用 `Added` / `Changed` / `Fixed` / `Removed` / `Security` 等标准小节；项目主语言为中文时，也可写成对应中文标题。
- **内容要求**：每条记录必须简洁、可追溯，说明“修复了什么”“新增了什么”“影响范围”，禁止空泛描述，如“优化”“调整”而不写具体内容。
- **发布同步**：功能上线前后，确保 `CHANGELOG.md` 与 `VERSION.MD` 的版本信息保持一致，避免版本号与修订记录不一致。
- **审查门槛**：代码提交前，检查是否已补充更新日志；如未更新，视为未完成交付的一部分。

```md
# Changelog

## [1.0.2] - 2026-09-15

### Fixed
- 修复 Todo 子任务输入法输入被提前提交的问题。
- 修复中文拼音输入在 Enter / Blur 时被打断的问题。
```

---

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
| 样式变量 | `src/shared/styles/variables.scss` | SCSS 变量与 mixins |
| 窗口入口清单 | `electron/main.ts` 的 `RENDERER_ENTRIES` | 窗口 URL 映射，与 vite input 对应 |

---

**文档版本**: 2.1  
**最后更新**: 2026-09-17  
**维护者**: CheckIn 开发团队
