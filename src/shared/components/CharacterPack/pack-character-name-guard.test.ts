import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 主角名的「单一事实源」守卫。
 *
 * 这一组钉死的是一个**同屏打架**的失效模式，而且它是纯静默的：
 *
 *   行囊头部的名字曾直接读 `doc.character.name`。而那一格是主进程播种时写死的
 *   字面量 `'主角'`，绑定了主角实体后并不会被更新 —— 真实名字（「陆长安」）
 *   在 `novel_entities.name` 里。于是右侧要素库显示「陆长安」、行囊头部显示
 *   「主角」，两边同时可见、谁也不报错。
 *
 * 修法是让主进程解析出 `displayName` 下发，并让改名走 IPC 落到实体上。
 * 这三条约束任意一条被改回去，bug 就复活，故在此以源码守卫长期钉住。
 *
 * 为什么只能钉源码：这些是**跨进程**的连线（渲染层 / 主进程 / preload），
 * better-sqlite3 按 Electron ABI 编译，vitest 的 node 进程加载不了，
 * 端到端跑不起来。同 `electron/novel-db-split.test.ts` 的做法。
 */

const root = resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  readFileSync(resolve(root, relative), "utf8").replace(/\r\n/g, "\n");

const HANDLERS = read("electron/handlers/novel-pack-handlers.ts");
const HOST = read("src/shared/components/CharacterPack/index.tsx");
const PANEL = read("src/shared/components/CharacterPack/hooks/usePackPanel.ts");
const PRELOAD = read("electron/preload.ts");
const ELECTRON_DTS = read("src/shared/types/electron.d.ts");

