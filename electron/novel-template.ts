/**
 * 模板书籍生成器（调试用：一键重置初始书籍）
 *
 * 确定性生成一套覆盖小说编辑器全部功能的种子数据：
 * - 作品 / 卷 / 章节（每章 ≥ 3000 字，全书 15 章约 6 万字，压测 CodeMirror
 *   虚拟滚动、全书检索、快照与标注层预算）
 * - 六类要素卡（character / location / faction / item / level_system / custom），
 *   含别名、自定义字段，正文自然穿插名称与别名以驱动标注高亮与悬浮卡
 * - 要素关联（novel_links 多态关联）
 * - 等级体系两条（灵徒九境 / 器阶七品）与阶梯 rungs
 * - 灵感速记（含置顶、已转伏笔标记）
 * - 伏笔条目（待回收 / 已回收、卷级挂载 / 章级绑定）
 * - 章节一句话梗概（outline_note）与草稿 / 完稿状态
 *
 * 输出完全由 seed 决定（mulberry32 伪随机），两次构建结果逐字段一致，
 * 便于单测断言；id 使用固定前缀，配合重置 IPC 的「先清空再播种」幂等落地。
 */

// ── 行类型（与 novel-handlers.ts 的插入参数对齐，camelCase 由 handler 转换） ──

export interface TemplateVolume {
  id: string;
  name: string;
  sort: number;
}

export interface TemplateChapter {
  id: string;
  volumeId: string;
  title: string;
  content: string;
  wordCount: number;
  status: "draft" | "done";
  sort: number;
  outlineNote: string | null;
}

export interface TemplateEntity {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  summary: string;
  content: string;
  fields: Record<string, string>;
  sort: number;
}

export interface TemplateLink {
  id: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
}

export interface TemplateLevelSystem {
  id: string;
  name: string;
  rungs: Array<{ id: string; name: string; rank: number; note?: string }>;
}

export interface TemplateNote {
  id: string;
  content: string;
  pinned: boolean;
  foreshadowId: string | null;
}

export interface TemplateOutlineEntry {
  id: string;
  kind: "foreshadow";
  volumeId: string;
  chapterId: string | null;
  title: string;
  note: string;
  status: "open" | "resolved";
}

export interface NovelTemplateBook {
  workId: string;
  workName: string;
  volumes: TemplateVolume[];
  chapters: TemplateChapter[];
  entities: TemplateEntity[];
  links: TemplateLink[];
  levelSystems: TemplateLevelSystem[];
  notes: TemplateNote[];
  outlineEntries: TemplateOutlineEntry[];
}

// ── 确定性伪随机（mulberry32）：模板生成不依赖 Math.random / Date.now ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 固定要素设定（名称 / 别名会被织入正文） ──

const CHARACTERS = [
  {
    id: "tpl-e-char-shen",
    type: "character",
    name: "沈青梧",
    aliases: ["阿梧", "青梧姑娘"],
    summary: "雾隐城出身的年轻执灯人，能听懂残卷低语。",
    fields: { 性格: "沉静 · 重诺 · 记仇", 出身: "雾隐城南巷", 佩剑: "未名" },
  },
  {
    id: "tpl-e-char-lu",
    type: "character",
    name: "陆行舟",
    aliases: ["陆师兄", "行舟"],
    summary: "天衡阁内门弟子，剑法端正，唯独不信命。",
    fields: { 性格: "爽朗 · 好胜", 出身: "临江陆氏", 佩剑: "听澜" },
  },
  {
    id: "tpl-e-char-bai",
    type: "character",
    name: "白芷",
    aliases: ["小芷"],
    summary: "药谷末代传人，随身照影灯便是她点亮的。",
    fields: { 性格: "温软 · 嘴硬", 出身: "药谷", 佩剑: "无" },
  },
];

