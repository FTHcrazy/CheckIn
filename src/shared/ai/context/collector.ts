/**
 * ⚠️ 兼容薄壳（T02）：`collectBookContext` 与 `AiBookContext` 已迁进小说域。
 *
 * 为什么保留：`src/shared/components/SettingCenter/hooks/useAiLevelGen.ts:21`
 * 直接 `import { collectBookContext } from "@/shared/ai/context/collector"`，
 * 本次任务不允许改 `shared/ai` 之外的文件。一个版本内保持路径可用。
 *
 * 下一版动作：把该 import 改成 `@/shared/ai/context`，然后删掉本文件。
 */
export * from "./prompt/domains/novel/types";
export * from "./prompt/domains/novel/collector";
