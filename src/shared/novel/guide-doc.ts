/**
 * 帮助中心文档数据（帮助中心与新手引导的**唯一内容源**）
 *
 * 为什么结构化成数据而不是直接内嵌 HTML：帮助中心要支持关键词检索，
 * 且必须和 Tour / 弱提示共用同一套动作描述（PRD 附录 B）。散在 JSX 里
 * 就搜不了，也保证不了同源。
 *
 * 改文案时必须同步两处：本文件、`guide-copy.ts`。
 * （早期另有一份 onboarding 原型 HTML，已随文档治理删除，不要再去找它——文案以本文件为准。）
 * 本文件不含 React，纯数据 + 检索纯函数。
 */

/** 快速上手六步（对应 Tour 的 6 步；第 5、6 步为可关闭的加分项） */
export interface HelpFlowStep {
  step: number;
  title: string;
  /** 一句话说清「点哪里」 */
  action: string;
}

/** 功能索引条目 */
export interface HelpEntry {
  term: string;
  desc: string;
}

/** 功能索引分区 */
export interface HelpSection {
  id: string;
  title: string;
  entries: HelpEntry[];
}

/** 常见问题 */
export interface HelpFaq {
  id: string;
  q: string;
  a: string;
}

export interface HelpDoc {
  flow: HelpFlowStep[];
  sections: HelpSection[];
  shortcuts: HelpEntry[];
  faq: HelpFaq[];
}