const LOCATIONS = [
  {
    id: "tpl-e-loc-wuyin",
    type: "location",
    name: "雾隐城",
    aliases: ["雾城"],
    summary: "常年被海雾吞没的港城，城中禁燃明火。",
    fields: { 方位: "东海之滨", 领主: "沉氏", 特产: "雾盐" },
  },
  {
    id: "tpl-e-loc-guanxing",
    type: "location",
    name: "观星台",
    aliases: ["星台"],
    summary: "天衡阁占验潮汐的九层高台，顶上悬着一面无字碑。",
    fields: { 方位: "雾隐城北郊", 领主: "天衡阁", 特产: "星砂" },
  },
];

const FACTIONS = [
  {
    id: "tpl-e-fac-tianheng",
    type: "faction",
    name: "天衡阁",
    aliases: ["天衡"],
    summary: "以衡天下气运自居的修行宗门，观星台是其祖地。",
    fields: { 立场: "名门正道", 驻地: "观星台", 首座: "玄衡真人" },
  },
  {
    id: "tpl-e-fac-canglan",
    type: "faction",
    name: "沧澜会",
    aliases: ["沧澜"],
    summary: "盘踞东海商路的散修联盟，明面上做走私，暗地里收留逃人。",
    fields: { 立场: "灰色", 驻地: "浮玉港", 首座: "刀七娘" },
  },
];

const ITEMS = [
  {
    id: "tpl-e-item-zhaoying",
    type: "item",
    name: "照影灯",
    aliases: ["引魂灯"],
    summary: "能照出执灯人记忆的青铜古灯，灯芯是一截白发。",
    fields: { 品阶: "灵器", 材质: "青铜", 来历: "不明" },
  },
  {
    id: "tpl-e-item-canjuan",
    type: "item",
    name: "山海残卷",
    aliases: ["残卷"],
    summary: "记载失落山海界的一叠残页，遇潮显字。",
    fields: { 品阶: "仙器（残）", 材质: "鲸皮纸", 来历: "山海界" },
  },
];

/** level_system 类型的要素卡（与 novel_level_systems 表的同名体系互为表里） */
const LEVEL_SYSTEM_ENTITIES = [
  {
    id: "tpl-e-sys-lingtu",
    type: "level_system",
    name: "灵徒九境",
    aliases: ["九境"],
    summary: "东海修行界通行的境界划分，自引气至登仙共九境。",
    fields: { 体系: "修行境界", 通行地: "东海", 阶数: "九境" },
  },
];

const CUSTOM_ENTITIES = [
  {
    id: "tpl-e-custom-calendar",
    type: "custom",
    name: "山海历法",
    aliases: [],
    summary: "以潮汐涨落纪年的古历，一年三百六十潮。",
    fields: { 类别: "设定", 起源: "山海界", 纪年: "潮历" },
  },
];

// ── 句库：{c1}/{c2}/{loc}/{fac}/{item}/{alias} 等占位符由生成器填充 ──

const NARRATION = [
  "海雾从{loc}的缺口涌进来，{c1}把{item}往袖中收了收，灯焰在雾气里缩成一粒豆大的青色。",
  "{fac}的巡夜弟子打着灯笼走过长街，靴声被潮水浸得发闷，谁也没有抬头看屋脊上蹲着的人影。",
  "{c2}按剑立在{loc}的石阶下，剑穗上的铜铃一动不动——他不喜欢{loc}，却不得不承认这里适合藏人。",
  "潮历三百年秋，{loc}的雾比往年更重，老人们说这是{fac}要动气运的前兆。",
  "{item}在匣子里轻轻发烫，{c1}数到第七次心跳时，终于伸手掀开了盖子。",
  "残卷摊开在案上，遇潮显出的字迹正一笔一笔褪去，{c1}抄写的速度赶不上遗忘的速度。",
  "{fac}的钟声从{loc}方向传来，九响，意味着九境以上的修士可以入城了。",
  "{c1}想起{alias}这个称呼还是三年前的事，那时她还没有学会把情绪藏进袖子里。",
  "{c2}把{item}递过来的时候说，东西可以借，命不行——他一贯把丑话说在前面。",
  "{loc}的集市在退潮后才开张，卖雾盐的、卖星砂的、卖假符的，挤在同一条湿漉漉的巷子里。",
  "风从海上来，卷着咸腥气掠过{fac}的旗幡，旗面上的衡字被吹得变了形。",
  "{c1}在心中默数灵徒九境的口诀，从引气到凝元，一遍一遍，像溺水的人数自己的呼吸。",
  "{item}的光透过窗纸，在墙上投出细碎的影子，像有人用指甲一笔一划刻出来的字。",
  "{fac}的赏格贴满了{loc}四门，画像上的女子眉眼模糊，唯有锁骨处的旧疤画得极其认真。",
  "{c2}说{fac}的规矩是衡，可他见过的衡从来都是偏向高处的，像水往低处流一样自然。",
  "夜潮涨到第三级，{loc}的更夫敲响了哑鼓，这是全城禁火的信号。",
  "{c1}把{item}的灯芯拨亮了一分，白发燃烧的气味混进雾里，像雪落在铁上。",
  "山海残卷的下一页迟迟不肯显字，{c1}忽然明白，不是纸在选人，是人在选自己敢不敢看。",
  "{loc}的城墙是用沉船的龙骨垒的，涨潮时整座城会发出极低的嗡鸣，像一头睡着的兽。",
  "{fac}来了三个人，为首的老者袖口绣着九境云纹，走路时脚下不沾一粒星砂。",
];

