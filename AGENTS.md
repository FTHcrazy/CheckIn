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
│  Pages (UI Layer)                                           │
│  └─ TodoPage / MemoPage / DailyPage / CodePage / UserPage   │
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
│  IPC Handlers (electron/main.ts)                            │
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
3. **模块自治**：每个页面模块拥有独立的组件、样式、业务逻辑，避免跨页面耦合
4. **样式就近**：子组件样式与组件文件同级，严禁样式上移至父组件

---

## 2. 模块边界与职责

### 2.1 主进程模块 (`electron/`)

| 模块 | 职责 | 边界 |
|------|------|------|
| **main.ts** | 窗口生命周期管理、IPC 通道注册、托盘图标、应用启动流程 | 仅处理窗口和系统级操作，不包含业务逻辑 |
| **preload.ts** | 通过 `contextBridge` 暴露安全的 API 给渲染进程 | 仅做 API 转发，不实现业务逻辑 |
| **db.ts** | SQLite 数据库初始化、双库管理（authDb/userDb）、通用 CRUD 封装 | 提供底层数据库操作，不感知上层业务 |
| **activitiesTask.ts** | 后台活动提醒轮询、系统事件监听（睡眠/锁屏） | 独立后台任务，通过 IPC 通知渲染进程 |

**模块边界规则**：
- `db.ts` 不导入 `main.ts` 的任何内容
- `activitiesTask.ts` 通过 `ipcMain` 注册通道，不直接调用 `main.ts` 函数
- `preload.ts` 仅读取 `db.ts` 和 `main.ts` 暴露的 IPC 通道

### 2.2 渲染进程模块 (`src/`)

#### 2.2.1 全局层

| 模块 | 路径 | 职责 | 依赖 |
|------|------|------|------|
| **App** | `App.tsx` | 路由配置、全局 Provider（Antd ConfigProvider）、Home 页 | 依赖所有 Pages |
| **Page** | `components/Page/` | 页面容器（NavHeader + children） | 依赖 NavHeader |
| **NavHeader** | `components/NavHeader/` | 顶部导航栏（返回按钮） | 无依赖 |

#### 2.2.1.1 组件分层规范：全局组件 vs 当前模块组件

- **全局组件**：放置于 `src/components/`，用于跨页面复用的通用 UI，如 `Page`、`NavHeader`、通用 `EmptyState` 等。
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

#### 2.2.3 页面模块 (`pages/`)

| 页面 | 核心组件 | 业务逻辑 | 数据源 | 私有子组件 |
|------|---------|---------|--------|-----------|
| **TodoPage** | TodoPage.tsx | hooks/useTodoPage.ts | todo-db.ts (SQLite) | NoteModal, WorkHourModal, TodoOutlineSidebar |
| **MemoPage** | MemoPage.tsx | 内联 useState | 文件系统 (via IPC) | MemoEditor, MemoPreview, MemoSidebar, MemoHeader |
| **DailyPage** | DailyPage.tsx | 内联 useState | daily.ts (SQLite) | 无（待重构） |
| **CodePage** | CodePage.tsx | 内联 useState | code.ts (HTTP API) | 无（待重构） |
| **UserPage** | UserPage.tsx | 内联 Form | userDb (SQLite) | 无 |

**页面模块边界**：
- 页面之间**无直接依赖**，通过路由跳转
- 页面私有子组件**禁止**被其他页面导入
- 共享组件（Page, NavHeader）放在 `components/`，所有页面可用

---

## 3. 组件依赖关系图

