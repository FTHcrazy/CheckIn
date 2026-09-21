import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Empty, Input, Modal } from "antd";
import {
  CalendarOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  EditOutlined,
  SearchOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import HomeSidebar from "./components/HomeSidebar";
import HomeStats from "./components/HomeStats";
import type { HomeStatItem } from "./components/HomeStats";
import FeatureCard from "./components/FeatureCard";
import type { FeatureTone } from "./components/FeatureCard";
import PosterWidget from "./components/PosterWidget";
import { useHomeOverview } from "./hooks/useHomeOverview";
import { useHomeActions } from "./hooks/useHomeActions";
import { usePosterVisibility } from "./hooks/usePosterVisibility";
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
  {
    key: "migration",
    icon: <SwapOutlined />,
    title: "数据迁移",
    desc: "待办与备忘勾选导出 zip，支持导入合并",
    path: "/migration",
    tone: "rose",
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

  // 右下角报纸展示状态机：拉取成功才展示；应用启动后展示一次，
  // 隔天 9 点重置后再展示一次；点击跳转后本周期内不再出现
  const { showPoster, dismissPoster } = usePosterVisibility();

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

  // 点击报纸：进入今日资讯，且本周期（隔天 9 点前）内不再展示
  const handlePosterOpen = () => {
    dismissPoster();
    navigate("/news");
  };

  return (
    <div className="home-page">
      <HomeSidebar />

      {/* 右下角海报装饰件：新闻拉取成功才展示；启动展示一次，隔天 9 点重置后再展示一次；点击进入今日资讯后本周期内消失 */}
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
