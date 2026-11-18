/**
 * 题库聚合出口。
 *
 * 按主题拆成多个 seed 文件，只在这里汇总：页面侧统一 `import { QUESTION_BANK }`，
 * 新增主题时改这一处即可，筛选与统计逻辑完全不用动。
 */
import type { InterviewQuestion } from "./interview-types";
import { SEED_AI } from "./interview-seed-ai";
import { SEED_ALGORITHM } from "./interview-seed-algorithm";
import { SEED_CLIENT } from "./interview-seed-client";
import { SEED_CODE_READING } from "./interview-seed-code-reading";
import { SEED_ELECTRON_PLUS } from "./interview-seed-electron-plus";
import { SEED_ENGINEERING } from "./interview-seed-engineering";
import { SEED_ENGINEERING_PLUS } from "./interview-seed-engineering-plus";
import { SEED_FRAMEWORK } from "./interview-seed-framework";
import { SEED_HTML_CSS } from "./interview-seed-html-css";
import { SEED_JS_TS } from "./interview-seed-js-ts";
import { SEED_NETWORK } from "./interview-seed-network";
import { SEED_REACT_PLUS } from "./interview-seed-react-plus";
import { SEED_RUNTIME } from "./interview-seed-runtime";
import { SEED_VIBE_CODING } from "./interview-seed-vibe";
import { SEED_VUE_COMPARE } from "./interview-seed-vue-compare";
import { SEED_WRITTEN } from "./interview-seed-written";
import { SEED_WRITTEN_PLUS } from "./interview-seed-written-plus";

export const QUESTION_BANK: readonly InterviewQuestion[] = [
  ...SEED_WRITTEN,
  ...SEED_WRITTEN_PLUS,
  ...SEED_ALGORITHM,
  ...SEED_HTML_CSS,
  ...SEED_JS_TS,
  ...SEED_FRAMEWORK,
  ...SEED_REACT_PLUS,
  ...SEED_VUE_COMPARE,
  ...SEED_CODE_READING,
  ...SEED_RUNTIME,
  ...SEED_ELECTRON_PLUS,
  ...SEED_CLIENT,
  ...SEED_NETWORK,
  ...SEED_ENGINEERING,
  ...SEED_ENGINEERING_PLUS,
  ...SEED_AI,
  ...SEED_VIBE_CODING,
];

/**
 * 基线题按 id 索引（`id` 在基线里唯一，由 `interview-bank.test.ts` 守着）。
 *
 * 【为什么必须有这张表】
 * 「改基线题」要带 `baseHash` = **基线原题**的指纹，合并函数据此判断「新版有没有
 * 动过这题」。合并后的题目对象是**用户版本**，拿它算指纹永远对不上当前基线，
 * 结果是每次合并都误报「基线已更新」并且再也消不掉。所以写入路径必须能
 * 一步取到基线原对象；线性 `find` 在每次保存时扫 243 条也没问题，但
 * 「已隐藏的默认题」列表要按 id 取标题，索引表更直白。
 *
 * 只读：`QUESTION_BANK` 的成员是共享引用，改它等于改基线，任何写入都必须走
 * `interview.db` 的增量行。
 */
export const QUESTION_BY_ID: Readonly<Record<string, InterviewQuestion>> =
  Object.fromEntries(QUESTION_BANK.map((question) => [question.id, question]));
