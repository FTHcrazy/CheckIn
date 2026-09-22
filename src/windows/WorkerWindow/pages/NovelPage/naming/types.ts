/**
 * 起名工具领域类型（PRD R18 / 步骤三）
 *
 * 步骤三把 PRD v0.5 的「五风格人名随机起名」扩展为：
 *   - 八类名称（人名 / 地名 / 门派 / 法宝 / 境界 / 丹药 / 系统 / 神名）
 *   - 东西方风格族（eastern / western）顶层分组
 *
 * 不建表（PRD §7 起名词库为静态资源，收藏夹与自定义池走 userDb config 整读整写）。
 * 本文件只放类型，不放实现；与 NovelPage/types.ts 同样保持「类型层」纯净。
 */

/** 八类名称 */
export type NamingKind =
  | "person" // 人名
  | "place" // 地名
  | "faction" // 门派名
  | "artifact" // 法宝名
  | "realm" // 境界名
  | "pill" // 丹药名
  | "system" // 系统名
  | "deity"; // 神名

/** 东西方风格族（顶层分组维度） */
export type NameStyleFamily = "eastern" | "western";

/**
 * 具体风格
 *
 * 前五个为 PRD v0.5 原五风格；后两个为步骤三「东西方」显式化的补足——
 * 把 PRD 里笼统的「西幻」拆成史诗奇幻 / 现代西式两类，对应欧式姓名与
 * 现代欧美都市的不同用字。eastern 与 western 两族通过 NameStyleMeta.family
 * 标注，UI 据此分组下拉。
 */
export type NameStyle =
  | "xianxia" // 仙侠（东方）
  | "wuxia" // 武侠（东方）
  | "urban" // 现代都市（东方）
  | "japanese" // 日式（东方）
  | "westernFantasy" // 西幻 · 史诗奇幻（西方）
  | "westernModern"; // 西式现代（西方）

/** 性别（人名专用；其它类型固定 'any'） */
export type NameGender = "male" | "female" | "any";

/** 风格元信息 */
export interface NameStyleMeta {
  id: NameStyle;
  label: string;
  family: NameStyleFamily;
  /** 该风格可生成的名称类型；null = 全部八类都支持（用于禁用不适配的组合） */
  applicableKinds: NamingKind[] | null;
}

/** 名称类型元信息 */
export interface NamingKindMeta {
  id: NamingKind;
  label: string;
  /** 该类型是否使用性别维度（只有 person 走性别过滤） */
  genderAware: boolean;
  /** 提示文案，用于 UI 占位 */
  hint: string;
}

/**
 * 词池结构
 *
 * 八类名称的构词法最终都收敛到「修饰前缀 + 名词后缀」或「姓 + 名」两种形态：
 *   - person（东方）：surname + 1~2 个 maleGiven / femaleGiven
 *   - person（西方）：westernMaleGiven / westernFemaleGiven + westernSurname（中间空格）
 *   - 其它 7 类：prefixesByKind[kind] + suffixesByKind[kind]
 *
 * 把前缀/后缀按 kind 分桶，避免「九霄丹」「九霄宗」「九霄城」混在一起——
 * 同一风格下不同类型的词池各自独立，生成器按 kind 取对应字段。
 * 每字段可空：风格不适配某类型时该 kind 的桶缺省，生成器走降级路径返回空。
 */
export interface NamingPool {
  /** 东方姓氏（中文） */
  surnames?: string[];
  /** 东方名字用字（男） */
  maleGiven?: string[];
  /** 东方名字用字（女） */
  femaleGiven?: string[];
  /** 西方姓氏 */
  westernSurnames?: string[];
  /** 西方男名 given */
  westernMaleGiven?: string[];
  /** 西方女名 given */
  westernFemaleGiven?: string[];
  /** 非 person 类型的修饰前缀，按 kind 分桶 */
  prefixesByKind?: Partial<Record<Exclude<NamingKind, "person">, string[]>>;
  /** 非 person 类型的后缀，按 kind 分桶 */
  suffixesByKind?: Partial<Record<Exclude<NamingKind, "person">, string[]>>;
}

/** 内置词库整体形态 */
export interface NamingDictionary {
  /** 风格元信息（UI 下拉与分组用） */
  styles: NameStyleMeta[];
  /** 名称类型元信息 */
  kinds: NamingKindMeta[];
  /** 实际词池：每个风格独立一组完整池 */
  pools: Record<NameStyle, NamingPool>;
}

/** 生成器入参（纯函数，可测） */
export interface NamingOptions {
  kind: NamingKind;
  style: NameStyle;
  gender: NameGender;
  /** 一次生成多少个名字（PRD R18 一次给 10 个） */
  count: number;
  /** 避开本书已用名（要素 name + aliases 去重） */
  exclude: string[];
  /** 随机种子；缺省由内部 Date.now() 派生，传入可复现（单测用） */
  seed?: number;
  /** 用户自定义用字池（覆盖内置池对应字段） */
  customPool?: NamingCustomPool;
}

/** 生成结果条目 */
export interface NamingResult {
  /** 生成名字 */
  name: string;
  /** 该名字由哪些字段组合（调试 / 收藏时显示来源风格与类型） */
  kind: NamingKind;
  style: NameStyle;
  gender: NameGender;
}

/**
 * 用户自定义用字池
 *
 * 键为 `${kind}:${style}:${slot}`（slot ∈ surnames/maleGiven/.../suffixes），
 * 值为字串数组。整读整写存 userDb config（PRD §7），与 EditorSettings 同范式。
 * 生成时按字段覆盖合并：用户池里的字段优先于内置池。
 */
export interface NamingCustomPool {
  [compositeKey: string]: string[];
}

/** 收藏的名字（按作品持久化，PRD R18 ④ 收藏夹） */
export interface NameFavorite {
  id: string;
  workId: string;
  name: string;
  kind: NamingKind;
  style: NameStyle;
  /** 用户备注（可空） */
  note?: string;
  createdAt: number;
}