```text
App.tsx
├─ ConfigProvider (Antd)
├─ ActivityNotifier (全局 IPC 监听)
└─ Routes
   ├─ Home (内联在 App.tsx)
   ├─ TodoPage
   │  ├─ Page (全局共享)
   │  ├─ TodoOutlineSidebar (私有)
   │  ├─ NoteModal (私有)
   │  └─ WorkHourModal (私有)
   ├─ MemoPage
   │  ├─ Page
   │  ├─ MemoSidebar (私有)
   │  ├─ MemoHeader (私有)
   │  ├─ MemoEditor (私有)
   │  └─ MemoPreview (私有)
   ├─ DailyPage
   │  └─ Page
   ├─ CodePage
   │  └─ Page
   └─ UserPage
      └─ Page
```

**依赖规则**：
- **单向依赖**：Pages → Services → IPC → Main，禁止反向调用
- **平级禁止**：`TodoPage` 不导入 `MemoPage` 的任何内容
- **私有保护**：`pages/TodoPage/components/NoteModal.tsx` 仅被 `TodoPage.tsx` 使用

---

## 4. 数据流向

### 4.1 用户操作流（以添加 Todo 为例）

```text
User Input
    ↓
TodoPage.tsx (UI)
    ↓ 调用 handleAdd()
useTodoPage.ts (Hook)
    ↓ 调用 addTodo()
todo-db.ts (Service)
    ↓ window.electronAPI.db.run('INSERT...')
preload.ts (Bridge)
    ↓ ipcRenderer.invoke('db-run', sql, params)
main.ts (IPC Handler)
    ↓ dbRun(sql, params)
db.ts (Database)
    ↓ userDb.prepare(sql).run(params)
SQLite
    ↓ 返回 { lastID }
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
├── electron/                    # 主进程代码
│   ├── main.ts                  # 入口 + IPC 注册
│   ├── preload.ts               # API 暴露
│   ├── db.ts                    # 数据库管理
│   └── activitiesTask.ts        # 后台任务
├── src/
│   ├── main.tsx                 # 渲染进程入口
│   ├── App.tsx                  # 路由 + 全局 Provider
│   ├── index.scss               # 全局样式重置
│   ├── styles/
│   │   ├── variables.scss       # SCSS 变量
│   │   └── App.scss             # Home 页样式
│   ├── types/
│   │   └── electron.d.ts        # window.electronAPI 类型
│   ├── components/              # 全局共享组件
│   │   ├── Page/
│   │   │   ├── index.tsx
│   │   │   └── index.scss
│   │   └── NavHeader/
│   │       ├── index.tsx
│   │       └── index.scss
│   ├── services/                # 数据服务层
│   │   ├── daily.ts
│   │   └── code.ts
│   ├── pages/                   # 页面模块
│   │   ├── TodoPage/
│   │   │   ├── TodoPage.tsx
│   │   │   ├── index.scss
│   │   │   ├── todo-db.ts
│   │   │   ├── todo-utils.ts
│   │   │   ├── hooks/
│   │   │   │   └── useTodoPage.ts
│   │   │   └── components/
│   │   │       ├── NoteModal/
│   │   │       │   ├── index.tsx
│   │   │       │   └── index.scss
│   │   │       ├── WorkHourModal/
│   │   │       │   ├── index.tsx
│   │   │       │   └── index.scss
│   │   │       └── TodoOutlineSidebar/
│   │   │           ├── index.tsx
│   │   │           └── index.scss
│   │   ├── MemoPage/
│   │   ├── DailyPage/
│   │   ├── CodePage/
│   │   └── UserPage/
│   └── windows/                 # 独立窗口
│       └── LoginWindow/
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### 5.2 页面模块内部结构规范

复杂页面（逻辑 >100 行）必须遵循以下结构：

```text
pages/XxxPage/
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
- 只有全局共享的 UI 才允许放在 `src/components/`，页面私有组件必须保持在对应页面的 `components/` 中。

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

### 6.3 IPC 通信规范

**新增 IPC 通道流程**：

