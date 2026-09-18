import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Empty, Input, Modal } from "antd";
import {
  CalendarOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  EditOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { fetchDailyNews } from "@/shared/services/news";
import type { DailyNewsPayload } from "@/shared/services/news";
import HomeSidebar from "./components/HomeSidebar";
import HomeStats from "./components/HomeStats";
import type { HomeStatItem } from "./components/HomeStats";
import FeatureCard from "./components/FeatureCard";
import type { FeatureTone } from "./components/FeatureCard";
import PosterWidget from "./components/PosterWidget";
import { useHomeOverview } from "./hooks/useHomeOverview";
import { useHomeActions } from "./hooks/useHomeActions";
import { parseWorkHourTag } from "../TodoPage/todo-utils";
import "./index.scss";

interface HomeFeature {
  key: string;
  icon: ReactNode;
  title: string;
  desc: string;
  path: string;
  tone: FeatureTone;
}

// 模块级常量：功能入口与顺序固定，避免每次渲染重建数组
const FEATURES: HomeFeature[] = [
  {
    key: "todo",
    icon: <CheckSquareOutlined />,
    title: "待办清单",
    desc: "子任务、工时与备注，支持大纲式拆解",
    path: "/todo",
    tone: "blue",
  },
  {
    key: "daily",
    icon: <CalendarOutlined />,
    title: "日期活动",
    desc: "日程排布与到点提醒，别忘打卡",
    path: "/daily",
    tone: "amber",
  },
  {
    key: "memo",
    icon: <EditOutlined />,
    title: "备忘笔记",
    desc: "Markdown 文件本地留存，支持导入导出",
    path: "/memo",
    tone: "purple",
  },
  {
    key: "code",
    icon: <CodeOutlined />,
    title: "代码记录",
    desc: "按日统计提交产出，追踪日均行数",
    path: "/code",
    tone: "teal",
  },
];

/** 邮箱前缀 → 展示名：e-tiehan.fang@x.com → Fang */
function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const segment = local.includes(".") ? local.split(".").pop() : local;
  if (!segment) return "";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

// 窗口生命周期标记（模块级，路由切换不重置）：
// 新闻接口只在首次进入首页时探测一次；海报点击跳转后整个窗口内不再展示。
// 探测用 Promise 缓存而非布尔标记：BaseWindow 开发态是 StrictMode 双挂载——
// 若第一次挂载就把标记置位，重挂载会跳过订阅，而第一次的回调又因 cleanup 被
// 判死（mounted=false），探测结果永远落不了 setShowPoster（海报永不出现）。
let newsProbePromise: Promise<DailyNewsPayload> | null = null;
let posterDismissed = false;

export default function HomePage() {
  const { overview, reload } = useHomeOverview();
  const {
    greeting,
    todayText,
    navigate,
    quickAddOpen,
    quickAddValue,
    submitting,
    openQuickAdd,
    closeQuickAdd,
    setQuickAddValue,
    submitQuickAdd,
  } = useHomeActions(reload);

  const [keyword, setKeyword] = useState("");

  // 首次进入首页探测一次新闻接口：成功才展示右下角报纸（接口失败静默不展示）
  const [showPoster, setShowPoster] = useState(false);

  useEffect(() => {
    if (posterDismissed) return;
    if (!newsProbePromise) newsProbePromise = fetchDailyNews();
    let mounted = true;
    newsProbePromise
      .then((payload) => {
        if (mounted && payload.live) setShowPoster(true);
      })
      .catch(() => {
        // 探测失败保持隐藏，不打扰首页
      });
    return () => {
      mounted = false;
    };
  }, []);

  const visibleFeatures = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return FEATURES;
    return FEATURES.filter(
      (item) =>
        item.title.includes(trimmed) || item.desc.includes(trimmed),
    );
  }, [keyword]);

  const statItems = useMemo<HomeStatItem[]>(
    () => [
      { key: "todo", label: "待办未完成", value: overview.todoCount, unit: "项", tone: "blue" },
      { key: "code", label: "今日代码", value: overview.codeLines, unit: "行", tone: "amber" },
      { key: "memo", label: "备忘文件", value: overview.memoCount, unit: "篇", tone: "purple" },
      { key: "daily", label: "本月打卡", value: overview.checkinDays, unit: "天", tone: "teal" },
    ],
    [overview.checkinDays, overview.codeLines, overview.memoCount, overview.todoCount],
  );

  const displayName = displayNameFromEmail(overview.email);

  // 实时解析快捷工时语法，给用户即时反馈（真正写入仍以 submitQuickAdd 内的解析为准）
  const quickAddPreview = useMemo(
    () => parseWorkHourTag(quickAddValue),
    [quickAddValue],
  );

  // 点击报纸：进入今日资讯，且本窗口内不再展示（避免返回首页时重复出现）
  const handlePosterOpen = () => {
    posterDismissed = true;
    setShowPoster(false);
    navigate("/news");
  };

  return (
    <div className="home-page">
      <HomeSidebar />

      {/* 右下角海报装饰件：新闻接口探测成功才展示，点击进入今日资讯后消失（窗口生命周期一次） */}
      {showPoster && <PosterWidget onOpen={handlePosterOpen} />}

      <div className="home-page__main">
        <header className="home-page__top">
          <div className="home-page__greeting-group">
            <h1 className="home-page__greeting">
              {greeting}
              {displayName ? `，${displayName}` : ""}
            </h1>
            <p className="home-page__date">{todayText}</p>
          </div>
          <Input
            className="home-page__search"
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            prefix={<SearchOutlined className="home-page__search-icon" />}
            placeholder="搜索功能"
          />
        </header>

        <div className="home-page__quick">
          <button
            type="button"
            className="home-page__quick-btn is-primary"
            onClick={() => navigate("/daily")}
          >
            开始今日打卡
          </button>
          <button type="button" className="home-page__quick-btn" onClick={openQuickAdd}>
            + 新建待办
          </button>
          <button
            type="button"
            className="home-page__quick-btn"
            onClick={() => navigate("/memo")}
          >
            + 新建备忘
          </button>
          <button
            type="button"
            className="home-page__quick-btn"
            onClick={() => navigate("/code")}
          >
            + 记录代码
          </button>
        </div>

        <HomeStats items={statItems} />

        <section className="home-page__section">
          <h2 className="home-page__section-title">功能</h2>
          {visibleFeatures.length > 0 ? (
            <div className="home-page__grid">
              {visibleFeatures.map((feature) => (
                <FeatureCard
                  key={feature.key}
                  icon={feature.icon}
                  title={feature.title}
                  desc={feature.desc}
                  tone={feature.tone}
                  onClick={() => navigate(feature.path)}
                />
              ))}
            </div>
          ) : (
            <Empty
              className="home-page__empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`没有匹配「${keyword.trim()}」的功能`}
            />
          )}
        </section>
      </div>

      <Modal
        title="新建待办"
        open={quickAddOpen}
        onCancel={closeQuickAdd}
        onOk={submitQuickAdd}
        okText="添加"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={quickAddValue}
          onChange={(event) => setQuickAddValue(event.target.value)}
          onPressEnter={submitQuickAdd}
          placeholder="要做什么？回车即可添加；后缀加 #2h 记录工时"
          maxLength={200}
        />
        <p className="home-page__quick-hint">
          {quickAddPreview.workHour !== null ? (
            <>
              将记录工时
              <b>{quickAddPreview.workHour}h</b>
              {quickAddPreview.content ? `，内容「${quickAddPreview.content}」` : ""}
            </>
          ) : (
            <>在内容后加 <code>#2h</code>（支持小数如 <code>#1.5h</code>）即可同时建立工时</>
          )}
        </p>
      </Modal>
    </div>
  );
}
