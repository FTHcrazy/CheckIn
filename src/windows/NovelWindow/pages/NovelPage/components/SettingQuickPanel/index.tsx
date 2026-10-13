import { useMemo, useState } from "react";
import {
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Button, Input, Tag, Tooltip } from "antd";
import type { SettingCategory } from "../../types";
import { scanConsistency, scanUnregistered } from "../../utils/setting-utils";
import "./index.scss";

interface SettingQuickPanelProps {
  settings: SettingCategory[];
  /** 当前章正文：一致性检查的扫描对象 */
  content: string;
  /** 把设定用词插到编辑器光标处 */
  onInsertTerm: (term: string) => void;
  /** 一键替换正文里的某个词（别名 → 设定用词） */
  onReplaceTerm: (from: string, to: string) => void;
  /** 把未登记的词登记进该分类（新增一条等级） */
  onRegisterTerm: (categoryId: string, term: string) => void;
  /** 打开设定中心（重活都在那里做） */
  onOpenSettings: () => void;
}

/**
 * 写作态设定速查面板
 *
 * 与「设定中心」分工：这里只做**轻活** —— 查、插、顺手修一处不一致；
 * 分类与阶梯的增删改一律去设定中心，避免两套编辑入口。
 *
 * 一致性检查刻意保守：只报「正文用了别名」与「形似等级但未登记」两类，
 * 且不自动改正文 —— 每条都要作者点一次，改错了能一眼看出来。
 */
export default function SettingQuickPanel({
  settings,
  content,
  onInsertTerm,
  onReplaceTerm,
  onRegisterTerm,
  onOpenSettings,
}: SettingQuickPanelProps) {
  const [keyword, setKeyword] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const key = keyword.trim();
    if (!key) return settings;
    return settings
      .map((category) => ({
        ...category,
        levels: category.levels.filter(
          (level) =>
            level.name.includes(key) ||
            level.note.includes(key) ||
            level.aliases.some((alias) => alias.includes(key)),
        ),
      }))
      .filter(
        (category) => category.name.includes(key) || category.levels.length > 0,
      );
  }, [keyword, settings]);

  const issues = useMemo(
    () => [...scanConsistency(content, settings), ...scanUnregistered(content, settings)],
    [content, settings],
  );

  const toggle = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="nv-sqp">
      <div className="nv-field nv-sqp__search">
        <SearchOutlined />
        <Input
          variant="borderless"
          value={keyword}
          allowClear
          placeholder="搜索设定项，点击插入正文"
          aria-label="搜索设定项"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="nv-sqp__body">
        {filtered.length === 0 ? (
          keyword ? (
            <div className="nv-empty">
              <b>没有匹配的设定项</b>
              <span>换个关键词，或去设定中心补一条</span>
            </div>
          ) : (
            <div className="nv-empty">
              <b>还没有设定分类</b>
              <span>用预设一键灌入境界 / 品阶体系，或从空白开始</span>
              <Button className="nv-ghost" onClick={onOpenSettings}>
                <SettingOutlined />
                打开设定中心
              </Button>
            </div>
          )
        ) : (
          <div className="nv-sechead">
            设定条目
            <em>{settings.reduce((sum, c) => sum + c.levels.length, 0)} 条</em>
          </div>
        )}

        {filtered.map((category) => {
          const isCollapsed = collapsed.has(category.id);
          return (
            <section key={category.id} className="nv-sqp__group">
              <Button
                className="nv-sqp__group-head"
                onClick={() => toggle(category.id)}
                aria-expanded={!isCollapsed}
              >
                <span
                  className="nv-sqp__dot"
                  style={{ background: category.color }}
                  aria-hidden
                />
                <span className="nv-sqp__group-name">{category.name}</span>
                <span className="nv-sqp__group-count">
                  {category.levels.length} 级
                </span>
                <span className={`nv-sqp__caret${isCollapsed ? "" : " is-open"}`}>
                  ›
                </span>
              </Button>
              {!isCollapsed && (
                <div className="nv-sqp__chips">
                  {category.levels.map((level) => (
                    <Tooltip
                      key={level.id}
                      title={level.note || "点击插入到光标处"}
                    >
                      <Button
                        className="nv-sqp__chip"
                        onClick={() => onInsertTerm(level.name)}
                      >
                        {level.name}
                      </Button>
                    </Tooltip>
                  ))}
                  {category.levels.length === 0 && (
                    <span className="nv-sqp__empty">这套阶梯还没有等级</span>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {filtered.length > 0 && (
          <Button
            className="nv-sqp__manage"
            onClick={onOpenSettings}
          >
            <SettingOutlined />
            打开设定中心，管理分类与阶梯
          </Button>
        )}
      </div>

      <section className="nv-sqp__check">
        <div className="nv-sqp__check-head">
          <span>一致性检查</span>
          <span className="nv-sqp__check-scope">仅扫描本章</span>
          {issues.length > 0 && (
            <span className="nv-sqp__check-count">{issues.length} 处待确认</span>
          )}
        </div>
        {issues.length === 0 ? (
          <div className="nv-sqp__check-ok">本章用词与设定一致</div>
        ) : (
          issues.map((issue) => (
            <div key={`${issue.categoryId}:${issue.term}`} className="nv-sqp__issue">
              <Tag
                className={`nv-sqp__tag is-${issue.kind}`}
                bordered={false}
              >
                {issue.kind === "alias" ? "用词" : "未登记"}
              </Tag>
              <span className="nv-sqp__issue-text">
                「{issue.term}」
                {issue.suggest ? ` → 设定用词「${issue.suggest}」` : ` 不在「${issue.categoryName}」里`}
              </span>
              {issue.suggest ? (
                <Button
                  size="small"
                  type="link"
                  onClick={() => onReplaceTerm(issue.term, issue.suggest!)}
                >
                  <SwapOutlined />
                  替换
                </Button>
              ) : (
                <Button
                  size="small"
                  type="link"
                  onClick={() => onRegisterTerm(issue.categoryId, issue.term)}
                >
                  <PlusOutlined />
                  登记
                </Button>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