const DIALOGUE = [
  "「你若再往前一步，」{c2}按住剑柄，「我就当{fac}的规矩不存在。」",
  "「{item}不是灯，」{c1}低声说，「是有人把自己的名字留在了里面。」",
  "「{loc}禁火，」更夫缩着脖子说，「可你们这些修士，哪个袖子里没有火。」",
  "「我不信命，」{c2}笑了笑，「但我信你，{alias}。」",
  "「把残卷还回来，」来人的声音隔着雾传过来，「{fac}可以当什么都没发生。」",
  "「小芷说过，」{c1}望着灯焰，「药能医伤，医不了选择。」",
  "「九境又如何，」{c2}擦去剑上的雾水，「天上仙人排队来，我一个一个见。」",
  "「你数过{loc}的钟声吗，」{c1}问，「九响之后，还有第十响，只是没人敢听。」",
];

const CLOSING = [
  "雾更深了，{c1}吹熄{item}，把自己交还给黑暗。",
  "潮水漫过台阶的第一级，这一夜，{loc}没有人睡得安稳。",
  "{c2}转身走进雾里，背影很快被吞没，仿佛从未出现过。",
  "残卷在匣中轻轻一颤，像是应答，又像是叹息。",
];

const PARAGRAPH_LEAD = [
  "潮历年间，",
  "雾隐城志有载，",
  "旧卷第十三页写着，",
  "天衡阁的档案里，",
  "沧澜会私下流传，",
];

// ── 章节骨架：卷名 / 章名 / 梗概（15 章） ──

const VOLUME_DEFS: Array<{ name: string; chapters: Array<{ title: string; note: string }> }> = [
  {
    name: "雾隐城卷 · 灯下人",
    chapters: [
      { title: "雾起南巷", note: "照影灯认主，沈青梧第一次听见残卷低语；陆行舟奉命入城，两人初遇即互相试探。" },
      { title: "禁火之夜", note: "哑鼓三通，全城禁火；白芷违令点灯救人，与沈青梧结缘。" },
      { title: "雾盐市易", note: "退潮集市上以星砂换残页，沧澜会的刀七娘首次露面。" },
      { title: "观星台钟", note: "天衡阁九响钟后起了第十响，玄衡真人封锁北郊。" },
      { title: "灯芯白发", note: "照影灯照出执灯人记忆，沈青梧看见雾隐城建立前的海。" },
    ],
  },
  {
    name: "沧澜卷 · 浮玉渡",
    chapters: [
      { title: "浮玉港", note: "三人投奔沧澜会，发现赏格画像上的疤是伪造的。" },
      { title: "刀七娘的秤", note: "刀七娘以秤衡人心，陆行舟以剑破局，谈成三成利。" },
      { title: "沉船龙骨", note: "城墙嗡鸣之谜揭开：龙骨中封着上一代执灯人。" },
      { title: "潮汐信约", note: "与沧澜会立潮汐之约，残卷首次整页显字。" },
      { title: "雾中截杀", note: "天衡阁截杀，白芷重伤，照影灯灯芯燃去一寸。" },
    ],
  },
  {
    name: "山海卷 · 残页志",
    chapters: [
      { title: "无字碑", note: "观星台无字碑在雷夜显字，指向山海界入口。" },
      { title: "九境之上", note: "玄衡真人力主封碑，与陆行舟当众对质。" },
      { title: "灯影重重", note: "照影灯连续照影三人，记忆开始互相渗透。" },
      { title: "残卷成约", note: "山海残卷认主，潮汐历法与人间历法重合之夜逼近。" },
      { title: "启程之潮", note: "大潮之夜启程，雾隐城全城送灯；卷末留白，山海路始。" },
    ],
  },
];

