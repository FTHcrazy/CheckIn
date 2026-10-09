import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import {
  EDITION_WINDOW_ENTRIES,
  RENDERER_ENTRY_PATHS,
  resolveEditionFromEnv,
} from './electron/edition'

// 构建版本：CHECKIN_EDITION=full | lite | novel（缺省 full，配套脚本见 package.json）
// - lite ：精简构建，不打包 NovelWindow / SettingsWindow，主窗口隐藏小说入口
// - novel：小说版，NovelWindow 为主窗口 + SettingsWindow，不打包 BaseWindow
// 清单唯一事实源：electron/edition.ts（主进程运行时与 vite 构建期共用），
// 三处 define 必须注入同一个取值（下方 edition 变量单点计算，天然对齐）。
const edition = resolveEditionFromEnv()

// 各版本窗口入口即 rollupOptions.input，与主进程可加载窗口一一对应
const rendererInputs = Object.fromEntries(
  EDITION_WINDOW_ENTRIES[edition].map((key) => [
    key,
    path.resolve(__dirname, RENDERER_ENTRY_PATHS[key]),
  ]),
)

// https://vite.dev/config/
export default defineConfig({
  // 渲染层编译期常量：版本号（src/shared/edition.ts 据此派生布尔）
  define: { __CHECKIN_EDITION__: JSON.stringify(edition) },
  plugins: [
    react(),
    electron([
      {
        // 主进程入口
        entry: 'electron/main.ts',
        onstart() {
          // 不自动启动 Electron，由 concurrently 在 dev server 就绪后启动
        },
        vite: {
          // 主进程编译期常量：决定主窗口归属、close 语义与 IPC 注册范围
          define: { __CHECKIN_EDITION__: JSON.stringify(edition) },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // 主进程运行时 Node 模块保持 require，不打入 bundle：
              // - electron / better-sqlite3：原生模块
              // - mammoth / docx：处理 .docx 的纯 Node 库，其传递依赖（如
              //   jszip→readable-stream→core-util-is）在 pnpm 非扁平结构下
              //   rolldown 无法解析，故整体 external
              // - jszip：数据迁移的 zip 编解码，同属 Node 侧依赖
              external: ['electron', 'better-sqlite3', 'mammoth', 'docx', 'jszip'],
            },
          },
        },
      },
      {
        // 预加载脚本
        entry: 'electron/preload.ts',
        onstart() {
          // 不调用 reload()，防止插件自动启动 Electron
          // preload 变更后需手动重启 dev
        },
        vite: {
          define: { __CHECKIN_EDITION__: JSON.stringify(edition) },
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
    renderer(),
  ],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // 预优化重型依赖，加速首次页面加载
  // pixi.js：地图窗口的 WebGL 渲染内核（体量大、内部模块多，预构建收益明显）
  optimizeDeps: {
    include: ['antd', '@ant-design/icons', 'react', 'react-dom', 'pixi.js'],
  },
  build: {
    rollupOptions: {
      // 每个独立窗口一个 HTML 入口，按版本由 electron/edition.ts 清单生成
      input: rendererInputs,
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor'
          }
          if (id.includes('node_modules/antd') || id.includes('node_modules/@ant-design')) {
            return 'antd'
          }
        },
      },
    },
  },
})
