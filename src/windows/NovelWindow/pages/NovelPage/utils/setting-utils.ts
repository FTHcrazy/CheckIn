/**
 * 小说设定领域纯函数 —— **re-export 垫片**
 *
 * 实现已迁至 `@/shared/novel/setting-utils`（N8）：全局设定中心是独立窗口，
 * 两个窗口都要用同一套领域纯函数，而窗口之间禁止互相导入，故提升到 shared。
 *
 * 本文件保留同名 re-export，既有 `../utils/setting-utils` import 路径零改动。
 */
export * from "@/shared/novel/setting-utils";