const FORESHADOWS: Array<{
  id: string;
  title: string;
  note: string;
  status: "open" | "resolved";
  volumeIndex: number;
  chapterIndex: number | null;
}> = [
  { id: "tpl-f-1", title: "第十响钟声", note: "第九响之后还有第十响，钟为谁而鸣尚未揭晓——疑与山海界有关。", status: "open", volumeIndex: 1, chapterIndex: 3 },
  { id: "tpl-f-2", title: "灯芯上的白发", note: "灯芯是一截白发，属于上一代执灯人；燃尽之日即照影失效之日。", status: "open", volumeIndex: 2, chapterIndex: 0 },
  { id: "tpl-f-3", title: "赏格画像的疤", note: "画像上的旧疤是伪造的，幕后有人刻意混淆视线。", status: "resolved", volumeIndex: 1, chapterIndex: 0 },
  { id: "tpl-f-4", title: "潮汐历法重合之夜", note: "潮历与人间历每六十年重合一次，重合之夜山海相通。", status: "open", volumeIndex: 2, chapterIndex: null },
];

const NOTE_SEEDS: Array<{ id: string; content: string; pinned: boolean; foreshadowId: string | null }> = [
  { id: "tpl-n-1", content: "残卷显字需要海水温度低于某个阈值——冬天写作素材，去码头实地看看。", pinned: true, foreshadowId: null },
  { id: "tpl-n-2", content: "刀七娘的秤是前朝衡器，刻着「衡人不衡物」，可以写进她的前史。", pinned: false, foreshadowId: null },
  { id: "tpl-n-3", content: "雾隐城禁火的真正原因可能是：整座城本身是一件封印法器。", pinned: false, foreshadowId: "tpl-f-4" },
  { id: "tpl-n-4", content: "陆行舟的剑穗铜铃从不响，除非他说谎——中期反转可以用。", pinned: false, foreshadowId: null },
  { id: "tpl-n-5", content: "白芷的药谷传承里缺最后一味主药，主药就是照影灯烧掉的记忆。", pinned: false, foreshadowId: null },
];

const WORK_NAME = "山海拾遗（模板示例）";

// ── 生成器 ──

/** 填充句库占位符；alias 单独传入以覆盖别名织入 */
function fillSentence(
  template: string,
  cast: {
    c1: string;
    c2: string;
    c1Alias: string;
    loc: string;
    fac: string;
    item: string;
  },
): string {
  return template
    .replaceAll("{c1}", cast.c1)
    .replaceAll("{c2}", cast.c2)
    .replaceAll("{alias}", cast.c1Alias)
    .replaceAll("{loc}", cast.loc)
    .replaceAll("{fac}", cast.fac)
    .replaceAll("{item}", cast.item);
}

