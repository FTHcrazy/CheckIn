# CHANGELOG 历史归档索引

`CHANGELOG.md`（仓库根）只保留最近若干个次版本，更早的记录按**次版本**拆到本目录，
文件名即版本区间。拆分规则见 `AGENTS.md` §8.6。

## 怎么查

1. 先看下表定位文件（版本号只看 `major.minor`，补丁号不影响归属）；
2. 再在对应文件里 `grep "^## \[1.38.0\]"` 直接跳到那一条；
3. **不要**为了找一条旧记录整份读大文件 —— 每个文件本身就是按版本分块的。

## 索引

| 文件 | 覆盖版本 |
|------|---------|
| `CHANGELOG-2.36.md` | 2.36.0 – 2.36.4 |
| `CHANGELOG-2.35.md` | 2.35.0 |
| `CHANGELOG-2.34.md` | 2.34.0 |
| `CHANGELOG-2.33.md` | 2.33.0 |
| `CHANGELOG-2.32.md` | 2.32.0 |
| `CHANGELOG-2.31.md` | 2.31.0 |
| `CHANGELOG-2.30.md` | 2.30.0 |
| `CHANGELOG-2.29.md` | 2.29.0 |
| `CHANGELOG-2.28.md` | 2.28.0 |
| `CHANGELOG-2.27.md` | 2.27.0 |
| `CHANGELOG-2.26.md` | 2.26.0 |
| `CHANGELOG-2.25.md` | 2.25.0 |
| `CHANGELOG-2.24.md` | 2.24.0 |
| `CHANGELOG-2.23.md` | 2.23.0 |
| `CHANGELOG-2.22.md` | 2.22.0 |
| `CHANGELOG-2.21.md` | 2.21.0 |
| `CHANGELOG-2.20.md` | 2.20.0 |
| `CHANGELOG-2.19.md` | 2.19.0 |
| `CHANGELOG-2.18.md` | 2.18.0 |
| `CHANGELOG-2.17.md` | 2.17.0 – 2.17.2 |
| `CHANGELOG-2.16.md` | 2.16.0 |
| `CHANGELOG-2.15.md` | 2.15.0 – 2.15.1 |
| `CHANGELOG-2.14.md` | 2.14.0 |
| `CHANGELOG-2.13.md` | 2.13.0 |
| `CHANGELOG-2.12.md` | 2.12.0 |
| `CHANGELOG-2.11.md` | 2.11.0 |
| `CHANGELOG-2.10.md` | 2.10.0 – 2.10.6 |
| `CHANGELOG-2.9.md` | 2.9.0 – 2.9.2 |
| `CHANGELOG-2.8.md` | 2.8.0 |
| `CHANGELOG-2.7.md` | 2.7.0 |
| `CHANGELOG-2.6.md` | 2.6.0 – 2.6.3 |
| `CHANGELOG-2.5.md` | 2.5.0 – 2.5.1 |
| `CHANGELOG-2.4.md` | 2.4.0 |
| `CHANGELOG-2.3.md` | 2.3.0 |
| `CHANGELOG-2.2.md` | 2.2.0 – 2.2.2 |
| `CHANGELOG-2.1.md` | 2.1.0 – 2.1.2 |
| `CHANGELOG-2.0.md` | 2.0.0 |
| `CHANGELOG-1.46.md` | 1.46.1 – 1.46.2 |
| `CHANGELOG-1.45.md` | 1.45.0 – 1.45.1 |
| `CHANGELOG-1.44.md` | 1.44.0 – 1.44.1 |
| `CHANGELOG-1.43.md` | 1.43.0 – 1.43.1 |
| `CHANGELOG-1.42.md` | 1.42.0 |
| `CHANGELOG-1.41.md` | 1.41.0 |
| `CHANGELOG-1.40.md` | 1.40.0 |
| `CHANGELOG-1.39.md` | 1.39.0 – 1.39.1 |
| `CHANGELOG-1.38.md` | 1.38.0 |
| `CHANGELOG-1.37.md` | 1.37.0 – 1.37.1 |
| `CHANGELOG-1.36.md` | 1.36.0 |
| `CHANGELOG-1.35.md` | 1.35.0 |
| `CHANGELOG-1.34.md` | 1.34.0 – 1.34.1 |
| `CHANGELOG-1.33.md` | 1.33.0 – 1.33.2 |
| `CHANGELOG-1.32.md` | 1.32.0 – 1.32.1 |
| `CHANGELOG-1.31.md` | 1.31.0 |
| `CHANGELOG-1.0-to-1.30.md` | 1.0.2 – 1.30.0（拆分规则建立前的一次性合并归档，不再细分） |

## 维护

- 新增归档：跑 `node scripts/split-changelog.mjs`（自动按次版本切分并重写主文件的归档说明），
  再在**本表顶部**补一行；
- 归档是**纯搬运**：不改写条目、不合并版本、不调整日期，条目与该版本在主文件里时逐字一致；
- 分组键是 **`major.minor`**（不是单独的数字 minor）：只认 minor 会把 `1.46` 排到 `2.0` 前面，
  1.46 被当「最新版」留在主文件、2.0 反被归档，归档指针就出现「归档到 2.0.0，却只保留 1.46.1 之后」这种自相矛盾；
- 主文件当前保留 `2.37.0 – 2.45.0`（**644 行**，2026-11-09 校核），下次超过 800 行时再从 2.37 往前分流；
- 守卫：`electron/changelog-archive-guard.test.ts` 断言主文件 ≤ 800 行、归档不超限、索引无断链 ——
  改完 CHANGELOG 必须跑一次，不要等「下次一起拆」。
