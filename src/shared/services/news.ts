/**
 * 60s API 数据层（shared：HomePage 探活 + NewsPage 展示共用）。
 *
 * 走主进程 httpRequest 转发防 CORS（electron/main.ts 'http-request'）。
 * 数据源文档：https://docs.60s-api.viki.moe（开源免费聚合 API）
 *   - GET /v2/60s  每天 60 秒读懂世界（日更要闻，纯文本标题数组）
 *   - GET /v2/moyu 摸鱼日报（进度 / 假期 / 一言 / 农历）
 */

/** 资讯条数上限（业务约束：今日热点不超过十条） */
export const MAX_NEWS = 10;

const DAILY_60S_URL = "https://60s.viki.moe/v2/60s";
const MOYU_URL = "https://60s.viki.moe/v2/moyu";

/** 单条热点资讯 */
export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  /** 来源（媒体 / 平台名） */
  source: string;
  /** 展示用时间 "HH:mm" */
  time: string;
  /** 热度 0-100，用于排序与热度标识 */
  heat: number;
}

/**
 * 兜底样例资讯（heat 降序即展示序），API 失败时使用。
 * 数据层被 shared 层共用：HomePage 只关心 live 标识，不消费样例内容。
 */
export const SAMPLE_NEWS: readonly NewsItem[] = [
  {
    id: "n01",
    title: "开源大模型推理成本再降八成，端侧部署成为新战场",
    summary:
      "多家团队同日发布低比特量化方案，消费级显卡即可流畅运行百亿参数模型，端侧 AI 生态加速成型。",
    source: "科技早知道",
    time: "08:45",
    heat: 98,
  },
  {
    id: "n02",
    title: "智能体（Agent）标准协议草案发布，跨厂商工具调用有望互通",
    summary:
      "草案定义了工具注册、权限与上下文传递规范，头部框架均已表态跟进，碎片化生态或迎统一。",
    source: "开发者头条",
    time: "09:12",
    heat: 95,
  },
  {
    id: "n03",
    title: "国产操作系统新版本发布：AI 助手全面内置，支持离线语音",
    summary:
      "系统级 AI 助手可本地完成摘要、翻译与日程整理，隐私数据不出设备，兼容主流国产芯片。",
    source: "每日 IT 新闻",
    time: "09:38",
    heat: 91,
  },
  {
    id: "n04",
    title: "Rust 进入 Linux 内核又一里程碑：核心子系统完成重写",
    summary:
      "内存安全问题引发的重写收尾，维护者称崩溃率显著下降，社区讨论下一个候选子系统。",
    source: "InfoQ",
    time: "10:05",
    heat: 88,
  },
  {
    id: "n05",
    title: "WebGPU 在主流浏览器全量可用，浏览器端训练模型成为可能",
    summary:
      "计算着色器性能逼近原生，已有团队在浏览器内完成小型模型微调，前端算力天花板被抬升。",
    source: "前端之巅",
    time: "10:41",
    heat: 84,
  },
  {
    id: "n06",
    title: "研究显示：AI 结对编程使新人上手周期缩短近一半",
    summary:
      "对照实验覆盖 1200 名工程师，新人首个独立交付周期中位数由 6.2 周降至 3.4 周。",
    source: "技术雷达",
    time: "11:20",
    heat: 79,
  },
  {
    id: "n07",
    title: "电子纸显示突破彩色刷新率瓶颈，量产日程首次公开",
    summary:
      "新一代彩色电子纸刷新率提升至原来的 3 倍，量产机型预计明年面世，主打办公墨水屏。",
    source: "极客公园",
    time: "13:02",
    heat: 75,
  },
  {
    id: "n08",
    title: "开源社区推出本地优先同步引擎，离线应用开发范式升级",
    summary:
      "CRDT 方案进一步降低冲突处理成本，与主流前端框架绑定良好，Star 数一周破万。",
    source: "GitHub Daily",
    time: "14:15",
    heat: 71,
  },
  {
    id: "n09",
    title: "桌面端 AI 剪辑工具实测：口播改稿像改文档一样简单",
    summary:
      "按文字编辑即可增删镜头与转场，中文语音对齐准确率达 98%，创作者工作流被重构。",
    source: "少数派",
    time: "15:30",
    heat: 66,
  },
  {
    id: "n10",
    title: "程序员健康报告发布：久坐与晚睡仍是两大顽疾",
    summary:
      "样本 3 万人，规律使用提醒工具的开发者颈椎不适比例低 27%，番茄钟使用率创新高。",
    source: "掘金一周",
    time: "16:48",
    heat: 60,
  },
];

