/**
 * AI 上下文拼装（渲染进程侧，纯函数）
 *
 * 首版只服务「起名增强」，上下文是「一段描述 + 若干约束」，拼成一个
 * 清晰的系统提示词。将来润色 / 续写会在这里扩展「选中文本 + 人物/设定」的
 * 上下文拼装，但**本层仍然不 import novel** —— 那些数据由调用方以纯字符串
 * 传入（R-AI-03「调用方传上下文」的落点）。
 */

/** 起名请求的语义参数（由 NameGeneratorPanel 传入，本层不解释其业务含义） */
export interface NamingContext {
  /** 用户对名字的语义描述（如「清冷孤傲的剑修女侠」） */
  description: string;
  /** 名字类型（人名 / 地名 / 势力 / 物品 等） */
  kind?: string;
  /** 风格（仙侠 / 武侠 / 西幻 等） */
  style?: string;
  /** 性别倾向（男 / 女 / 中性） */
  gender?: string;
  /** 期望数量 */
  count: number;
  /** 需避开的名字（已用名，要求模型不要重复） */
  avoid?: string[];
}

/**
 * 把起名语义参数拼成系统提示词。
 * 返回 { system, prompt }，其中 prompt 是用户可见的描述主体。
 */
export function buildNamingPrompt(ctx: NamingContext): { system: string; prompt: string } {
  const constraints: string[] = [];
  if (ctx.kind) constraints.push(`名字类型：${ctx.kind}`);
  if (ctx.style) constraints.push(`风格：${ctx.style}`);
  if (ctx.gender) constraints.push(`性别倾向：${ctx.gender}`);

  const avoidLine =
    ctx.avoid && ctx.avoid.length > 0
      ? `\n- 不要与以下已用名字重复：${ctx.avoid.join("、")}`
      : "";

  const system =
    `你是一名小说起名助手，请根据用户描述生成贴合设定、有韵味的中文名字。` +
    (constraints.length > 0 ? `\n- ${constraints.join("\n- ")}` : "") +
    `\n- 每次只输出 ${ctx.count} 个名字，每行一个，不要编号、不要解释。` +
    avoidLine;

  return {
    system,
    prompt: ctx.description,
  };
}

/** 润色请求的语义参数（由右键菜单调用方传入，本层不解释其业务含义） */
export interface PolishContext {
  /** 选中的原文（待润色文本） */
  text: string;
}

/**
 * 把选中文本拼成润色提示词。
 * 返回 { system, prompt }，其中 prompt 是待润色的原文。
 */
export function buildPolishPrompt(ctx: PolishContext): { system: string; prompt: string } {
  const system =
    `你是一名小说文字润色助手。请对用户给出的文字进行润色，要求：` +
    `\n- 只润色措辞、句式和流畅度，不改变原意、不增删情节与信息；` +
    `\n- 保持原有的叙事视角、人称与风格基调；` +
    `\n- 直接输出润色后的文字，不要解释、不要加引号、不要编号；` +
    `\n- 输出长度应与原文相当，不要过度扩写。`;

  return {
    system,
    prompt: ctx.text,
  };
}
