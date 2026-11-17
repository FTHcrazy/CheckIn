import { Button, Input, Segmented, Typography } from "antd";
import {
  EyeInvisibleOutlined,
  ReadOutlined,
  RobotOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { TRACKS } from "../../data/interview-taxonomy";
import type { QuestionTrack } from "../../data/interview-types";
import "./index.scss";

const { Text } = Typography;

interface SearchPanelProps {
  track: QuestionTrack;
  /** 输入框即时值（防抖前的受控值） */
  keyword: string;
  total: number;
  favoriteCount: number;
  /** 被隐藏的默认题条数（入口按钮上的角标） */
  hiddenCount: number;
  onTrackChange: (track: QuestionTrack) => void;
  onKeywordChange: (value: string) => void;
  onSearch: () => void;
  /** 打开「知识体系」抽屉 */
  onOpenKnowledge: () => void;
  /** 打开「已隐藏的默认题」抽屉 */
  onOpenHidden: () => void;
  /** 打开 AI 拓展抽屉；不传则不显示入口 */
  onOpenAi?: () => void;
  /** AI 总开关关着 / 通道不在：整块不渲染（REQ-063） */
  aiHidden?: boolean;
  /** AI 开关开着但没配全：禁用并说明原因 */
  aiDisabledText?: string;
}

/** 轨道选项：模块级常量，避免每次渲染重建数组 */
const TRACK_OPTIONS = TRACKS.map((track) => ({
  label: track.label,
  value: track.id,
}));

/**
 * 顶部搜索区：关键词输入 + 轨道分段切换 + 结果概览。
 *
 * 回车与「搜索」按钮走同一入口，输入本身走 300ms 防抖（由页面 hook 负责），
 * 这里只把值原样上报，不持有状态。
 */
export default function SearchPanel({
  track,
  keyword,
  total,
  favoriteCount,
  hiddenCount,
  onTrackChange,
  onKeywordChange,
  onSearch,
  onOpenKnowledge,
  onOpenHidden,
  onOpenAi,
  aiHidden = false,
  aiDisabledText = "",
}: SearchPanelProps) {
  return (
    <section className="interview-search">
      <div className="interview-search__main">
        <Input
          className="interview-search__input"
          value={keyword}
          allowClear
          prefix={<SearchOutlined className="interview-search__icon" />}
          placeholder="搜索题目、题干或标签，回车立即搜索"
          onChange={(event) => onKeywordChange(event.target.value)}
          onPressEnter={onSearch}
        />
        <Segmented
          className="interview-search__track"
          value={track}
          options={TRACK_OPTIONS}
          onChange={(value) => {
            // Segmented 的 value 是宽类型，这里显式收窄而不是断言
            if (value === "written" || value === "foundation") {
              onTrackChange(value);
            }
          }}
        />
        <Button
          className="interview-search__knowledge"
          icon={<ReadOutlined />}
          onClick={onOpenKnowledge}
        >
          知识体系
        </Button>
        {/* AI 拓展入口：总开关关着 / 通道不在时整块不渲染；
            开关开着只是没配全时禁用并说明原因（M8：入口要留下才知道去补什么） */}
        {onOpenAi && !aiHidden ? (
          <Button
            className="interview-search__ai"
            icon={<RobotOutlined />}
            disabled={Boolean(aiDisabledText)}
            title={aiDisabledText || "用 AI 出题、出词条、出图解"}
            onClick={onOpenAi}
          >
            AI 拓展
          </Button>
        ) : null}
        {/* 「隐藏」= 删除内置题的唯一形态，必须留一个能反悔的入口；
            没有隐藏过任何题时按钮仍可见，抽屉里有空态说明 */}
        <Button
          className="interview-search__hidden"
          icon={<EyeInvisibleOutlined />}
          onClick={onOpenHidden}
        >
          {hiddenCount > 0 ? `已隐藏 ${hiddenCount} 题` : "已隐藏的默认题"}
        </Button>
      </div>
      <div className="interview-search__meta">
        <Text type="secondary">
          当前条件命中 <b className="interview-search__count">{total}</b> 题
        </Text>
        <Text type="secondary">已收藏 {favoriteCount} 题</Text>
      </div>
    </section>
  );
}
