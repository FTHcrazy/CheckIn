/**
 * 内置静态词库（PRD R18 / 步骤三）
 *
 * 随应用分发，不进 userDb（userDb 只存用户自定义池与收藏夹）。
 * 每字段 20~30 个词，组合空间 = 字段长度乘积，足以生成足够多样性的随机组合。
 *
 * 风格与八类名称的适配关系（NameStyleMeta.applicableKinds）：
 *   - 仙侠：全八类（最全）
 *   - 武侠：人 / 地 / 门派 / 神名
 *   - 现代都市：人 / 地 / 系统
 *   - 日式：人 / 地 / 神名
 *   - 西幻：人 / 地 / 门派 / 法宝 / 神名
 *   - 西式现代：人 / 地
 *
 * 不适配的组合（如「武侠境界名」「现代都市丹药」）UI 会禁用并提示，生成器命中空池时走降级返回。
 * 每个风格只为自己适用的 kind 提供 prefixesByKind / suffixesByKind 桶，省空间。
 */

import type { NamingDictionary, NamingPool } from "../types";

// ── 东方 · 仙侠（全八类） ─────────────────────────────────────────────────
const xianxiaPool: NamingPool = {
  surnames: [
    "沈", "苏", "顾", "陆", "叶", "林", "云", "萧", "慕", "柳",
    "楚", "夜", "墨", "白", "司", "南", "北", "曲", "凌", "青",
    "宫", "尉", "诸葛", "皇甫", "上官", "欧阳", "司马", "夏侯",
  ],
  maleGiven: [
    "尘", "渊", "珩", "璟", "砚", "霆", "霄", "寂", "湛", "昭",
    "淮", "珣", "澜", "珺", "砺", "恪", "轶", "祁", "霁", "韫",
    "昀", "珵", "翊", "聿", "宬", "珝", "洵", "朗", "勉", "澄",
  ],
  femaleGiven: [
    "璃", "芷", "泠", "婵", "绾", "笙", "槿", "浅", "璇", "菱",
    "沅", "栩", "杳", "湉", "瑟", "蘅", "檀", "蓁", "嫣", "翎",
    "黛", "岚", "菀", "姗", "芸", "沁", "皎", "涟", "湘", "婧",
  ],
  prefixesByKind: {
    place: ["玄", "幽", "凌霄", "紫府", "碧落", "黄泉", "九霄", "万古", "太虚", "鸿蒙",
            "混沌", "无极", "九幽", "十方", "九天", "北冥", "南离", "东华", "西昆", "昆仑",
            "蓬莱", "瀛洲", "苍梧", "青丘", "幽冥", "碧霞", "玄都", "紫"],
    faction: ["天魔", "九幽", "凌霄", "万剑", "千机", "百草", "七杀", "破军", "贪狼", "紫薇",
              "天机", "天同", "太阴", "巨门", "太阳", "武曲", "廉贞", "玄天", "太上", "无极",
              "九华", "玄霄", "玉清", "上清", "太清", "九华", "玄阳", "九阴", "苍穹", "玄冥"],
    artifact: ["乾坤", "太虚", "鸿蒙", "混沌", "九霄", "玄天", "紫府", "碧落", "黄泉", "无极",
              "上清", "玉清", "太清", "九幽", "十方", "九天", "北冥", "南离", "东华", "西昆"],
    realm: ["凝气", "筑基", "金丹", "元婴", "化神", "炼虚", "合体", "大乘", "渡劫", "真仙",
            "天仙", "金仙", "太乙", "大罗", "准圣", "圣人", "炼气", "开光", "心动", "辟谷",
            "灵寂", "悟道", "凝丹", "结丹", "返虚", "出窍", "分神", "合体", "渡劫", "飞升"],
    pill: ["九转", "碧落", "黄泉", "无极", "太虚", "鸿蒙", "混沌", "九霄", "玄天", "紫府",
          "上清", "玉清", "太清", "九幽", "十方", "凝气", "筑基", "金丹", "元婴", "化神",
          "炼虚", "合体", "渡劫", "飞升", "辟谷", "灵寂", "悟道", "凝丹", "结丹", "返虚"],
    system: ["无限", "全能", "万界", "诸天", "永恒", "至高", "无上", "混沌", "起源", "终焉",
            "万古", "永生", "不灭", "不朽", "无极", "天道", "圣道", "神道", "魔道", "佛道",
            "玄黄", "洪荒", "太上", "太初", "太始", "太素", "太极", "无极", "先天", "后天"],
    deity: ["玄天", "紫府", "碧落", "黄泉", "九霄", "太虚", "鸿蒙", "混沌", "无极", "九幽",
            "十方", "九天", "北冥", "南离", "东华", "西昆", "昆仑", "蓬莱", "瀛洲", "苍梧",
            "青丘", "幽冥", "碧霞", "玄都", "九华", "玄阳", "九阴", "苍穹", "玄冥", "太上"],
  },
  suffixesByKind: {
    place: ["谷", "峰", "渊", "海", "湖", "岛", "崖", "岭", "城", "关",
            "山", "川", "泽", "漠", "墟", "境", "天", "界", "域", "阙"],
    faction: ["宗", "门", "教", "阁", "殿", "宫", "楼", "院", "堂", "观",
              "派", "山庄", "会", "盟", "寨", "堡"],
    artifact: ["剑", "图", "鼎", "钟", "镜", "印", "珠", "符", "砂", "塔",
              "幡", "轮", "盘", "瓶", "葫芦", "梭", "针", "锥", "锤", "鞭"],
    realm: ["期", "境", "层", "阶", "重", "转", "劫", "天", "界", "域"],
    pill: ["丹", "散", "丸", "膏", "液", "露", "霜", "粉", "剂", "汤"],
    system: ["系统", "主神", "空间", "面板", "副本", "商店", "签到", "抽奖", "任务", "商店",
            "天赋", "技能", "属性", "经验", "等级"],
    deity: ["神", "尊", "帝", "君", "皇", "圣", "祖", "主", "王", "后",
            "母", "妃", "姬", "女", "郎"],
  },
};

