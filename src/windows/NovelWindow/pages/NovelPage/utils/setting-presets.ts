/**
 * 内置设定预设（1.37.0）
 *
 * 模板库的「开箱即用」层：用户自存模板解决「换书复用自己的体系」，
 * 预设解决「第一本书不知道怎么配」—— 一键灌入一个分类，灌完仍是普通
 * 分类，随便改。刻意做成**前端常量**而非写进 novel_setting_templates：
 * 模板表是用户数据，预设是产品口径，混在一起会让「删除模板」误删预设。
 *
 * 数据形状与 SettingCategorySnapshot 同构（少 id / color 等落库字段），
 * 应用时走 createSettingCategory + batchAddSettingLevels，不新增通道。
 */
import type { CarryDirection } from "../types";

/** 预设里的一个等级项 */
export interface SettingPresetLevel {
  name: string;
  /** 本阶小层数；缺省 1（无小层） */
  subLevels?: number;
  /** 本阶小层命名模板；缺省沿用分类。固定名单用顿号/逗号分隔 */
  subPattern?: string;
}

/** 一个内置预设 = 一个完整的设定分类 */
export interface SettingPreset {
  id: string;
  name: string;
  kind: "realm" | "custom";
  note: string;
  /** 分类级默认小层数（新增等级时继承） */
  subLevels: number;
  carryDir: CarryDirection;
  /** 分类级小层命名模板 */
  subPattern: string;
  levels: SettingPresetLevel[];
}

/** 修仙「各阶初期/中期/后期/圆满」的通用段 */
const XIUXIAN_STAGES = ["筑基", "金丹", "元婴", "化神", "合体", "渡劫", "大乘"];

function xiuxianStages(): SettingPresetLevel[] {
  return XIUXIAN_STAGES.map((name) => ({
    name,
    subLevels: 4,
    subPattern: "初期,中期,后期,圆满",
  }));
}

export const SETTING_PRESETS: SettingPreset[] = [
  {
    id: "preset-xiuxian-9",
    name: "修仙 · 经典九层",
    kind: "realm",
    note: "练气九层，筑基至大乘各分初期/中期/后期/圆满",
    subLevels: 9,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: [{ name: "练气", subLevels: 9, subPattern: "第{n}层" }, ...xiuxianStages()],
  },
  {
    id: "preset-xiuxian-13",
    name: "修仙 · 练气十三层",
    kind: "realm",
    note: "练气十三层，筑基至大乘各分初期/中期/后期/圆满",
    subLevels: 13,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: [{ name: "练气", subLevels: 13, subPattern: "第{n}层" }, ...xiuxianStages()],
  },
  {
    id: "preset-xuanhuan",
    name: "玄幻 · 灵武八境",
    kind: "realm",
    note: "八境各分初期/中期/圆满，境界结构可与修仙体系并存不同",
    subLevels: 3,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: ["聚灵境", "通脉境", "灵台境", "命宫境", "神游境", "破妄境", "虚空境", "造化境"].map(
      (name) => ({ name, subLevels: 3, subPattern: "初期,中期,圆满" }),
    ),
  },
  {
    id: "preset-dushi",
    name: "都市 · 异能评级",
    kind: "custom",
    note: "F 到 SSS 倒序评级（进位方向=由高到低），无小层",
    subLevels: 1,
    carryDir: "desc",
    subPattern: "第{n}层",
    levels: ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"].map((name) => ({ name })),
  },
  {
    id: "preset-honghuang",
    name: "洪荒 · 仙道品位",
    kind: "realm",
    note: "人仙到圣人十品位，无小层（作品已有境界体系时自动降为普通分类）",
    subLevels: 1,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: [
      "人仙",
      "地仙",
      "天仙",
      "真仙",
      "玄仙",
      "金仙",
      "太乙金仙",
      "大罗金仙",
      "准圣",
      "圣人",
    ].map((name) => ({ name })),
  },
  // ── 1.40.0：行囊物品 / 技能「品阶标注」的热门配套体系（kind=custom）──
  //
  // 这三个预设回答的是「法宝/功法/丹药怎么分级」：灌进来的是普通分类，
  // 行囊里给物品分类绑定它之后，物品 / 技能就能标注品阶（小刀 · 神器、
  // 神通 · 天阶）。刻意都用无小层的单级序列 —— 品阶是标签不是成长阶梯。
  {
    id: "preset-fabao",
    name: "法宝 · 品阶",
    kind: "custom",
    note: "法器到神器八品，行囊里给「物品分类」绑定后可标注（小刀 · 神器）",
    subLevels: 1,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: ["凡器", "法器", "灵器", "宝器", "王器", "皇器", "仙器", "神器"].map((name) => ({
      name,
    })),
  },
  {
    id: "preset-gongfa",
    name: "功法 · 品阶",
    kind: "custom",
    note: "黄阶到圣阶五品，适合给技能 / 神通标注等第（神通 · 天阶）",
    subLevels: 1,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: ["黄阶", "玄阶", "地阶", "天阶", "圣阶"].map((name) => ({ name })),
  },
  {
    id: "preset-danyao",
    name: "丹药 · 品阶",
    kind: "custom",
    note: "一品到九品，丹药 / 灵物的通用分级，行囊物品可按它标注品阶",
    subLevels: 1,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: ["一品", "二品", "三品", "四品", "五品", "六品", "七品", "八品", "九品"].map(
      (name) => ({ name }),
    ),
  },
];