/* ───────────────────────── 60s API 接入 ───────────────────────── */

/** 60s API /v2/60s 响应结构（只声明本服务用到的字段） */
export interface Daily60sData {
  /** 数据日期 "2026-09-18" */
  date?: string;
  /** 当日要闻标题数组（纯文本） */
  news?: string[];
  /** 编辑推荐一句话 */
  tip?: string;
  /** 数据更新时间，如 "2026/09/18 07:49" */
  created?: string;
}

/** 单项进度（周 / 月 / 年） */
export interface ProgressItem {
  passed: number;
  total: number;
  remaining: number;
  percentage: number;
}

/** 60s API /v2/moyu 响应结构（只声明本服务用到的字段） */
export interface MoyuData {
  date?: {
    lunar?: { monthCN?: string; dayCN?: string };
  };
  today?: {
    isWeekend?: boolean;
    isHoliday?: boolean;
    isWorkday?: boolean;
    holidayName?: string;
  };
  progress?: Partial<Record<"week" | "month" | "year", Partial<ProgressItem>>>;
  moyuQuote?: string;
}

/** NewsPage 数据载荷：null 字段 = API 未提供（UI 用本地兜底） */
export interface DailyNewsPayload {
  items: NewsItem[];
  /** 60s 端点是否成功返回真实数据（false = 已回退本地样例） */
  live: boolean;
  /** 右栏语录（60s.tip → moyu.moyuQuote），null 时 UI 走本地轮换语录 */
  quote: string | null;
  /** 周 / 月 / 年进度，整体 null = API 未提供（UI 隐藏） */
  progress: {
    week: ProgressItem | null;
    month: ProgressItem | null;
    year: ProgressItem | null;
  } | null;
  /** 是否工作日：null = API 未提供（UI 按周末本地推断） */
  workday: boolean | null;
  /** 农历文本（如 "八月初八"）：null = API 未提供（UI 用本地计算） */
  lunarText: string | null;
}

type HttpRequestFn = (options: { url: string }) => Promise<{
  status: number;
  data: unknown;
}>;

/** 取主进程 httpRequest 桥（jsdom / 无 electron 环境为 undefined） */
function getHttpBridge(): HttpRequestFn | undefined {
  const api = (
    globalThis as { electronAPI?: { httpRequest?: HttpRequestFn } }
  ).electronAPI;
  return typeof api?.httpRequest === "function" ? api.httpRequest : undefined;
}

/** 60s API 响应统一为 {code, data} 包裹：剥壳并校验 code，兼容裸数据 */
function pickPayload(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in body) {
    const b = body as { code?: unknown; data?: unknown };
    if (b.code !== undefined && b.code !== 200) return undefined;
    return b.data;
  }
  return body;
}

/** settled 结果 → 响应体数据；请求失败 / HTTP 非 2xx 均视为无效 */
function settledToData(
  settled: PromiseSettledResult<{ status: number; data: unknown }>,
): unknown {
  if (settled.status !== "fulfilled") return undefined;
  const { status, data } = settled.value ?? {};
  if (typeof status !== "number" || status < 200 || status >= 300) {
    return undefined;
  }
  return pickPayload(data);
}