export const NOVEL_HELP_DOC: HelpDoc = {
  flow: [
    {
      step: 1,
      title: "新建小说",
      action: "书架顶栏点「新建作品」，只填一个书名，点「创建并开写」直接进编辑器。",
    },
    {
      step: 2,
      title: "新建卷与章节",
      action: "左栏底部点「新卷」「新章节」，点一下就建好，双击名字即可改名。",
    },
    {
      step: 3,
      title: "创建全书总设定",
      action: "Ctrl+Shift+S 打开设定中心，进「模板库」一键套用内置预设，灌完随便改。",
    },
    {
      step: 4,
      title: "行囊：主角状态盘点",
      action: "Ctrl+Shift+B 开行囊，管主角的境界、属性、装备、物品与技能。",
    },
    {
      step: 5,
      title: "写正文与右键菜单",
      action: "选中文字右键：记进行囊 / 新建资料卡（角色·地点·势力·物品）/ 绑定到现有资料卡。",
    },
    {
      step: 6,
      title: "跨作品复用设定",
      action:
        "书架顶栏「全局设定中心」维护跨书共享的体系；其它作品在设定中心「从全局库选择」即可引用，随全局自动同步。",
    },
  ],

  sections: [
    {
      id: "shelf",
      title: "作品与书架",
      entries: [
        {
          term: "新建作品",
          desc: "书架顶栏或网格尾卡「新建作品」；编辑器顶栏「作品管理」菜单里也有。",
        },
        { term: "导入书籍", desc: "顶栏「导入书籍」，支持 TXT / DOCX，自动切章。" },
        {
          term: "查找 / 整理",
          desc: "顶栏搜索框搜作品或灵感；下方筛选「连载中 / 已完稿」、排序、网格 / 列表切换。",
        },
      ],
    },
    {
      id: "chapter",
      title: "章节管理",
      entries: [
        {
          term: "新建卷 / 章",
          desc: "左栏底部「新卷」「新章节」；卷头悬浮「＋」向该卷加章；Ctrl+Enter 快速新建章。",
        },
        { term: "重命名", desc: "双击卷名 / 章名，回车保存。" },
        {
          term: "拖拽排序",
          desc: "章拖到章 = 同卷 / 跨卷重排；章拖到卷头 = 移入该卷；卷拖到卷 = 调卷序。默认弹确认框防误触。",
        },
        { term: "章节状态", desc: "章行左侧圆点点击切换 草稿 ⇄ 完稿。" },
        { term: "搜章节", desc: "左栏顶部搜索框（搜索时自动展开所有卷）。" },
        { term: "快速跳章", desc: "Ctrl+P 呼出跳章面板，↑↓ 选择、回车跳转。" },
        {
          term: "删除章节",
          desc: "悬停章行 → 删除图标 → 确认。连同快照不可恢复，删后自动跳到相邻章。",
        },
        {
          term: "删除卷",
          desc: "悬停卷头 → 删除图标 → 确认。连同卷下章节、快照与大纲条目不可恢复；激活章在被删卷内时自动跳到相邻卷。",
        },
      ],
    },
    {
      id: "setting",
      title: "设定中心（Ctrl+Shift+S）",
      entries: [
        {
          term: "设定分类",
          desc: "左栏新建（输入框回车）、拖拽排序、色点改色；重命名 / 删除在右侧卡片的「编辑 / 删除」按钮。",
        },
        {
          term: "等级序列",
          desc: "行间悬停出「＋ 在此插入」条；行尾「⋯」菜单：编辑 / 新增子层级 / 合并还原 / 删除。",
        },
        {
          term: "批量生成",
          desc: "右上角「批量生成」：逐行输入或按模板（如「第{n}阶」）一次生成最多 99 级。",
        },
        {
          term: "小层（小境界）",
          desc: "每阶可配小层数与命名模板；行下方挂小境界速览，点击复制名称。",
        },
        {
          term: "模板库",
          desc: "内置预设一键套用；自己的体系可「另存为模板」复用；支持导出 JSON / Markdown。",
        },
        {
          term: "联动",
          desc: "境界体系分类会联动角色卡与行囊：在这里改，两处即时同步。",
        },
      ],
    },
    {
      id: "global-setting",
      title: "全局设定中心（跨书共享）",
      entries: [
        {
          term: "打开入口",
          desc: "书架顶栏「全局设定中心」：独立窗口，维护跨作品共享的设定库（境界、品阶…）。",
        },
        {
          term: "从全局库选择",
          desc: "本书设定中心左栏「从全局库选择」→ 勾选分类 → 加入本书。引用后只读，改动随全局自动同步。",
        },
        {
          term: "放置到全局",
          desc: "本书某分类上「放置到全局」复制快照上架，供其它作品引用；同名时默认新建副本，本书内容不变。",
        },
        {
          term: "引用态与固化",
          desc: "引用项在本书侧只读（编辑入口收起），要改请到全局中心；原全局项被删时会就地转为本节副本，境界绑定不失效。",
        },
      ],
    },
    {
      id: "editor",
      title: "正文编辑",
      entries: [
        { term: "保存", desc: "自动保存 + Ctrl+S 手动保存。" },
        {
          term: "历史快照",
          desc: "顶栏「历史快照」：每章保留 20 版，可预览并回滚；回滚前会先把当前版存为快照。",
        },
        { term: "查找替换", desc: "Ctrl+F 编辑器内查找。" },
        {
          term: "标注层",
          desc: "底部状态条「标注 开 / 关」。开启时角色 / 地点 / 势力名高亮：单击开资料卡、悬停出速览。",
        },
        {
          term: "右键菜单",
          desc: "选中文字后右键：记入背包 / 新建资料卡（角色·地点·势力·物品）/ 绑定到现有资料卡。",
        },
        { term: "专注模式", desc: "F11 进入 / 退出，隐藏周边面板。" },
        { term: "今日目标", desc: "底部状态条设置今日目标字数，达成时轻提示不弹窗。" },
      ],
    },
    {
      id: "support",
      title: "右栏支撑面板",
      entries: [
        {
          term: "大纲",
          desc: "卷章骨架 + 每章「一句话梗概」+ 伏笔登记。点章节即跳转。",
        },
        {
          term: "要素",
          desc: "角色 / 地点 / 势力 / 物品资料卡：搜名称 / 别名 / 简介，可设主角、插入正文；齿轮图标管理自定义类型。",
        },
        {
          term: "灵感",
          desc: "速记本：Enter 记录、Shift+Enter 换行；可置顶、可「转为伏笔」写进大纲。",
        },
        { term: "检索", desc: "全书 / 本章 / 要素名三种范围查找正文。" },
        {
          term: "工具",
          desc: "起名器：按题材风格批量起名并避开本书已用名，可插入正文或直接建成角色卡。",
        },
      ],
    },
    {
      id: "pack",
      title: "行囊（Ctrl+Shift+B）",
      entries: [
        { term: "总属性汇总", desc: "基础值 → 总览值，增量按被动 / 持续分段，点行看来源明细。" },
        { term: "人物属性", desc: "自定义属性（攻击力 / 防御力…），可套用「通用 / 玄幻 / 网游」模板。" },
        { term: "属性映射", desc: "「加 1 点力量，血量 +100」这类换算关系记在这里。" },
        {
          term: "装备栏",
          desc: "自定义部位（名称、容量、仅接受某分组）；悬停候选可预览「装上后」属性变化。",
        },
        { term: "物品栏", desc: "背包清单：数量 ±、稀有度、分类、品阶（绑定设定体系后可标注）。" },
        { term: "技能栏", desc: "技能开关、熟练度档位、品阶标注。" },
        { term: "境界", desc: "阶梯点选 + ±1 层微调（满层自动进位）；与角色卡双读数对照。" },
        { term: "货币", desc: "自定义进制（默认 1 金 = 100 银 = 10000 铜），给个大数自动进位试算。" },
        { term: "状态效果", desc: "中毒 / 虚弱 / 阵法增益等 Buff / Debuff，持续型可随剧情开关。" },
        { term: "备注速记", desc: "作者自用的临时备忘。" },
        { term: "导出", desc: "各面板可「复制 / 下载 .txt / 插入本章末尾」。" },
      ],
    },
  ],

  shortcuts: [
    { term: "Ctrl+S", desc: "保存当前章节" },
    { term: "Ctrl+Shift+S", desc: "打开设定中心（注意和保存区分）" },
    { term: "Ctrl+Shift+B", desc: "打开 / 关闭行囊窗口" },
    { term: "Ctrl+P", desc: "章节快速跳转（再按一次关闭）" },
    { term: "Ctrl+Enter", desc: "新建章节" },
    { term: "Ctrl+F", desc: "编辑器内查找" },
    { term: "F11", desc: "专注模式" },
    { term: "Esc", desc: "按优先级关闭浮层：设定中心 → 排版偏好 → 历史快照 → 专注模式" },
    { term: "F1", desc: "打开帮助中心" },
  ],

  faq: [
    {
      id: "ctx-menu",
      q: "右键没有出现「记入背包 / 新建资料卡」菜单？",
      a: "这个菜单只在选中了文字后出现。空选区右键弹的是系统菜单。先用鼠标拖选一段文字，或双击选中一个词，再右键即可。",
    },
    {
      id: "click-name",
      q: "我只是点了下正文里的人名，为什么弹出了一张卡片？",
      a: "那是「标注层」：已建卡的角色 / 地点 / 势力名会自动高亮，单击高亮词打开资料卡，悬停出速览。如果觉得干扰，点底部状态条的「标注 开 / 关」整体关闭，关闭不影响任何数据。",
    },
    {
      id: "empty-editor",
      q: "新建了作品，正文区为什么是空的？",
      a: "新书还没有章节。点正文区的「写下第一章」按钮即可；也可以用左栏底部的「新章节」。新书还没有卷时，新建章节会自动建第一卷，不用提前规划结构。",
    },
    {
      id: "no-character-section",
      q: "设定中心里找不到「人物」「世界观」分区？",
      a: "设定中心管理的是全书通用的等级序列（境界、品阶这类阶梯），按「分类」组织。人物、地点等资料在正文右侧「要素」栏维护；世界观可以用自定义分类记录，也可以写进大纲与灵感。新手建议先从「模板库」套一条预设感受一下结构。",
    },
    {
      id: "volume-number",
      q: "改名后卷名变成「第一卷 · xxx」，能只显示自己起的名字吗？",
      a: "序号（第一卷）由排列顺序自动生成、始终保留，避免章节数多了以后乱序。这是刻意的：拖拽调序时序号会跟着变，方便对齐。",
    },
    {
      id: "drag-confirm",
      q: "拖动章节为什么弹出确认框？",
      a: "「防误触排序」默认开启：拖拽会改变章节序号，弹窗里列出了每一处「旧序号 → 新序号」，确认后才生效。不需要的话在「排版与偏好」里关掉。",
    },
    {
      id: "delete-chapter",
      q: "删掉的章节 / 卷还能找回吗？",
      a: "不能。删除章节会连同它的全部历史快照、删除卷会连同卷下章节、快照与大纲条目一起删除，均不可恢复。如果内容重要，先在编辑器里全选复制留存。行囊数据不受影响（独立保存）。",
    },
    {
      id: "no-gold",
      q: "行囊里怎么没有「金币余额」？",
      a: "行囊的货币模块是「换算器」而不是账本：你自己定义进制（默认 1 金 = 100 银 = 10000 铜），输入大数自动进位试算。金额本身写在正文里，由你掌控。",
    },
    {
      id: "pack-unsaved",
      q: "行囊提示「X 处改动未保存」，关窗会丢吗？",
      a: "不会静默丢。关窗时弹「有改动未保存」，可选「保存并继续 / 丢弃改动 / 取消」。即使丢弃，草稿也已持久化——打开头部「盘点记录」能找回上一次保存的版本。",
    },
    {
      id: "pack-realm",
      q: "行囊的境界模块提示「先建等级体系」？",
      a: "境界直接复用设定中心的等级序列。按 Ctrl+Shift+S 打开设定中心 → 「模板库」套一条（如「修仙 · 经典九层」）→ 回到行囊就能用了。行囊里的境界改动会同步到角色卡。",
    },
    {
      id: "shift-confusion",
      q: "保存（Ctrl+S）和设定中心（Ctrl+Shift+S）总按混？",
      a: "记法：带 Shift 的组合键都是「打开大面板」（设定中心、行囊），裸按 Ctrl+S 才是保存。另外 Esc 可以按优先级关闭浮层，打开错了随手 Esc 就行。",
    },
  ],
};