// ── 东方 · 武侠（人 / 地 / 门派 / 神名） ─────────────────────────────────
const wuxiaPool: NamingPool = {
  surnames: [
    "萧", "段", "慕容", "欧阳", "令狐", "黄", "李", "郭", "杨", "张",
    "赵", "周", "陈", "林", "上官", "司空", "皇甫", "夏侯", "公孙", "南宫",
    "东方", "西门", "独孤", "耶律", "完颜", "呼延", "慕容", "拓跋",
  ],
  maleGiven: [
    "峰", "誉", "复", "锋", "冲", "无忌", "破天", "白", "三", "七",
    "九", "十三", "百川", "千仞", "万山", "长风", "云飞", "惊鸿", "问天", "不二",
    "九渊", "千钧", "破浪", "踏雪", "听雨", "临风", "凌云", "啸天", "饮酒", "藏锋",
  ],
  femaleGiven: [
    "碧", "青", "翠", "芷", "兰", "月", "霜", "雪", "梅", "兰",
    "竹", "菊", "芙", "蓉", "莲", "漪", "淼", "晴", "霞", "雯",
    "红", "燕", "莺", "鸾", "凤", "娥", "娟", "婷", "姝", "妍",
  ],
  prefixesByKind: {
    place: ["无极", "天魔", "九幽", "凌霄", "云台", "落霞", "苍梧", "听雨", "栖云", "听松",
            "藏剑", "铸剑", "断魂", "穿云", "落日", "碧波", "万剑", "千机", "百草", "七杀"],
    faction: ["少林", "武当", "峨眉", "昆仑", "崆峒", "点苍", "天山", "雪山", "终南", "华山",
              "衡山", "嵩山", "泰山", "恒山", "青城", "点苍", "全真", "古墓", "丐", "五毒"],
    deity: ["玄天", "紫府", "碧落", "黄泉", "九霄", "太虚", "鸿蒙", "九幽", "十方", "九天",
            "北冥", "南离", "东华", "西昆", "昆仑", "蓬莱", "瀛洲", "苍梧", "青丘", "幽冥"],
  },
  suffixesByKind: {
    place: ["谷", "峰", "崖", "岭", "城", "关", "山", "川", "泽", "墟",
            "镇", "桥", "渡", "滩", "原", "川", "岭", "峰"],
    faction: ["门", "帮", "派", "教", "宗", "山庄", "堂", "会", "盟", "寨",
              "堡", "楼", "阁"],
    deity: ["神", "尊", "帝", "君", "皇", "圣", "祖", "主", "王", "后"],
  },
};

