import { PACK_MODULES, type PackModuleKey } from "../types";

/** 模块标题（模块壳与模块管理面板共用同一份文案） */
export function moduleLabel(key: PackModuleKey): string {
  return PACK_MODULES.find((module) => module.key === key)?.label ?? key;
}

/** 模块说明（模块管理面板里的一句话） */
export function moduleDesc(key: PackModuleKey): string {
  return PACK_MODULES.find((module) => module.key === key)?.desc ?? "";
}
