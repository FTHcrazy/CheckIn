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