// ── 东方 · 现代都市（人 / 地 / 系统） ───────────────────────────────────
const urbanPool: NamingPool = {
  surnames: [
    "王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴",
    "徐", "孙", "马", "朱", "胡", "郭", "何", "高", "林", "罗",
    "郑", "梁", "谢", "宋", "唐", "许", "韩", "冯", "邓", "曹",
  ],
  maleGiven: [
    "浩", "宇", "轩", "博", "晨", "翔", "皓", "巍", "涛", "磊",
    "鸿", "煜", "骞", "扬", "逸", "卓", "飒", "锴", "钧", "铎",
    "彦", "霖", "熙", "睿", "越", "齐", "凯", "宁", "安", "屹",
  ],
  femaleGiven: [
    "梓", "涵", "雨", "欣", "怡", "婷", "玥", "瑶", "若", "诗",
    "可", "蕊", "悦", "妍", "宁", "萌", "岚", "璟", "曦", "恬",
    "韫", "菡", "苒", "沐", "柒", "璃", "朵", "絮", "萱", "冉",
  ],
  prefixesByKind: {
    place: ["星", "月", "云", "海", "山", "江", "河", "湖", "湾", "滨",
            "枫", "桦", "橡", "梅", "兰", "菊", "竹", "柏", "杉", "槿",
            "华", "锦", "恒", "瑞", "泰", "盛", "昌", "隆", "嘉", "宁"],
    system: ["无限", "全能", "万界", "诸天", "永恒", "至高", "无上", "混沌", "起源", "终焉",
            "万古", "永生", "不灭", "不朽", "无极", "天道", "圣道", "神道", "魔道", "佛道"],
  },
  suffixesByKind: {
    place: ["城", "镇", "街", "巷", "园", "苑", "湾", "滨", "山", "海",
            "谷", "原", "川", "江", "湖", "港", "桥", "塔", "府", "庭",
            "广场", "中心", "大厦", "公寓", "小区", "墅", "畔", "滩"],
    system: ["系统", "主神", "空间", "面板", "副本", "商店", "签到", "抽奖", "任务", "天赋",
            "技能", "属性", "经验", "等级", "积分", "金币"],
  },
};

// ── 东方 · 日式（人 / 地 / 神名） ───────────────────────────────────────
const japanesePool: NamingPool = {
  surnames: [
    "佐藤", "铃木", "高桥", "田中", "渡边", "伊藤", "山本", "中村", "小林", "加藤",
    "吉田", "山田", "佐佐木", "山口", "松本", "井上", "木村", "斋藤", "清水", "森田",
    "池田", "桥本", "阿部", "石川", "前田", "森", "冈田", "原", "藤井", "中野",
  ],
  maleGiven: [
    "翔太", "莲", "颯太", "悠真", "阳向", "树", "海斗", "隼人", "大和", "苍",
    "汤", "岭", "旭", "柊", "颯", "骏", "悠", "奏", "律", "凉",
    "枫", "怜", "苍介", "悠人", "光", "海", "绫", "暖", "怜", "柊",
  ],
  femaleGiven: [
    "樱", "凛", "结衣", "阳菜", "芽依", "美咲", "枫", "纱", "葵", "澪",
    "结", "爱", "莉子", "美", "心", "雫", "海", "芽", "柚", "绮",
    "梓", "茜", "遥", "琴", "美樱", "美月", "美羽", "美香", "美铃", "美雪",
  ],
  prefixesByKind: {
    place: ["鬼", "神", "龙", "虎", "凤", "樱", "枫", "椿", "藤", "桔梗",
            "皇", "御", "天", "地", "水", "火", "风", "雷", "光", "暗",
            "千", "百", "万", "十", "八", "九", "七", "三", "五", "二"],
    deity: ["天", "地", "水", "火", "风", "雷", "光", "暗", "鬼", "神",
            "龙", "虎", "凤", "樱", "枫", "椿", "藤", "桔梗", "皇", "御"],
  },
  suffixesByKind: {
    place: ["岛", "川", "山", "谷", "原", "野", "森", "林", "海", "滨",
            "崎", "田", "冢", "本", "木", "野", "原", "谷", "川", "山"],
    deity: ["神", "命", "姬", "尊", "皇", "后", "御", "妃", "子", "女"],
  },
};

