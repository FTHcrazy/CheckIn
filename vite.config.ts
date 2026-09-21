import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

// 精简构建开关：CHECKIN_LITE=1 时不打包 WorkerWindow，主窗口隐藏其入口按钮
// （配套脚本：pnpm electron:build:lite）
const isLite = process.env.CHECKIN_LITE === '1'

// https://vite.dev/config/
export default defineConfig({
  // 渲染层编译期常量：精简构建为 true（HomeSidebar 据此隐藏 Worker 入口）
  define: { __CHECKIN_LITE__: JSON.stringify(isLite) },
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
          // 主进程编译期常量：精简构建时 worker-window-open 打开请求直接忽略
          define: { __CHECKIN_LITE__: JSON.stringify(isLite) },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // 主进程运行时 Node 模块保持 require，不打入 bundle：
              // - electron / better-sqlite3：原生模块
              // - mammoth / docx：处理 .docx 的纯 Node 库，其传递依赖（如
              //   jszip→readable-stream→core-util-is）在 pnpm 非扁平结构下
              //   rolldown 无法解析，故整体 external
              external: ['electron', 'better-sqlite3', 'mammoth', 'docx'],
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
          define: { __CHECKIN_LITE__: JSON.stringify(isLite) },
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
  optimizeDeps: {
    include: ['antd', '@ant-design/icons', 'react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      input: {
        // 每个独立窗口一个 HTML 入口，与 src/windows/* 一一对应
        base: path.resolve(__dirname, 'src/windows/BaseWindow/index.html'),
        login: path.resolve(__dirname, 'src/windows/LoginWindow/index.html'),
        // 精简构建不产出 WorkerWindow 入口（dist 中不含 worker 页面产物）
        ...(isLite
          ? {}
          : { worker: path.resolve(__dirname, 'src/windows/WorkerWindow/index.html') }),
      },
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