describe("主角名：以要素库实体为准", () => {
  it("主进程解析 displayName —— 绑定了实体就用实体名", () => {
    expect(HANDLERS).toMatch(/displayName/);
    // 解析函数必须真的查 novel_entities
    expect(HANDLERS).toMatch(/function readEntityName\(/);
    expect(HANDLERS).toMatch(/SELECT name FROM novel_entities WHERE id = \?/);
    // 未绑定时回退到行囊内那格，而不是留空
    expect(HANDLERS).toMatch(/displayName: entityName \|\| row\.name/);
  });

  it("行囊头部读 displayName，不再直接用 character.name", () => {
    // 正面：用 displayName（带回退链）
    expect(HOST).toMatch(/doc\?\.character\.displayName/);
    /*
      反面：不许再出现「直接拿 character.name 当显示名」的写法。
      `character.name` 仍可出现在别处（如导出的文件名兜底），
      故只禁严格模式的那一行 —— 它正是本次修掉的 bug 原文。
    */
    expect(HOST).not.toMatch(/characterName=\{doc\?\.character\.name \?\? "主角"\}/);
  });

  it("改名走 IPC 落到实体上，不在本地 mutate 名字", () => {
    const rename = PANEL.slice(PANEL.indexOf("const renameCharacter"));
    const body = rename.slice(0, 1800);
    // 必须调服务（进而走 IPC）
    expect(body).toMatch(/renamePackCharacter\(/);
    /*
      反面：不许出现「本地直接改 name」的旧实现。
      `character: { ...current.character, name }` 是修前的原文，
      它只改内存、不回写实体 —— 于是保存后两边再次分叉。
      注意 body 里合法地出现了 `name: result.target === "character" ? ...`，
      所以用具体形态（直接赋入参 name）来区分。
    */
    expect(body).not.toMatch(/character: \{ \.\.\.current\.character, name \}/);
  });

  it("IPC 三层齐全：handler / preload / 类型声明", () => {
    expect(HANDLERS).toMatch(/ipcMain\.handle\(\s*"novel-pack-rename"/);
    expect(PRELOAD).toMatch(/ipcRenderer\.invoke\('novel-pack-rename'/);
    // .d.ts 里是 pack 块下的一个方法（不是点路径字面量）
    expect(ELECTRON_DTS).toMatch(/\brename: \(/);
  });

  it("改名只动 name 一列，不整份覆盖实体（避免清空摘要 / 正文）", () => {
    const handler = HANDLERS.slice(HANDLERS.indexOf('"novel-pack-rename"'));
    const body = handler.slice(0, 2600);
    // 绑定时走 UPDATE novel_entities SET name —— 单列更新
    expect(body).toMatch(/UPDATE novel_entities SET name = \?, updated_at = \? WHERE id = \?/);
    // 反面：不许在这里调 novel-entity-save（那需要整份 DTO，会覆盖其余字段）
    expect(body).not.toMatch(/novel-entity-save/);
    // 也不许写 fields / summary / content 这些列
    expect(body).not.toMatch(/SET[^;]*\b(fields|summary|content)\s*=/);
  });

  it("未绑定实体时改行囊内那格，并回带落点", () => {
    const handler = HANDLERS.slice(HANDLERS.indexOf('"novel-pack-rename"'));
    const body = handler.slice(0, 2600);
    expect(body).toMatch(/UPDATE novel_pack_characters SET name = \? WHERE id = \?/);
    // 回带 target 让调用方知道改的是谁，不靠本地猜
    expect(body).toMatch(/target: "entity" \| "character"/);
    expect(body).toMatch(/target: "character"/);
  });
});

describe("主角名：三个同步场景都有链路", () => {
  it("场景①书架切作品：PackWindow 以 workId 为 key 整只重挂", () => {
    const app = read("src/windows/PackWindow/App.tsx");
    expect(app).toMatch(/key=\{context\.workId\}/);
  });

  it("场景②右侧换绑主角：syncMeta 会刷新 displayName", () => {
    // 换绑后 bindEntity 调 syncMeta；syncMeta 里必须补刷 displayName
    expect(PANEL).toMatch(/data\.syncMeta\(\)/);
    const data = read("src/shared/components/CharacterPack/hooks/usePackData.ts");
    expect(data).toMatch(/putBundleCharacterName\(bundle\.character\)/);
    // 只动 displayName 一格，不整体 replace（否则会冲掉未保存的编辑）
    expect(data).toMatch(/character: \{ \.\.\.current\.character, displayName \}/);
  });

  it("场景③要素库改名：右侧广播，行囊订阅", () => {
    const novelData = read(
      "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelData.ts",
    );
    // 右侧在 updateEntity 里广播（且只在名字真的变了时），带 entityId 精确定位
    expect(novelData).toMatch(
      /notifyNameChanged\(merged\.workId, merged\.name, "panel", merged\.id\)/,
    );
    expect(novelData).toMatch(/if \(merged\.name !== target\.name\)/);
    // 行囊订阅该事件
    expect(PANEL).toMatch(/window\.addEventListener\(PACK_NAME_EVENT/);
    // 自己的广播不绕回来（origin 过滤）
    expect(PANEL).toMatch(/detail\.origin === "pack"\) return/);
  });

  it("场景③反向：行囊改名 → 右侧要素栏跟进（按 entityId，不按名字猜）", () => {
    const novelData = read(
      "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelData.ts",
    );
    // 右侧也订阅了该事件（行囊改名时要把本地 bundle 里那条要素改名）
    expect(novelData).toMatch(/window\.addEventListener\(PACK_NAME_EVENT/);
    // 定位必须靠 entityId
    expect(novelData).toMatch(/entity\.id === entityId/);
    // 自己发的跳过
    expect(novelData).toMatch(/detail\.origin === "panel"\) return/);
  });

  it("事件负载带 entityId —— 同名要素是真实存在的，不能按名字找", () => {
    const config = read("src/shared/components/CharacterPack/pack-config.ts");
    expect(config).toMatch(/export interface PackNameEventDetail \{\s*workId: string;\s*displayName: string;\s*\/\*\*/);
    expect(config).toMatch(/\bentityId: string;/);
    // 行囊改名前先判落点，只有落到实体上才带 id
    expect(PANEL).toMatch(/result\.target === "entity" \? current\.character\.entityId : ""/);
  });
});
