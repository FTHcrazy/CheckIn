/**
 * 小说设定域的**默认值常量**（本书域 / 全局域 / 两个设定中心窗口共用）
 *
 * 从 `NovelWindow/pages/NovelPage/novel-config.ts` 迁入（T03）：设定中心组件被
 * 提升到 `src/shared/components/SettingCenter` 后跨窗口复用，而 `src/shared/*`
 * 不允许 import `src/windows/*`（窗口之间禁止互相导入），故把这份纯常量下沉到
 * shared。原 `novel-config.ts` 保留同名 re-export，既有 import 路径零改动。
 *
 * ⚠️ 这三个默认值**必须与主进程一致**：主进程建表 / 插入时用自己的一份常量
 * （`electron/handlers/novel-handlers.ts`），渲染层乐观更新用这里的。两边不一致
 * 会出现「新建分类后本地显示九层、落库是一层」这类难查的错位，由
 * `electron/novel-setting-defaults-guard.test.ts` 做源码级比对。
 *
 * 本文件不含 React（跨窗口共享位，见 work-numbering 守卫同款约束）。
 */

/** 设定分类的默认色点 */
export const DEFAULT_CATEGORY_COLOR = "#5B8DEF";

/** 默认小层命名模板（{n} 为层号占位符） */
export const DEFAULT_SUB_PATTERN = "第{n}层";

/** 默认每阶小层数：1 表示不分层 */
export const DEFAULT_SUB_LEVELS = 1;

/**
 * 设定分类色板
 *
 * 放配置而不是组件文件里：组件文件只允许导出组件（react-refresh 规则），
 * 且色板要能被守卫测试直接读到。新建分类按「还没被占用的第一个」取色 ——
 * 全部同色的分类列表没法扫读。
 */
export const CATEGORY_PALETTE = [
  "#5B8DEF",
  "#8B77F0",
  "#34B37E",
  "#E8935E",
  "#E8618C",
  "#2FA57E",
  "#C9A227",
] as const;
