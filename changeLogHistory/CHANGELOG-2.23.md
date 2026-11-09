# Changelog · 2.23.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.23.0] - 2026-11-04

> 新增两个**本地图片工具页**（checkin 域，base 窗口）：图片压缩、色键抠图。
> 算法口径来自对两个公开在线工具的**静态分析**（`abtool.cn` 的 PNG / 批量压缩：
> UPNG 调色板量化 + 目标体积二分；`tool.lu` 的色键：逐通道最大差值判背景），
> 实现为本仓自写代码，未复制其源码或文案；两页全部在渲染进程本地完成，不上传。

### Added

- **图片压缩页**（路由 `/compress`）：单张与批量共用同一个串行队列。
  PNG 走 UPNG 调色板量化（2–256 色，可切真彩色无损重编码），JPEG / WebP 走
  canvas 质量档；两者都支持「目标体积」模式——PNG 逐级缩尺寸 + 二分色数，
  JPEG / WebP 先二分质量、压到底再二分尺寸。支持多选 / 拖拽 / Ctrl+V 粘贴、
  等比限宽高、JPEG 底色、逐张对比（滑块擦除）、逐张下载与 JSZip 打包下载。
  压缩结果不小于原图且格式未变时**自动保留原图**（与参考工具同口径）。
- **色键抠图页**（路由 `/cutout`）：点图取色（吸管取原图全分辨率像素）+
  相似色阈值 + 边缘软边，棋盘格预览透明底，导出 PNG。像素判定为「RGB 三通道
  差值最大值 ≤ 容差」，**只改 alpha 不动 RGB**，已透明像素不重复计入统计。
- 共享 `src/shared/utils/download.ts`（object URL + `<a download>`），两页共用。
- 纯函数单测 43 条：`image-compress-utils.test.ts`（体积口径 / 缩放 / 命名去重 /
  整数与浮点二分）与 `chroma-key-utils.test.ts`（逐通道判定 / 软边衰减 / 颜色换算）。

### Changed

- `BaseWindow/App.tsx`：路由与 `PAGE_TITLES` 增加 `/compress`、`/cutout`；
  首页功能卡新增「图片压缩」「色键抠图」两个入口。
- devDependencies 增加 `upng-js`、`pako`（纯渲染层依赖，Vite 打进 `dist`，
  不进 asar；production `dependencies` 仍为 4 项，§6.8 口径未变）。

### Notes

- 与参考实现的两处**有意差异**：① 色键多一个「边缘软边」开关，默认 0 即与
  参考口径完全一致；② 参考工具在缩放倍率恰好为 1 时，把透明 PNG 转 JPEG 会让
  透明区变黑（未铺底色），本实现始终先铺底色。
- 引导参考实现按帧重算阈值；本页参数变更合并 120ms 再算，避免大图拖动滑块卡窗。