/** 生成单章正文：非空白字符数 ≥ minWords（含标点口径近似值） */
function buildChapterContent(chapterIndex: number, minWords: number): string {
  const rand = mulberry32(0x9e3779b9 ^ (chapterIndex * 2654435761));
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];

  const c1 = CHARACTERS[chapterIndex % CHARACTERS.length];
  const c2 = CHARACTERS[(chapterIndex + 1) % CHARACTERS.length];
  const loc = LOCATIONS[chapterIndex % LOCATIONS.length];
  const fac = FACTIONS[chapterIndex % FACTIONS.length];
  const item = ITEMS[chapterIndex % ITEMS.length];
  const cast = {
    c1: c1.name,
    c2: c2.name,
    c1Alias: c1.aliases[0] ?? c1.name,
    loc: loc.name,
    fac: fac.name,
    item: item.name,
  };

  const paragraphs: string[] = [];
  let words = 0;
  let sentenceCursor = chapterIndex % NARRATION.length;
  let dialogueCursor = chapterIndex % DIALOGUE.length;

  // 起手段固定织入全部六类要素名，保证每一章都能触发标注高亮
  paragraphs.push(
    `${fillSentence(
      "{loc}的雾里，{c1}提着{item}站在巷口，{fac}的钟声隔着海面传来；{c2}按剑而立，谁都没有先开口。",
      cast,
    )}`,
  );
  words += paragraphs[0].replace(/\s/g, "").length;

  while (words < minWords) {
    const parts: string[] = [];
    // 段首偶发引经据典式短lead，增强「小说感」
    if (rand() < 0.25) parts.push(pick(PARAGRAPH_LEAD));
    const sentenceCount = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < sentenceCount; i += 1) {
      // 每段固定掺入对话与叙述，比例约 1:3
      if (i === 0 && rand() < 0.75) {
        parts.push(fillSentence(DIALOGUE[dialogueCursor % DIALOGUE.length], cast));
        dialogueCursor += 1;
      } else {
        parts.push(fillSentence(NARRATION[sentenceCursor % NARRATION.length], cast));
        sentenceCursor += 1;
      }
    }
    const paragraph = parts.join("");
    paragraphs.push(paragraph);
    words += paragraph.replace(/\s/g, "").length;
  }

  paragraphs.push(fillSentence(pick(CLOSING), cast));
  return `${paragraphs.join("\n")}\n`;
}

/** 非空白字符数（与「含标点」字数口径近似，供 word_count 落库） */
function countWords(content: string): number {
  return content.replace(/\s/g, "").length;
}

/**
 * 构建模板书籍全量种子数据（纯函数、确定性，可直接单测）。
 * 每章正文 ≥ minWordsPerChapter 字（非空白字符口径），默认 3200。
 */
