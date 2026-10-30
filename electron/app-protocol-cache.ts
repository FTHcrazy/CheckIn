/**
 * `app://` 协议响应的缓存策略（纯函数，可单测）。
 *
 * 生产产物里两类文件的缓存语义完全相反，必须分开处理：
 *
 * 1) **内容寻址的哈希资产**（`assets/antd-BW5-K5RM.js` → 文件名里的 8 位哈希
 *    随内容变化）。同一个 URL 的字节永不变，因此打 `immutable` 头。
 *
 *    ⚠️ 关于「跨窗口免主进程读盘」：这依赖 Chromium 对自定义协议响应启用磁盘
 *    缓存。但自定义 scheme 走 URLLoader 直通、是否过 HttpCache（磁盘缓存）并无
 *    官方保证，属于**未验证假设**——若不成立，这个头只是无害空转，最坏退回每次
 *    读盘。真正的跨窗口收益锚点在 V8 码缓存：scheme 侧 `codeCache: true` +
 *    渲染侧 `v8CacheOptions:"bypassHeatCheck"`（见 main.ts），二者配套让
 *    「编译一次」的 antd 等大 chunk 成果跨渲染进程复用。
 *
 * 2) **固定文件名的导航与静态资源**（`src/windows/Xxx/index.html`、favicon、
 *    tray 图标）。它们跨版本会被同名覆盖，一旦被缓存，应用升级后用户仍会拿到
 *    上一版 HTML，而它引用的旧哈希资产已经从磁盘上删掉了 → 白屏。
 *    这类一律 `no-store`（而非 `no-cache`）：自定义协议没有网络回源，
 *    「必须重新校验」在这条链路上没有可用的校验器，`no-store` 语义无歧义。
 */

/** 哈希资产：一年 + immutable。文件名内容寻址，不需要也不应该回源。 */
export const HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** 固定文件名资源：完全不进缓存，每次由协议处理器现读。 */
export const DYNAMIC_FILE_CACHE_CONTROL = "no-store";

/**
 * vite 的产物命名 `[name]-[hash].[ext]`，hash 为 base64url（字符集含 `-` / `_`，
 * 如 `Z_G_STkm`、`BH1R-mb2`），因此必须允许连字符。
 * 正则放宽到 `{6,}`：兜底 vite 将来改短哈希长度时不会整体静默退回 `no-store`
 * （真正的回归守卫见 `app-protocol-cache.test.ts` 里对 `dist/assets` 的动态扫描）。
 */
const HASHED_FILENAME_RE = /-[a-z0-9_-]{6,}\.[a-z0-9]+$/;

/** 取路径最后一段文件名（兼容 `/` 与 `\`，并剥掉 `?` / `#` 之后的查询段） */
function baseName(rawPath: string): string {
  const withoutQuery = rawPath.split(/[?#]/)[0] ?? "";
  const segments = withoutQuery.split(/[/\\]/);
  return segments[segments.length - 1] ?? "";
}

/**
 * 路径是否为内容寻址的哈希资产（vite 产物命名：`<name>-<8位base64url哈希>.<ext>`）。
 *
 * ⚠️ 本函数**只认 vite 产物命名**，不要把它套到 `public/` 拷贝来的固定名文件上：
 * 固定名文件（favicon、tray、第三方固定名脚本）跨版本内容会变、URL 不变，一旦被
 * 误判为 immutable 会喂旧字节。这类资源必须走 `no-store` 白名单（即
 * `resolveAppProtocolCacheControl` 的非哈希分支），切勿依赖本判定。
 *
 * `.html` 显式排除：HTML 是导航入口，其 URL 由主进程写死（`RENDERER_ENTRY_PATHS`），
 * 不随内容变化，即使将来构建产出了带哈希的文件名也不能按 immutable 处理。
 */
export function isHashedAssetPath(rawPath: string): boolean {
  const file = baseName(rawPath).toLowerCase();
  if (!file || file.endsWith(".html")) return false;
  return HASHED_FILENAME_RE.test(file);
}

/** 按路径给出 `Cache-Control` 头取值 */
export function resolveAppProtocolCacheControl(rawPath: string): string {
  return isHashedAssetPath(rawPath) ? HASHED_ASSET_CACHE_CONTROL : DYNAMIC_FILE_CACHE_CONTROL;
}