/** 从 "2026/09/18 07:49" 提取 "07:49"；无时间信息返回空串 */
function extractTime(created: string | undefined): string {
  const m = /(\d{1,2}):(\d{2})/.exec(created ?? "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

function isProgressItem(v: unknown): v is ProgressItem {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<ProgressItem>;
  return (
    typeof p.passed === "number" &&
    typeof p.total === "number" &&
    typeof p.remaining === "number" &&
    typeof p.percentage === "number"
  );
}

/**
 * 将 60s API 标题数组映射为 NewsItem（输入顺序即热度顺序）。
 * API 仅提供标题，无摘要 / 来源 / 热度：summary 置空（UI 不渲染）、
 * source 统一为数据源名、heat 按序号线性衰减以保留前三热度标识。
 */
export function mapDaily60s(data: Daily60sData): NewsItem[] {
  const titles = Array.isArray(data.news)
    ? data.news.filter((t) => typeof t === "string" && t.trim().length > 0)
    : [];
  const time = extractTime(data.created);
  return titles.slice(0, MAX_NEWS).map((raw, i) => ({
    id: `d60s-${i + 1}`,
    title: raw.trim(),
    summary: "",
    source: "60s 读懂世界",
    time,
    heat: Math.max(30, 100 - i * 5),
  }));
}

/** API 不可达 / 无桥环境时的本地兜底载荷（语录由 UI 层兜底） */
function buildLocalPayload(): DailyNewsPayload {
  return {
    items: [...SAMPLE_NEWS].sort((a, b) => b.heat - a.heat).slice(0, MAX_NEWS),
    live: false,
    quote: null,
    progress: null,
    workday: null,
    lunarText: null,
  };
}

/**
 * 拉取今日数据：60s 读懂世界 + 摸鱼日报双端点并发。
 * 任一端点失败均不影响另一端点；全部失败时回退本地样例，页面不空。
 * live 标识 60s 端点是否成功（HomePage 以此决定是否展示报纸入口）。
 */
export async function fetchDailyNews(): Promise<DailyNewsPayload> {
  const bridge = getHttpBridge();
  if (!bridge) return buildLocalPayload();

  try {
    const [newsSettled, moyuSettled] = await Promise.allSettled([
      bridge({ url: DAILY_60S_URL }),
      bridge({ url: MOYU_URL }),
    ]);

    // 60s 读懂世界：成功映射真实数据，失败回退样例
    const newsData = settledToData(newsSettled) as Daily60sData | undefined;
    const newsOk =
      !!newsData && Array.isArray(newsData.news) && newsData.news.length > 0;
    const items = newsOk ? mapDaily60s(newsData) : buildLocalPayload().items;

    // 摸鱼日报：进度 / 工作日 / 农历 / 语录，全部可选
    const moyu = settledToData(moyuSettled) as MoyuData | undefined;
    const progressRaw = moyu?.progress;
    const progressOut = {
      week: isProgressItem(progressRaw?.week) ? progressRaw.week : null,
      month: isProgressItem(progressRaw?.month) ? progressRaw.month : null,
      year: isProgressItem(progressRaw?.year) ? progressRaw.year : null,
    };
    const hasProgress =
      progressOut.week || progressOut.month || progressOut.year;

    const lunarRaw = moyu?.date?.lunar;
    const lunarText =
      lunarRaw?.monthCN && lunarRaw?.dayCN
        ? `${lunarRaw.monthCN}${lunarRaw.dayCN}`
        : null;

    const todayStatus = moyu?.today;
    const workday =
      typeof todayStatus?.isWorkday === "boolean"
        ? todayStatus.isWorkday
        : todayStatus?.isHoliday === true
          ? false
          : null;

    const tip = newsData?.tip?.trim() ?? "";
    const moyuQuote = moyu?.moyuQuote?.trim() ?? "";

    return {
      items,
      live: newsOk,
      quote: tip || moyuQuote || null,
      progress: hasProgress ? progressOut : null,
      workday,
      lunarText,
    };
  } catch (err) {
    console.error("[NewsService] 60s API 拉取异常，使用本地兜底:", err);
    return buildLocalPayload();
  }
}
