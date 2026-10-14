import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button, Dropdown, Input } from "antd";
import {
  CheckOutlined,
  ClockCircleOutlined,
  MoreOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import GuideTooltip from "@/shared/components/GuideTooltip";
import SvgIcon from "@/shared/components/SvgIcon";
import dimensionSvg from "@/assets/novel/dimension.svg?raw";
import { formatRelativeTime } from "../../pack-utils";
import "./index.scss";

interface PackHeaderProps {
  characterName: string;
  realmText: string;
  /**
   * 当前小层别名（1.41.0）：「合体 2/4」只答走到哪，「中期」才答现在是什么。
   * 与境界模块的 `.cpk-rlm__alias` 同源（subLabelAt），空串不渲染。
   */
  realmSubText: string;
  realmHint: string;
  /** 是否已绑定主角实体（绑了才在境界 chip 旁给「已绑定主角」） */
  realmBound: boolean;
  /**
   * 紧凑模式（窄档 <600px）。
   *
   * 打开后四个工具按钮收进一个「更多」下拉 —— 小窗下留白比留按钮重要：
   * 按钮挤成一排会被裁掉一半，点不到的按钮比藏起来的更糟。
   */
  compact: boolean;
  dirty: number;
  saving: boolean;
  saveFailed: boolean;
  savedAt: number;
  /** ≥5 处改动时做一次轻微呼吸提示（不循环，G-3） */
  breathe: boolean;
  /** 处于「刚改动」窗口内的条目数（REQ-028）；0 时「全部已读」完全不出现在界面里 */
  changedCount: number;
  onMarkAllRead: () => void;
  /**
   * 改角色名。**不是本地改名** —— 绑定了主角实体时改的是要素库的实体名
   * （名字的单一事实源在要素库），落库后由主进程回带最终名字。
   * 故返回值可能是 Promise（调用方 fire-and-forget，失败会出 toast）。
   */
  onRename: (name: string) => void | Promise<void>;
  onSave: () => void;
  onRevertAll: () => void;
  /**
   * 保存连续失败时的逃生出口（G-4）：把当前草稿整份导出成 JSON。
   *
   * 只在失败态出现 —— 它是「这个面板已经存不进去了」的兜底，不是常规导出
   * （常规导出在 REQ-030 的模块级入口上，输出的是人读的 Markdown）。
   */
  onExportDraft: () => void;
  onOpenModules: () => void;
  onOpenUnitManager: () => void;
  onOpenRecords: () => void;
  /** 帮助中心（L3 常驻入口）：行囊窗口没有 Tour，所以只开文档不提供「重看引导」 */
  onOpenHelp: () => void;
}

/**
 * 行囊头部：横向概览带（§8.6.1）
 *
 * 设计稿把它做成**一条横向带**：左侧角色（头像 + 名 + 境界 + 绑定态）、
 * 右侧保存三态与工具按钮，全部同高并排。
 * 这和旧版的三层堆叠（角色行 / 保存行 / 分栏）是两种信息结构 ——
 * 横向带把「我现在是谁、我这趟盘完了没有、我存了没有」压进一行，
 * 内容区因此能多出一整条的高度给十个模块。
 *
 * 「已保存 · n 分钟前」的时间基准来自最近一条盘点记录的生成时间
 * （保存时会先对改动前状态生成记录，故它正好等于上次保存时刻）。
 */
export default function PackHeader({
  characterName,
  realmText,
  realmSubText,
  realmHint,
  realmBound,
  compact,
  dirty,
  saving,
  saveFailed,
  savedAt,
  breathe,
  changedCount,
  onMarkAllRead,
  onRename,
  onSave,
  onRevertAll,
  onExportDraft,
  onOpenModules,
  onOpenUnitManager,
  onOpenRecords,
  onOpenHelp,
}: PackHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(characterName);
  const [now, setNow] = useState(() => Date.now());

  // 「n 分钟前」需要随时间推进刷新，否则会长期停在首次渲染的值
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!editing) setDraft(characterName);
  }, [characterName, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== characterName) onRename(trimmed);
    setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setDraft(characterName);
      setEditing(false);
    }
  };

  const tone = saveFailed ? "failed" : saving ? "busy" : dirty > 0 ? "dirty" : "idle";

  return (
    <header className={`cpk-head is-${tone}${breathe ? " is-breathe" : ""}`}>
      {/* ── 左：角色 ── */}
      <div className="cpk-head__who">
        <span className="cpk-head__avatar" aria-hidden>
          <UserOutlined />
        </span>
        <div className="cpk-head__id">
          {editing ? (
            <Input
              size="small"
              className="cpk-head__name-input"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
              aria-label="角色名"
            />
          ) : (
            <Button
              className="cpk-head__name"
              onClick={() => setEditing(true)}
              title="点击改名"
            >
              {characterName || "主角"}
            </Button>
          )}
          <div className="cpk-head__meta">
            <span className="cpk-head__realm" title={realmHint || "与实体面板同一份数据"}>
              {realmText}
            </span>
            {/* 小境界别名（1.41.0）：与境界模块的「合体 2/4 · 中期」同口径 ——
                头部此前只显示阶与层数，作者抬眼看不到「现在是什么」 */}
            {realmSubText ? (
              <span className="cpk-head__sub" title={`当前小层：${realmSubText}`}>
                {realmSubText}
              </span>
            ) : null}
            {realmBound ? <span className="cpk-head__bound">已绑定主角</span> : null}
          </div>
        </div>
      </div>

      {/* ── 右：保存三态 + 工具 ── */}
      <div className="cpk-head__ops">
        <span className={`cpk-savebar__state is-${tone}`}>
          {/* 干净态带一枚小圆点：设计稿里「已保存」是一颗绿点 + 文字，
              比纯文字更快传达「当前没有待存内容」 */}
          {tone === "idle" && <span className="cpk-savebar__dot" aria-hidden />}
          {tone === "idle" &&
            (savedAt > 0 ? `已保存 · ${formatRelativeTime(savedAt, now)}` : "已保存")}
          {tone === "dirty" && `${dirty} 处改动未保存`}
          {tone === "busy" && "保存中…"}
          {tone === "failed" && "保存失败 · 草稿已保留"}
        </span>
        {/*
          「全部已读」只在真有角标时出现：常驻一个永远可点但无事发生的按钮，
          比不显示更让人困惑。数字让作者知道点掉的是几个标记。

          窄档下它让位给「更多」菜单 —— 见下方 compact 分支。一条 12 字的
          按钮在 380px 里会被压成「部已读」这种读不出来的碎片，
          省略到看不懂的按钮比放进菜单里更糟。
        */}
        {!compact && changedCount > 0 ? (
          <Button
            className="cpk-btn ghost"
            onClick={onMarkAllRead}
            title="把属性 / 物品 / 技能上的「刚改动」角标一次清掉（不影响数据）"
          >
            <CheckOutlined /> 全部已读 {changedCount}
          </Button>
        ) : null}
        {!compact && tone === "dirty" && (
          <Button className="cpk-btn ghost" onClick={onRevertAll}>
            撤销全部
          </Button>
        )}
        {/* 逃生出口：写不进去的时候，先让作者把这份改动捞出来（G-4）。
            失败态是紧急状态 —— 它**不**收进菜单，留在外面一眼可见。 */}
        {tone === "failed" && (
          <Button
            className="cpk-btn ghost"
            onClick={onExportDraft}
            title="把当前改动整份导出成 JSON 文件，避免写库连续失败时丢数据"
          >
            导出草稿
          </Button>
        )}
        <Button
          className="cpk-btn primary"
          onClick={onSave}
          disabled={saving || dirty === 0}
          title={dirty === 0 ? "没有未保存的改动" : "先落回退点，再写入正式表"}
        >
          {tone === "failed" ? "重试" : dirty > 0 ? `保存 (${dirty})` : "保存"}
        </Button>

        {/*
          窄档：次要文字动作 + 四个工具收进「更多」。

          进来的是「宽档时平铺会挤爆一行」的东西：
          「全部已读 / 撤销全部」与「盘点记录 / 量纲 / 模块管理 / 关闭」。
          留在外面的只有**保存态 pill + 保存按钮** —— 它们是这条带子的底线，
          再窄也要能一眼看到「存没存下」并点得动。

          宽档反过来：一排按钮点起来比展开菜单快，菜单是空间不足时的妥协，
          不该在空间够用时还留着。
        */}
        {compact ? (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            overlayClassName="cpk-dropdown"
            menu={{
              items: [
                ...(changedCount > 0
                  ? [
                      {
                        key: "markRead",
                        icon: <CheckOutlined />,
                        label: `全部已读（${changedCount}）`,
                      },
                    ]
                  : []),
                ...(tone === "dirty"
                  ? [{ key: "revert", label: "撤销全部改动" }]
                  : []),
                ...(changedCount > 0 || tone === "dirty" ? [{ type: "divider" as const }] : []),
                { key: "records", icon: <ClockCircleOutlined />, label: "盘点记录 / 与本章初对比" },
                { key: "units", icon: <SvgIcon svg={dimensionSvg} />, label: "量纲设置（货币 / 熟练度）" },
                { key: "modules", icon: <SettingOutlined />, label: "模块管理" },
                { key: "help", icon: <QuestionCircleOutlined />, label: "帮助中心" },
              ],
              onClick: ({ key }) => {
                if (key === "markRead") onMarkAllRead();
                else if (key === "revert") onRevertAll();
                else if (key === "records") onOpenRecords();
                else if (key === "units") onOpenUnitManager();
                else if (key === "modules") onOpenModules();
                else if (key === "help") onOpenHelp();
              },
            }}
          >
            <Button className="cpk-iconbtn" title="更多">
              <MoreOutlined />
            </Button>
          </Dropdown>
        ) : (
          <span className="cpk-head__tools">
            {/* 帮助放最左：与「模块管理」隔开，避免两颗齿轮状图标挨着误点 */}
            <Button
              className="cpk-iconbtn"
              onClick={onOpenHelp}
              title="帮助中心"
            >
              <QuestionCircleOutlined />
            </Button>
            <Button
              className="cpk-iconbtn"
              onClick={onOpenRecords}
              title="盘点记录 / 与本章初对比"
            >
              <ClockCircleOutlined />
            </Button>
            <Button
              className="cpk-iconbtn"
              onClick={onOpenUnitManager}
              title="量纲设置（货币 / 熟练度）"
            >
              <SvgIcon svg={dimensionSvg} />
            </Button>
            {/* T-04：首次开行囊时提示「默认只开了 3 块，其余在模块管理」 */}
            <GuideTooltip id="T-04">
              <Button
                className="cpk-iconbtn"
                onClick={onOpenModules}
                title="模块管理"
                data-tour-target="pack-modules"
              >
                <SettingOutlined />
              </Button>
            </GuideTooltip>
          </span>
        )}
      </div>
    </header>
  );
}