// ── 西方 · 史诗奇幻（人 / 地 / 门派 / 法宝 / 神名） ──────────────────────
const westernFantasyPool: NamingPool = {
  westernSurnames: [
    "Stormwind", "Blackwood", "Ravencroft", "Ironheart", "Frosthelm", "Brightblade", "Nightshade", "Stormborn",
    "Dragonfang", "Wolfbane", "Goldcrest", "Silverleaf", "Ashwood", "Thornheart", "Frost", "Wolf",
    "Raven", "Storm", "Bright", "Black", "Iron", "Silver", "Gold", "Ash",
  ],
  westernMaleGiven: [
    "Aldric", "Cedric", "Garrick", "Roderick", "Alaric", "Edric", "Kael", "Draven",
    "Lucian", "Valerian", "Caspian", "Dorian", "Alistair", "Ronan", "Bran", "Cael",
    "Garreth", "Aric", "Tobias", "Eldric", "Soren", "Magnus", "Rhys", "Tristan",
  ],
  westernFemaleGiven: [
    "Elara", "Lyra", "Seraphine", "Isolde", "Aelira", "Mira", "Evelina", "Sylvana",
    "Ophira", "Theris", "Cassandra", "Freya", "Sigrun", "Astrid", "Brunhild", "Morgaine",
    "Lilith", "Maeve", "Nimue", "Vivienne", "Morgana", "Rhiannon", "Elowen", "Isabeau",
  ],
  prefixesByKind: {
    place: ["Aether", "Astral", "Abyssal", "Eternal", "Crimson", "Verdant", "Azure", "Obsidian",
            "Golden", "Silver", "Bronze", "Iron", "Stone", "Storm", "Frost", "Ember",
            "Shadow", "Moon", "Sun", "Star", "Twilight", "Dawn", "Dusk", "Night",
            "Holy", "Sacred", "Divine", "Ancient", "Elder", "High"],
    faction: ["Holy", "Sacred", "Divine", "Ancient", "Elder", "High", "Grand", "Royal",
              "Silver", "Golden", "Iron", "Crimson", "Verdant", "Azure", "Obsidian", "Storm",
              "Frost", "Ember", "Shadow", "Moon"],
    artifact: ["Aether", "Astral", "Abyssal", "Eternal", "Crimson", "Verdant", "Azure", "Obsidian",
              "Golden", "Silver", "Bronze", "Iron", "Stone", "Storm", "Frost", "Ember",
              "Shadow", "Moon", "Sun", "Star", "Twilight", "Dawn", "Dusk", "Night",
              "Holy", "Sacred", "Divine", "Ancient", "Elder", "High"],
    deity: ["Holy", "Sacred", "Divine", "Ancient", "Elder", "High", "Grand", "Royal",
            "Silver", "Golden", "Iron", "Crimson", "Verdant", "Azure", "Obsidian", "Storm",
            "Frost", "Ember", "Shadow", "Moon"],
  },
  suffixesByKind: {
    place: ["Spire", "Hold", "Citadel", "Sanctum", "Forge", "Reach", "Hollow", "Wold",
            "Vale", "Wastes", "Marsh", "Mount", "Crag", "Cliff", "Hall", "Keep",
            "Tower", "Bridge", "Gate", "Pass"],
    faction: ["Knight", "Order", "Guild", "Circle", "Conclave", "Covenant", "Academy", "Sanctuary",
              "Temple", "Cathedral", "Abbey", "Priory", "Brotherhood", "Sisterhood", "Vanguard", "Legion"],
    artifact: ["Blade", "Edge", "Lance", "Shield", "Crown", "Scepter", "Tome", "Relic",
              "Pantheon", "Temple", "Shrine", "Altar", "Oracle", "Chalice", "Talisman", "Amulet"],
    deity: ["God", "Lord", "King", "Queen", "Emperor", "Empress", "Saint", "Prophet",
            "Hierophant", "Pontiff", "Bishop", "Cardinal", "Archon", "Magister", "Hierarch", "Patriarch"],
  },
};

