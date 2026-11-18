/**
 * kit 出口：跨域通用段落。
 *
 * 判据（§8.3 判据 4 的可执行版）：**签名里不出现任何域的 ctx / payload 类型**。
 * 出现即属该域，写进 `domains/<域>/sections.ts`。
 */
export {
  chapterBlock,
  composePrompt,
  constraintBlock,
  jsonArrayFormat,
  kvBlock,
  outputBlock,
  requirementBlock,
  roleBlock,
} from "./sections";
