/**
 * REQ-063 守卫：AI 总开关关闭后，设置窗口里「AI 记录 / 用量与效果」两页消失，
 * 而「AI 配置」页**必须留下**。
 *
 * 为什么「AI 配置」一定要留下：开关就长在这一页上。若连它一起收掉，用户关掉
 * AI 之后就**再也开不回来**（唯一的入口和唯一的功能一起消失）—— 这是本条需求
 * 最容易写错的地方，所以单独钉一条正向断言。
 *
 * 为什么这两页可以卸载而 AI 配置页不行：AI 记录 / 用量是只读视图（读 `ai_log`
 * / `ai_event`），没有草稿态；AI 配置页有草稿态（改了一半的地址 / 模型 / Key，
 * 点保存才落库），切页或收页时卸载会静默丢掉填写内容（见 App.tsx 文件头）。
 *
 * 断言方式：`buildPages` 是纯函数（输入＝AI 是否该隐去），直接跑真实清单，
 * 比源码 grep 更能挡住「清了导航却还在渲染」这类半改。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPages } from "./settings-pages";

const ids = (aiHidden: boolean): string[] => buildPages(aiHidden).map((page) => page.id);

describe("设置窗口导航：AI 关闭后只剩「AI 配置」这一页 AI 相关（REQ-063）", () => {
  it("关闭 AI：AI 记录 / 用量不在清单里", () => {
    const visible = ids(true);
    expect(visible).not.toContain("ai-log");
    expect(visible).not.toContain("ai-usage");
  });

  it("关闭 AI：「AI 配置」必须在（否则用户再也开不回来）", () => {
    expect(ids(true)).toContain("ai");
  });

  it("开启 AI：三页齐备且顺序稳定（配置 → 记录 → 用量）", () => {
    const visible = ids(false);
    for (const id of ["ai", "ai-log", "ai-usage"]) {
      expect(visible, `${id} 缺席`).toContain(id);
    }
    expect(visible.indexOf("ai")).toBeLessThan(visible.indexOf("ai-log"));
    expect(visible.indexOf("ai-log")).toBeLessThan(visible.indexOf("ai-usage"));
  });

  it("非 AI 页不受开关影响（外观 / 个人资料 / 账号 / 诊断始终在）", () => {
    for (const aiHidden of [true, false]) {
      const visible = ids(aiHidden);
      for (const id of ["appearance", "profile", "account", "diagnostic"]) {
        expect(visible, `aiHidden=${aiHidden} 时 ${id} 消失了`).toContain(id);
      }
    }
  });

  it("两页是「从清单里消失」而不是标记成隐藏（清单＝导航与渲染的共同事实源）", () => {
    // 渲染与导航都来自同一个 buildPages：清单里没有 → 既不进导航、也不生成
    // .settings-page 节点。若改成「留在清单里再 display:none」，导航项会一起
    // 留下（SettingsNav 直接吃这份 items），等于没隐。
    const app = readFileSync(
      path.resolve(process.cwd(), "src/windows/SettingsWindow/App.tsx"),
      "utf8",
    );
    expect(app).toContain("pages.map((page) => (");
    expect(app).toContain("<SettingsNav groups={navGroups}");
    // 反向：不许用 is-hidden 表达「AI 关了」（is-hidden 只服务于「非当前页」）
    expect(app).not.toMatch(/ai-log[\s\S]{0,120}is-hidden/);

    // 清单本身也不许用「标记隐藏」的字段：缺席必须是「不在数组里」
    const list = readFileSync(
      path.resolve(process.cwd(), "src/windows/SettingsWindow/settings-pages.tsx"),
      "utf8",
    );
    expect(list).toContain("...(SHOW_AI && !aiHidden ? [AI_LOG_PAGE, AI_USAGE_PAGE] : [])");
    for (const page of buildPages(true)) {
      expect(Object.keys(page), `${page.id} 带了隐藏标记`).not.toContain("hidden");
    }
  });

  it("清单是随状态派生的（模块级常量会永远停留在一个值上）", () => {
    // 同一个模块连续调用两次得到不同结果 —— 说明它真的是纯函数、不再依赖
    // 模块级可变状态
    expect(ids(true)).not.toEqual(ids(false));
    expect(ids(true)).toEqual(ids(true));
  });
});