// ── 西方 · 现代欧美（人 / 地） ───────────────────────────────────────────
const westernModernPool: NamingPool = {
  westernSurnames: [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Taylor",
    "Thomas", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
  ],
  westernMaleGiven: [
    "Liam", "Noah", "Oliver", "Elijah", "James", "William", "Benjamin", "Lucas",
    "Henry", "Alexander", "Mason", "Michael", "Daniel", "Jacob", "Logan", "Jackson",
    "Ethan", "Jack", "Levi", "Sebastian", "Julian", "Aaron", "Ben", "Caleb",
  ],
  westernFemaleGiven: [
    "Olivia", "Emma", "Charlotte", "Amelia", "Ava", "Sophia", "Isabella", "Mia",
    "Evelyn", "Harper", "Luna", "Ella", "Grace", "Chloe", "Zoe", "Lily",
    "Aria", "Nora", "Riley", "Scarlett", "Hannah", "Layla", "Stella", "Maya",
  ],
  prefixesByKind: {
    place: ["North", "South", "East", "West", "New", "Old", "Upper", "Lower",
            "Saint", "Fort", "Mount", "Lake", "River", "Hill", "Park", "Bay",
            "Port", "Glen", "Dale", "Haven", "Vale", "Cove", "Springs", "Falls",
            "Brook", "Wood", "Field", "Stone", "Ash", "Maple", "Oak", "Pine"],
  },
  suffixesByKind: {
    place: ["town", "ville", "burg", "ford", "port", "bury", "field", "ton",
            "bridge", "haven", "creek", "wood", "lake", "hills", "city",
            "Heights", "Park", "Gardens", "Square", "Plaza", "Blvd", "Avenue", "Street"],
  },
};

/**
 * 风格元信息
 *
 * applicableKinds = null 表示该风格支持全部八类名称（当前只有仙侠做到全覆盖）；
 * 其它风格按其文化适配性裁剪，UI 会据此禁用不适配的组合，避免出现「武侠境界名」
 * 「日式丹药」这种违和组合。
 */
export const NAMING_STYLES: NamingDictionary["styles"] = [
  { id: "xianxia", label: "仙侠", family: "eastern", applicableKinds: null },
  { id: "wuxia", label: "武侠", family: "eastern", applicableKinds: ["person", "place", "faction", "deity"] },
  { id: "urban", label: "现代都市", family: "eastern", applicableKinds: ["person", "place", "system"] },
  { id: "japanese", label: "日式", family: "eastern", applicableKinds: ["person", "place", "deity"] },
  { id: "westernFantasy", label: "西幻", family: "western", applicableKinds: ["person", "place", "faction", "artifact", "deity"] },
  { id: "westernModern", label: "西式现代", family: "western", applicableKinds: ["person", "place"] },
];

/** 名称类型元信息 */
export const NAMING_KINDS: NamingDictionary["kinds"] = [
  { id: "person", label: "人名", genderAware: true, hint: "姓 + 名，按性别过滤用字池" },
  { id: "place", label: "地名", genderAware: false, hint: "修饰 + 名词后缀" },
  { id: "faction", label: "门派名", genderAware: false, hint: "修饰 + 名词后缀（宗/教/阁/骑士团…）" },
  { id: "artifact", label: "法宝名", genderAware: false, hint: "修饰 + 器物后缀（剑/图/鼎/之剑…）" },
  { id: "realm", label: "境界名", genderAware: false, hint: "修饰 + 层级后缀（期/境/层…）" },
  { id: "pill", label: "丹药名", genderAware: false, hint: "修饰 + 药剂后缀（丹/散/丸…）" },
  { id: "system", label: "系统名", genderAware: false, hint: "修饰 + 系统后缀（系统/主神/空间…）" },
  { id: "deity", label: "神名", genderAware: false, hint: "称号 + 名（帝/君/神…）" },
];

/** 完整内置词库 */
export const NAMING_DICTIONARY: NamingDictionary = {
  styles: NAMING_STYLES,
  kinds: NAMING_KINDS,
  pools: {
    xianxia: xianxiaPool,
    wuxia: wuxiaPool,
    urban: urbanPool,
    japanese: japanesePool,
    westernFantasy: westernFantasyPool,
    westernModern: westernModernPool,
  },
};
