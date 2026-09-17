import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Empty, Input, Modal } from "antd";
import {
  CalendarOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  EditOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import WorkerFloatButton from "@/shared/components/WorkerFloatButton";
import HomeSidebar from "./components/HomeSidebar";
import HomeStats from "./components/HomeStats";
import type { HomeStatItem } from "./components/HomeStats";
import FeatureCard from "./components/FeatureCard";
import type { FeatureTone } from "./components/FeatureCard";
import { useHomeOverview } from "./hooks/useHomeOverview";
import { useHomeActions } from "./hooks/useHomeActions";
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

  return (
    <div className="home-page">
      <HomeSidebar />

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

        <button
          type="button"
          className="home-page__user"
          onClick={() => navigate("/user")}
        >
          <span className="home-page__avatar">
            {displayName ? displayName.charAt(0) : "?"}
          </span>
          <span className="home-page__user-text">
            <span className="home-page__user-email">
              {overview.email || "未设置邮箱"}
            </span>
            <span className="home-page__user-hint">管理账号信息</span>
          </span>
          <span className="home-page__user-action">修改</span>
        </button>
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
          placeholder="要做什么？回车即可添加"
          maxLength={200}
        />
      </Modal>

      {/* 悬浮入口仅属于主页：切换到子页面后不再展示 */}
      <WorkerFloatButton />
    </div>
  );
}