/** 检索结果条目 */
export interface HelpHit {
  kind: "flow" | "entry" | "shortcut" | "faq";
  /** 所属分区标题（flow / shortcut 为固定标题） */
  group: string;
  title: string;
  detail: string;
}

/**
 * 关键词检索：标题与正文都参与匹配，命中即返回。
 *
 * 大小写不敏感且忽略空格，便于作者直接粘贴快捷键「Ctrl + Shift + S」也能搜到。
 * 空关键词返回空数组（不返回全部，避免首屏被刷满）。
 */
export function searchHelpDoc(doc: HelpDoc, keyword: string): HelpHit[] {
  const key = keyword.trim().replace(/\s+/g, "").toLowerCase();
  if (!key) return [];

  const hits: HelpHit[] = [];
  const match = (...fields: string[]): boolean =>
    fields.some((field) => field.replace(/\s+/g, "").toLowerCase().includes(key));

  for (const step of doc.flow) {
    if (match(step.title, step.action)) {
      hits.push({
        kind: "flow",
        group: "快速上手",
        title: `第 ${step.step} 步 · ${step.title}`,
        detail: step.action,
      });
    }
  }

  for (const section of doc.sections) {
    for (const entry of section.entries) {
      if (match(entry.term, entry.desc)) {
        hits.push({
          kind: "entry",
          group: section.title,
          title: entry.term,
          detail: entry.desc,
        });
      }
    }
  }

  for (const item of doc.shortcuts) {
    if (match(item.term, item.desc)) {
      hits.push({
        kind: "shortcut",
        group: "快捷键",
        title: item.term,
        detail: item.desc,
      });
    }
  }

  for (const item of doc.faq) {
    if (match(item.q, item.a)) {
      hits.push({ kind: "faq", group: "常见问题", title: item.q, detail: item.a });
    }
  }

  return hits;
}
