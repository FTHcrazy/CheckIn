import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "antd";
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

/** 生成参数的完整集合：选项切换时必须整体显式传入，禁止从闭包里读旧值 */
interface NamingOptionSet {
  kind: NamingKind;
  style: NameStyle;
  gender: NameGender;
  count: number;
}

/** 初始生成参数（PRD 默认：仙侠风格的人名，一次 10 个） */
const INITIAL_OPTIONS: NamingOptionSet = {
  kind: "person",
  style: "xianxia",
  gender: "any",
  count: 10,
};

/** 风格回退：取该风格首个支持的类型 */
function firstSupportedKind(style: NameStyle): NamingKind {
  return NAMING_KINDS.find((k) => isKindSupported(style, k.id))?.id ?? "person";
}

/**
 * 起名工具面板（PRD R18 / 步骤三）
 *
 * 卡名字时按风格随机起一批名并避开本书已用名：四维过滤
 * （风格 × 类型 × 性别 × 避开已用），结果一次给 10 个，支持换一批与收藏。
 * 双出口：插入正文光标处 / 一键建为角色卡（名称带入）。
 * 入口在工具箱启动器，本面板是它的二级页面。
 */
export default function NameGeneratorPanel({
  exclude,
  favorites,
  actions,
}: NameGeneratorPanelProps) {
  // 选项状态：组件局部短生命周期状态，不进全局（与 InspirationPanel 范式一致）
  const [kind, setKind] = useState<NamingKind>(INITIAL_OPTIONS.kind);
  const [style, setStyle] = useState<NameStyle>(INITIAL_OPTIONS.style);
  const [gender, setGender] = useState<NameGender>(INITIAL_OPTIONS.gender);
  const [count, setCount] = useState<number>(INITIAL_OPTIONS.count);

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

  /**
   * 按「显式传入的参数」生成一批
   *
   * 关键点：选项切换（类型 / 风格 / 性别 / 数量）时，必须把变更后的值当参数传进来，
   * 不能在 setTimeout 回调里读 regenerate 闭包——那会拿到切换前的旧选项，
   * 表现为「列表动了一下，但内容还是上一个类型」。
   */
  const buildBatch = useCallback(
    (options: NamingOptionSet, overrideSeed?: number) => {
      const newSeed = overrideSeed ?? (Date.now() >>> 0);
      setResults(generateNames({ ...options, exclude, seed: newSeed }));
      setSeed(newSeed);
    },
    [exclude],
  );

  // 挂载后触发首次生成（render 期禁止调用 Date.now）
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    buildBatch(INITIAL_OPTIONS);
  }, [buildBatch]);

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

  // 选项变化：按变更后的值立即重生一批（走参数，不读闭包）
  const handleKindChange = (next: NamingKind) => {
    setKind(next);
    buildBatch({
      kind: next,
      style,
      gender: next === "person" ? gender : "any",
      count,
    });
  };
  const handleStyleChange = (next: NameStyle) => {
    setStyle(next);
    // 新风格不支持当前类型时回退到该风格首个支持的类型（与 effectiveKind 口径一致）
    const nextKind = isKindSupported(next, kind) ? kind : firstSupportedKind(next);
    buildBatch({
      kind: nextKind,
      style: next,
      gender: nextKind === "person" ? gender : "any",
      count,
    });
  };
  const handleGenderChange = (next: NameGender) => {
    setGender(next);
    buildBatch({
      kind: effectiveKind,
      style,
      gender: effectiveKind === "person" ? next : "any",
      count,
    });
  };
  const handleCountChange = (next: number) => {
    setCount(next);
    buildBatch({
      kind: effectiveKind,
      style,
      gender: effectiveGender,
      count: next,
    });
  };

  // 首次进入自动生成一批
  const handleFocus = useCallback(() => {
    if (results.length === 0) {
      buildBatch({
        kind: effectiveKind,
        style,
        gender: effectiveGender,
        count,
      });
    }
  }, [results.length, buildBatch, effectiveKind, style, effectiveGender, count]);

  // 收藏夹：判断是否已收藏（去重展示按钮态）
  const favoriteNameSet = useMemo(
    () => new Set(favorites.map((f) => f.name)),
    [favorites],
  );

  // 下拉选项：全部走组件库 Select（AGENTS 6.1.2 组件库优先）
  const kindOptions = useMemo(
    () =>
      NAMING_KINDS.map((k) => ({
        value: k.id,
        label: k.label,
        disabled: !isKindSupported(style, k.id),
      })),
    [style],
  );

  const styleOptions = useMemo(
    () =>
      NAMING_STYLES.map((s) => ({
        value: s.id,
        label: `${s.label}（${s.family === "eastern" ? "东方" : "西方"}）`,
      })),
    [],
  );

  const countOptions = useMemo(
    () => COUNT_OPTIONS.map((n) => ({ value: n, label: `${n} 个` })),
    [],
  );

  return (
    <div className="nv-name" onFocus={handleFocus}>
      <div className="nv-name__options">
        <div className="nv-name__opt">
          <span>类型</span>
          <Select
            className="nv-name__select"
            size="small"
            classNames={{ popup: { root: "nv-name__dropdown" } }}
            aria-label="名称类型"
            value={effectiveKind}
            options={kindOptions}
            onChange={handleKindChange}
          />
        </div>

        <div className="nv-name__opt">
          <span>风格</span>
          <Select
            className="nv-name__select"
            size="small"
            classNames={{ popup: { root: "nv-name__dropdown" } }}
            aria-label="名称风格"
            value={style}
            options={styleOptions}
            onChange={handleStyleChange}
          />
        </div>

        <div className="nv-name__opt">
          <span>性别</span>
          <Select
            className="nv-name__select"
            size="small"
            classNames={{ popup: { root: "nv-name__dropdown" } }}
            aria-label="性别"
            value={effectiveGender}
            disabled={effectiveKind !== "person"}
            options={GENDER_OPTIONS}
            onChange={handleGenderChange}
          />
        </div>

        <div className="nv-name__opt">
          <span>数量</span>
          <Select
            className="nv-name__select"
            size="small"
            classNames={{ popup: { root: "nv-name__dropdown" } }}
            aria-label="生成数量"
            value={count}
            options={countOptions}
            onChange={handleCountChange}
          />
        </div>
      </div>

      <button
        type="button"
        className="nv-name__regen"
        onClick={handleNextBatch}
        title="换一批（避开本书已用名）"
      >
        <ReloadOutlined /> 换一批（避开本书已用名）
      </button>

      <div className="nv-sechead">
        结果<em>{results.length}</em>
      </div>

      {results.length === 0 ? (
        <div className="nv-empty">
          <b>还没有生成</b>
          <span>
            {isKindSupported(style, effectiveKind)
              ? "点「换一批」试试"
              : `当前风格不支持${
                  NAMING_KINDS.find((k) => k.id === effectiveKind)?.label ?? "该类型"
                }`}
          </span>
        </div>
      ) : (
        <div className="nv-name__grid">
          {results.map((r, index) => {
            const favorited = favoriteNameSet.has(r.name);
            return (
              <div
                key={r.name}
                className="nv-name__card"
                style={{ animationDelay: `${index * 18}ms` }}
              >
                <span className="nv-name__text">{r.name}</span>
                <span className="nv-name__acts">
                  <button
                    type="button"
                    className="nv-mini"
                    aria-label="插入正文"
                    title="插入到正文光标处"
                    onClick={() => actions.onInsertToEditor(r.name)}
                  >
                    <ThunderboltOutlined />
                  </button>
                  <button
                    type="button"
                    className="nv-mini"
                    aria-label="建为角色卡"
                    title="建为角色卡（名称带入）"
                    onClick={() => actions.onCreateCharacter(r.name)}
                  >
                    <PlusOutlined />
                  </button>
                  <button
                    type="button"
                    className={`nv-mini${favorited ? " is-on" : ""}`}
                    aria-label={favorited ? "已收藏" : "加入收藏"}
                    title={favorited ? "已收藏" : "加入收藏"}
                    aria-pressed={favorited}
                    disabled={favorited}
                    onClick={() => actions.onAddFavorite(r.name, r.kind, r.style)}
                  >
                    {favorited ? <StarFilled /> : <StarOutlined />}
                  </button>
                  <button
                    type="button"
                    className="nv-mini"
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

      <div className="nv-sechead">
        收藏夹<em>{favorites.length}</em>
      </div>

      {favorites.length === 0 ? (
        <div className="nv-empty">
          <b>还没有收藏的名字</b>
          <span>在结果卡上点星标即可收藏（按作品持久化）</span>
        </div>
      ) : (
        <ul className="nv-name__favorites">
          {favorites.map((f) => (
            <li key={f.id} className="nv-name__fav">
              <span className="nv-name__fav-name" title={f.name}>
                {f.name}
              </span>
              <span className="nv-name__fav-meta">
                {NAMING_DICTIONARY.styles.find((s) => s.id === f.style)?.label} ·{" "}
                {NAMING_DICTIONARY.kinds.find((k) => k.id === f.kind)?.label}
              </span>
              <span className="nv-name__fav-acts">
                <button
                  type="button"
                  className="nv-mini"
                  aria-label="插入正文"
                  title="插入到正文光标处"
                  onClick={() => actions.onInsertToEditor(f.name)}
                >
                  <ThunderboltOutlined />
                </button>
                <button
                  type="button"
                  className="nv-mini"
                  aria-label="建为角色卡"
                  title="建为角色卡"
                  onClick={() => actions.onCreateCharacter(f.name)}
                >
                  <PlusOutlined />
                </button>
                <button
                  type="button"
                  className="nv-mini is-on"
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
  );
}
