import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  CopyOutlined,
  PlusOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  NAMING_DICTIONARY,
  NAMING_KINDS,
  NAMING_STYLES,
} from "../../naming/data/dictionary";
import {
  generateNames,
  generateNextBatch,
  isKindSupported,
} from "../../naming/name-generator";
import type {
  NameFavorite,
  NameGender,
  NameStyle,
  NamingKind,
  NamingResult,
} from "../../naming/types";
import "./index.scss";

/**
 * 起名工具动作组：由页面组合层注入，面板本身不接触数据层
 * （与 InspirationActions 同范式：actions 由 useNovelPage 编排，复用既有 hooks）。
 */
export interface NamingActions {
  /** 把名字插入到正文光标处（EditorPane 命令式 ref，主进程不参与） */
  onInsertToEditor: (name: string) => void;
  /** 把名字建为角色卡（type=character，名字带入；复用 handleSaveEntity） */
  onCreateCharacter: (name: string) => void;
  /** 加入收藏夹（按作品持久化） */
  onAddFavorite: (name: string, kind: NamingKind, style: NameStyle) => void;
  /** 移除收藏夹 */
  onRemoveFavorite: (favoriteId: string) => void;
}

interface NameGeneratorPanelProps {
  /** 避开本书已用名：当前作品的全部要素名 + 别名 */
  exclude: string[];
  /** 收藏夹（当前作品）：按 createdAt 倒序 */
  favorites: NameFavorite[];
  actions: NamingActions;
}

/** 性别选项（仅 person 生效；其它类型自动锁定 any） */
const GENDER_OPTIONS: Array<{ value: NameGender; label: string }> = [
  { value: "any", label: "随机" },
  { value: "male", label: "男" },
  { value: "female", label: "女" },
];

/** 一次生成的数量（PRD R18 一次给 10 个） */
const COUNT_OPTIONS = [6, 10, 12] as const;

/**
 * 起名工具面板（PRD R18 / 步骤三）
 *
 * 卡名字时按风格随机起一批名并避开本书已用名：四维过滤
 * （风格 × 类型 × 性别 × 避开已用），结果一次给 10 个，支持换一批与收藏。
 * 双出口：插入正文光标处 / 一键建为角色卡（名称带入）。
 */