export function buildNovelTemplateBook(minWordsPerChapter = 3200): NovelTemplateBook {
  const workId = "tpl-w";
  const volumes: TemplateVolume[] = [];
  const chapters: TemplateChapter[] = [];

  let chapterSort = 0;
  let globalChapterIndex = 0;
  VOLUME_DEFS.forEach((volumeDef, volumeIndex) => {
    const volumeId = `tpl-v${volumeIndex + 1}`;
    volumes.push({ id: volumeId, name: volumeDef.name, sort: volumeIndex + 1 });

    volumeDef.chapters.forEach((chapterDef, chapterIndexInVolume) => {
      chapterSort += 1;
      const content = buildChapterContent(globalChapterIndex, minWordsPerChapter);
      chapters.push({
        id: `tpl-c${volumeIndex + 1}-${chapterIndexInVolume + 1}`,
        volumeId,
        title: chapterDef.title,
        content,
        wordCount: countWords(content),
        // 第一卷全部完稿，第二卷前两章完稿，其余草稿（覆盖状态徽标与过滤）
        status: volumeIndex === 0 || (volumeIndex === 1 && chapterIndexInVolume < 2) ? "done" : "draft",
        sort: chapterSort,
        outlineNote: chapterDef.note,
      });
      globalChapterIndex += 1;
    });
  });

  const entities: TemplateEntity[] = [
    ...CHARACTERS,
    ...LOCATIONS,
    ...FACTIONS,
    ...ITEMS,
    ...LEVEL_SYSTEM_ENTITIES,
    ...CUSTOM_ENTITIES,
  ].map((entity, index) => ({
    ...entity,
    content: `${entity.summary}\n\n（模板示例资料卡：此处可沉淀该要素的完整设定、出场回顾与私设备忘。）`,
    sort: index + 1,
  }));

  const links: TemplateLink[] = [
    { id: "tpl-l-1", fromType: "character", fromId: "tpl-e-char-shen", toType: "character", toId: "tpl-e-char-lu", relation: "亦敌亦友" },
    { id: "tpl-l-2", fromType: "character", fromId: "tpl-e-char-shen", toType: "character", toId: "tpl-e-char-bai", relation: "挚友" },
    { id: "tpl-l-3", fromType: "character", fromId: "tpl-e-char-lu", toType: "faction", toId: "tpl-e-fac-tianheng", relation: "内门弟子" },
    { id: "tpl-l-4", fromType: "character", fromId: "tpl-e-char-shen", toType: "location", toId: "tpl-e-loc-wuyin", relation: "出生地" },
    { id: "tpl-l-5", fromType: "item", fromId: "tpl-e-item-zhaoying", toType: "character", toId: "tpl-e-char-bai", relation: "持有" },
    { id: "tpl-l-6", fromType: "item", fromId: "tpl-e-item-canjuan", toType: "character", toId: "tpl-e-char-shen", relation: "认主" },
    { id: "tpl-l-7", fromType: "faction", fromId: "tpl-e-fac-tianheng", toType: "location", toId: "tpl-e-loc-guanxing", relation: "驻地" },
    { id: "tpl-l-8", fromType: "faction", fromId: "tpl-e-fac-canglan", toType: "location", toId: "tpl-e-loc-wuyin", relation: "走私通路" },
  ];

  const levelSystems: TemplateLevelSystem[] = [
    {
      id: "tpl-ls-lingtu",
      name: "灵徒九境",
      rungs: [
        { id: "tpl-lr-1", name: "引气", rank: 1, note: "初入修行，引气入体" },
        { id: "tpl-lr-2", name: "聚元", rank: 2 },
        { id: "tpl-lr-3", name: "通脉", rank: 3 },
        { id: "tpl-lr-4", name: "凝丹", rank: 4 },
        { id: "tpl-lr-5", name: "碎虚", rank: 5 },
        { id: "tpl-lr-6", name: "化神", rank: 6 },
        { id: "tpl-lr-7", name: "渡劫", rank: 7 },
        { id: "tpl-lr-8", name: "大乘", rank: 8 },
        { id: "tpl-lr-9", name: "登仙", rank: 9, note: "传说之境，东海无人抵达" },
      ],
    },
    {
      id: "tpl-ls-qijie",
      name: "器阶七品",
      rungs: [
        { id: "tpl-lq-1", name: "凡器", rank: 1 },
        { id: "tpl-lq-2", name: "良器", rank: 2 },
        { id: "tpl-lq-3", name: "珍器", rank: 3 },
        { id: "tpl-lq-4", name: "宝器", rank: 4 },
        { id: "tpl-lq-5", name: "灵器", rank: 5, note: "照影灯在列" },
        { id: "tpl-lq-6", name: "仙器", rank: 6 },
        { id: "tpl-lq-7", name: "神器", rank: 7 },
      ],
    },
  ];

  const notes: TemplateNote[] = NOTE_SEEDS.map((note) => ({ ...note }));

  const outlineEntries: TemplateOutlineEntry[] = FORESHADOWS.map((entry) => {
    const volume = volumes[entry.volumeIndex];
    const volumeChapters = chapters.filter((chapter) => chapter.volumeId === volume.id);
    return {
      id: entry.id,
      kind: "foreshadow" as const,
      volumeId: volume.id,
      chapterId:
        entry.chapterIndex === null ? null : volumeChapters[entry.chapterIndex]?.id ?? null,
      title: entry.title,
      note: entry.note,
      status: entry.status,
    };
  });

  return {
    workId,
    workName: WORK_NAME,
    volumes,
    chapters,
    entities,
    links,
    levelSystems,
    notes,
    outlineEntries,
  };
}