1. **主进程** (`electron/main.ts`)：注册 `ipcMain.handle()`
2. **预加载** (`electron/preload.ts`)：暴露到 `window.electronAPI`
3. **类型声明** (`src/types/electron.d.ts`)：更新接口定义

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
  const columns = db.prepare("PRAGMA table_info(todos)").all();
  if (!columns.some((col: any) => col.name === 'work_hour')) {
    db.exec('ALTER TABLE todos ADD COLUMN work_hour REAL');
  }
}
```

---

## 7. 技术债务与改进方向

### 7.1 高优先级

| 问题 | 影响 | 改进方案 |
|------|------|---------|
| **SQL 注入风险** | 渲染进程可构造任意 SQL | 改为语义化 IPC（如 `todo-add`），主进程执行预定义 SQL |
| **硬编码 Token** | `services/code.ts` JWT Cookie 过期需改代码 | 改为登录时动态获取，存储在 keytar 或加密配置 |
| **页面逻辑耦合** | CodePage (740行)、DailyPage (322行) 逻辑与 UI 混合 | 参考 TodoPage 模式，抽取 Hook + Service + 子组件 |

### 7.2 中优先级

| 问题 | 影响 | 改进方案 |
|------|------|---------|
| **重复建表逻辑** | `todo-db.ts` 和 `db.ts` 都创建 todos 表 | 统一到 `db.ts` 的 `initializeDataDb()` |
| **无路由懒加载** | 首屏加载所有页面代码 | 使用 `React.lazy()` + `Suspense` |
| **类型分散** | 接口定义散落在各文件 | 建立 `src/types/` 统一管理 |

### 7.3 低优先级

| 问题 | 影响 | 改进方案 |
|------|------|---------|
| **SCSS 变量不足** | 大量颜色硬编码 | 扩展 `variables.scss`，与 Antd theme token 对齐 |
| **无测试覆盖** | 无法保证代码质量 | 为 `todo-utils.ts`、`daily.ts` 添加单元测试 |
| **ESLint 规则宽松** | `exhaustive-deps` 关闭，可能导致 stale closure | 重新开启并修复警告 |

---

## 8. 新增功能检查清单

### 8.1 新增页面

- [ ] 在 `src/pages/` 创建目录（如 `NewPage/`）
- [ ] 创建 `NewPage.tsx`（主组件）
- [ ] 创建 `index.scss`（页面样式）
- [ ] 在 `App.tsx` 添加路由
- [ ] 在 `App.tsx` Home 页添加导航卡片
- [ ] 如果逻辑复杂（>100行），抽取 `hooks/useNewPage.ts`

### 8.2 新增子组件

- [ ] 在 `pages/XxxPage/components/` 创建 `SubComponent.tsx`
- [ ] 创建同名的 `SubComponent.scss`（⚠️ 必须同级）
- [ ] 在 `SubComponent.tsx` 中 `import './SubComponent.scss'`
- [ ] 从父组件 `index.scss` 中移除该组件的样式

### 8.3 新增数据表

- [ ] 在 `electron/db.ts` 的 `initializeDataDb()` 中创建表
- [ ] 编写增量迁移逻辑（检查列是否存在）
- [ ] 在 `services/` 或 `xxx-db.ts` 中封装 CRUD 函数
- [ ] 定义 TypeScript 接口（如 `XxxItem`）

### 8.4 新增 IPC 通道

- [ ] 在 `electron/main.ts` 注册 `ipcMain.handle('模块-操作', ...)`
- [ ] 在 `electron/preload.ts` 暴露到 `window.electronAPI`
- [ ] 在 `src/types/electron.d.ts` 更新 `ElectronAPI` 接口
- [ ] 在 Service 层封装调用（如 `services/xxx.ts`）

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
| 路由配置 | `src/App.tsx` | HashRouter + Routes |
| 全局类型 | `src/types/electron.d.ts` | window.electronAPI 接口 |
| 样式变量 | `src/styles/variables.scss` | SCSS 变量与 mixins |

---

**文档版本**: 2.0  
**最后更新**: 2026-09-14  
**维护者**: CheckIn 开发团队