export default function NameGeneratorPanel({
  exclude,
  favorites,
  actions,
}: NameGeneratorPanelProps) {
  // 选项状态：组件局部短生命周期状态，不进全局（与 InspirationPanel 范式一致）
  const [kind, setKind] = useState<NamingKind>("person");
  const [style, setStyle] = useState<NameStyle>("xianxia");
  const [gender, setGender] = useState<NameGender>("any");
  const [count, setCount] = useState<number>(10);

  // 当前风格是否支持当前类型；不支持时回退到该风格首个支持的类型
  const supportedKinds = useMemo(() => {
    return NAMING_KINDS.filter((k) => isKindSupported(style, k.id));
  }, [style]);

  // 实际生效的 kind（与 supportedKinds 同步：风格切换后 kind 可能不再支持）
  const effectiveKind = useMemo(() => {
    if (isKindSupported(style, kind)) return kind;
    return supportedKinds[0]?.id ?? "person";
  }, [kind, style, supportedKinds]);

  // 性别只在 person 生效；非 person 锁 any
  const effectiveGender = effectiveKind === "person" ? gender : "any";

  // 生成结果 + 当前 seed（用于换一批）
  // seed 初值用常量 0，首次生成在挂载 effect 里触发，避免 render 期调用 Date.now()
  const [results, setResults] = useState<NamingResult[]>([]);
  const [seed, setSeed] = useState<number>(0);
  const didInitRef = useRef(false);

  // 切换风格 / 类型 / 性别 / 数量时，下一批需要重新计算
  const regenerate = useCallback(
    (overrideSeed?: number) => {
      const newSeed = overrideSeed ?? (Date.now() >>> 0);
      const r = generateNames({
        kind: effectiveKind,
        style,
        gender: effectiveGender,
        count,
        exclude,
        seed: newSeed,
      });
      setResults(r);
      setSeed(newSeed);
    },
    [effectiveKind, style, effectiveGender, count, exclude],
  );

  // 挂载后触发首次生成（render 期禁止调用 Date.now）
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    regenerate();
  }, [regenerate]);

  // 换一批：基于当前 seed 派生新种子，结果不重复（同 exclude 下）
  const handleNextBatch = useCallback(() => {
    const next = generateNextBatch(
      {
        kind: effectiveKind,
        style,
        gender: effectiveGender,
        count,
        exclude,
      },
      seed,
    );
    setResults(next.results);
    setSeed(next.seed);
  }, [effectiveKind, style, effectiveGender, count, exclude, seed]);

  // 复制到剪贴板（兜底出口：不依赖 EditorPane ref）
  const handleCopy = useCallback(async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // 旧浏览器或非安全上下文：静默失败，用户仍可手动复制
    }
  }, []);

  // 选项变化：自动重生一批
  const handleKindChange = (next: NamingKind) => {
    setKind(next);
    setTimeout(() => regenerate(Date.now() >>> 0), 0);
  };
  const handleStyleChange = (next: NameStyle) => {
    setStyle(next);
    setTimeout(() => regenerate(Date.now() >>> 0), 0);
  };
  const handleGenderChange = (next: NameGender) => {
    setGender(next);
    setTimeout(() => regenerate(Date.now() >>> 0), 0);
  };
  const handleCountChange = (next: number) => {
    setCount(next);
    setTimeout(() => regenerate(Date.now() >>> 0), 0);
  };

  // 首次进入自动生成一批
  const handleFocus = useCallback(() => {
    if (results.length === 0) regenerate();
  }, [results.length, regenerate]);

  // 收藏夹：判断是否已收藏（去重展示按钮态）
  const favoriteNameSet = useMemo(
    () => new Set(favorites.map((f) => f.name)),
    [favorites],
  );

  // Enter 在选项区不触发（避免切 Tab 时误触）
  const stopEnter = (e: KeyboardEvent<HTMLSelectElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      handleNextBatch();
    }
  };

  return (
    <div className="nv-name" onFocus={handleFocus}>
      {/* ── 选项行 ── */}
      <div className="nv-name__options">
        <label className="nv-name__field">
          <span className="nv-name__label">类型</span>
          <select
            value={effectiveKind}
            onChange={(e) => handleKindChange(e.target.value as NamingKind)}
            onKeyDown={stopEnter}
          >
            {NAMING_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <label className="nv-name__field">
          <span className="nv-name__label">风格</span>
          <select
            value={style}
            onChange={(e) => handleStyleChange(e.target.value as NameStyle)}
            onKeyDown={stopEnter}
          >
            {NAMING_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}（{s.family === "eastern" ? "东方" : "西方"}）
              </option>
            ))}
          </select>
        </label>

        <label className="nv-name__field nv-name__field--gender">
          <span className="nv-name__label">性别</span>
          <select
            value={effectiveGender}
            disabled={effectiveKind !== "person"}
            onChange={(e) => handleGenderChange(e.target.value as NameGender)}
            onKeyDown={stopEnter}
          >
            {GENDER_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>

        <label className="nv-name__field nv-name__field--count">
          <span className="nv-name__label">数量</span>
          <select
            value={count}
            onChange={(e) => handleCountChange(Number(e.target.value))}
            onKeyDown={stopEnter}
          >
            {COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="nv-name__generate"
          onClick={handleNextBatch}
          title="换一批（避开本书已用名）"
        >
          <ReloadOutlined /> 换一批
        </button>
      </div>

      {/* ── 结果网格 ── */}
      {results.length === 0 ? (
        <p className="nv-name__empty">
          {isKindSupported(style, effectiveKind)
            ? "点击「换一批」生成名字"
            : `当前风格不支持${NAMING_KINDS.find((k) => k.id === effectiveKind)?.label ?? "该类型"}`}
        </p>
      ) : (
        <div className="nv-name__grid">
          {results.map((r) => {
            const favorited = favoriteNameSet.has(r.name);
            return (
              <div key={r.name} className="nv-name__card" role="group" aria-label={r.name}>
                <span className="nv-name__text">{r.name}</span>
                <span className="nv-name__actions">
                  <button
                    type="button"
                    aria-label="插入正文"
                    title="插入到正文光标处"
                    onClick={() => actions.onInsertToEditor(r.name)}
                  >
                    <ThunderboltOutlined />
                  </button>
                  <button
                    type="button"
                    aria-label="建为角色卡"
                    title="建为角色卡（名称带入）"
                    onClick={() => actions.onCreateCharacter(r.name)}
                  >
                    <PlusOutlined />
                  </button>
                  <button
                    type="button"
                    aria-label={favorited ? "已收藏" : "加入收藏"}
                    title={favorited ? "已收藏" : "加入收藏"}
                    className={favorited ? "is-on" : undefined}
                    aria-pressed={favorited}
                    disabled={favorited}
                    onClick={() => actions.onAddFavorite(r.name, r.kind, r.style)}
                  >
                    {favorited ? <StarFilled /> : <StarOutlined />}
                  </button>
                  <button
                    type="button"
                    aria-label="复制"
                    title="复制到剪贴板"
                    onClick={() => void handleCopy(r.name)}
                  >
                    <CopyOutlined />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 收藏夹子区 ── */}
      <div className="nv-name__favorites">
        <div className="nv-name__favorites-head">
          <span>收藏夹</span>
          <span className="nv-name__favorites-count">{favorites.length}</span>
        </div>
        {favorites.length === 0 ? (
          <p className="nv-name__empty">还没有收藏的名字</p>
        ) : (
          <ul className="nv-name__favorites-list">
            {favorites.map((f) => (
              <li key={f.id} className="nv-name__favorite">
                <span className="nv-name__favorite-name" title={f.name}>
                  {f.name}
                </span>
                <span className="nv-name__favorite-meta">
                  {NAMING_DICTIONARY.kinds.find((k) => k.id === f.kind)?.label}
                  ·
                  {NAMING_DICTIONARY.styles.find((s) => s.id === f.style)?.label}
                </span>
                <span className="nv-name__favorite-actions">
                  <button
                    type="button"
                    aria-label="插入正文"
                    title="插入到正文光标处"
                    onClick={() => actions.onInsertToEditor(f.name)}
                  >
                    <ThunderboltOutlined />
                  </button>
                  <button
                    type="button"
                    aria-label="建为角色卡"
                    title="建为角色卡"
                    onClick={() => actions.onCreateCharacter(f.name)}
                  >
                    <PlusOutlined />
                  </button>
                  <button
                    type="button"
                    aria-label="移除收藏"
                    title="移除收藏"
                    onClick={() => actions.onRemoveFavorite(f.id)}
                  >
                    <StarFilled />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
