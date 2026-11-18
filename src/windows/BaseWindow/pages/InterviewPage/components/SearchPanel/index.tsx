import { Button, Input, Segmented, Typography } from "antd";
import {
  DisconnectOutlined,
  EyeInvisibleOutlined,
  InboxOutlined,
  ReadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
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
  /** 待处理草稿条数（草稿不进题库，所以必须单独有个入口） */
  draftCount: number;
  /** 已解除的名词绑定条数（0 时不显示入口，别给顶栏加常驻噪音） */
  hintCount: number;
  onTrackChange: (track: QuestionTrack) => void;
  onKeywordChange: (value: string) => void;
  onSearch: () => void;
  /** 打开「知识体系」抽屉 */
  onOpenKnowledge: () => void;
  /** 打开「已隐藏的默认题」抽屉 */
  onOpenHidden: () => void;
  /** 打开草稿箱抽屉 */
  onOpenDrafts: () => void;
  /** 打开「已解除的名词绑定」抽屉 */
  onOpenHints: () => void;
  /** 打开 AI 拓展抽屉；不传则不显示入口 */
  onOpenAi?: () => void;
  /** 打开题目质检面板；不传则不显示入口 */
  onOpenAudit?: () => void;
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
  draftCount,
  hintCount,
  onTrackChange,
  onKeywordChange,
  onSearch,
  onOpenKnowledge,
  onOpenHidden,
  onOpenDrafts,
  onOpenHints,
  onOpenAi,
  onOpenAudit,
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
        {/* 题目质检：AI 也参与，所以与 AI 拓展同一套可用性口径（总开关关着就不渲染） */}
        {onOpenAudit && !aiHidden ? (
          <Button
            className="interview-search__audit"
            icon={<SafetyCertificateOutlined />}
            disabled={Boolean(aiDisabledText)}
            title={aiDisabledText || "把当前筛选下的题目送上去核对答案与分类"}
            onClick={onOpenAudit}
          >
            题目质检
          </Button>
        ) : null}
        {/* 草稿箱：草稿不进合并视图，不在这里给入口就等于把内容丢进黑洞 */}
        <Button className="interview-search__drafts" icon={<InboxOutlined />} onClick={onOpenDrafts}>
          {draftCount > 0 ? `草稿箱 ${draftCount}` : "草稿箱"}
        </Button>
        {/* 解除名词绑定是破坏性的（那段文字不再可点，也就没法再右键它）：
            有记录时必须留一个能反悔的入口；一条都没有就不占顶栏位置 */}
        {hintCount > 0 ? (
          <Button
            className="interview-search__hints"
            icon={<DisconnectOutlined />}
            onClick={onOpenHints}
          >
            已解除 {hintCount} 处
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
