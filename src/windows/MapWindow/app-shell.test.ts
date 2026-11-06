import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 地图窗口根组件守卫（源码级）：antd `<App>` 容器必须挂在窗口根上。
 *
 * 【为什么值一条守卫】antd 的 `AppContext` 默认值是
 * `{ message: {}, notification: {}, modal: {} }`（`antd/es/app/context.js`）——
 * 少了 `<App>` **不会**报"缺少 Provider"，而是给调用方三个空对象。于是
 * `message.success(...)` 抛 `TypeError`、`modal.confirm(...)` 同样抛，
 * 而抛出位置全在"写操作已经成功之后"的收尾语句里：
 *
 *   - 删除地图：`message.success` 抛 → `onConfirm` 的 promise reject →
 *     antd 的二次确认框（`ActionButton` 只在 resolve 时 close）既不收起，
 *     后面的 `load()` 也不执行 → 用户看到「点了没反应、列表不刷新」；
 *   - 画区/合并/清空/重建的 `modal.confirm` 抛 → 确认框根本不出现。
 *
 * 症状全在 UI 侧、错误只进 devtools，靠人眼回归很难发现（2.20.0 ~ 2.28.x
 * 一直坏着），所以在这里钉死。
 *
 * 书写禁忌同 `MapCanvas/render-stack-guard.test.ts`：不硬编码整行（格式化会拆行），
 * 读源码走 `path.resolve(process.cwd(), ...)`。
 */

const ROOT = path.resolve(process.cwd(), "src/windows/MapWindow/App.tsx");
/** CRLF 归一化：跨行断言前必须先做，否则 Windows 上必然假红 */
const SRC = readFileSync(ROOT, "utf8").replace(/\r\n/g, "\n");

describe("MapWindow 根组件", () => {
  it("挂载 antd <App>，让 AntApp.useApp() 拿到真实的 message / modal", () => {
    // 具名导入：`App` 与项目里的 `App` 组件重名，历史写法统一别名为 AntApp
    expect(SRC).toMatch(/import\s*\{[^}]*\bApp as AntApp\b[^}]*\}\s*from\s*"antd"/);
    expect(SRC).toMatch(/<AntApp\b/);
  });

  it("App 容器裹住整个窗口壳（不是只包一块），且不额外插一层 div", () => {
    const appStart = SRC.indexOf("<AntApp");
    const shellStart = SRC.indexOf('className="window-shell"');
    expect(appStart).toBeGreaterThan(-1);
    expect(shellStart).toBeGreaterThan(appStart);

    // component={false}：不生成包裹节点，否则会打断 .window-shell__body 的
    // height:100% 链（画布靠它撑满），表现为"画布变矮 / 只剩一半高度"
    expect(SRC).toMatch(/<AntApp\s+component=\{false\}/);
  });
});
