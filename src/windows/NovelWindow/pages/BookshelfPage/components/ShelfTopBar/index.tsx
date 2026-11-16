import { Button, Input, Tooltip } from "antd";
import {
  ClusterOutlined,
  ImportOutlined,
  LoadingOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import "./index.scss";

interface ShelfTopBarProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  onCreateClick: () => void;
  /** 导入书籍（TXT）；进行中按钮转 loading */
  onImportClick: () => void;
  importing: boolean;
  /** 导入进度文案（如「正在拆分章节…」），仅进行中展示 */
  importPhase?: string;
  /** 打开「全局设定中心」独立窗口（REQ-041；lite 版不打包该窗口） */
  onGlobalSettingClick: () => void;
  /**
   * 全局设定中心窗口正在打开（点过按钮、窗口尚未真正可见）。
   *
   * 与顶栏行囊按钮的 `packOpening` 同一条 REQ-054 修法：独立窗口首次创建要等
   * 整个 SPA 装载（dev 下 1–3s），期间屏幕上没有任何变化，作者会以为点了没反应
   * 再点一次。刻意不用 Button 的 `loading`（它会连 onClick 一起吞掉，而再点一次
   * 恰是窗口落到后面时的退路），只换内容、把点击留着。
   */
  globalSettingOpening?: boolean;
}

/**
 * 书架顶栏（R32）：书架标题 + 一句状态 + 搜索 + 三个首日动作。
 *
 * ```
 * 书架 · 本地优先                    [ 搜索框 ]  ( 全局设定中心 | 导入书籍 )  [+ 新建作品]
 * ```
 *
 * **入口从 5 收 3（O-10）**：数据安全与回收站都是「出事才会用」的元操作，
 * 却和「导入 / 新建」这两个首日动作并列同一排，等于把低频动作提到与主流程
 * 同权。它们现在在页脚（`bs-page__status`），离「作品列表」更远、离「元信息」
 * 更近。导入则从纯图标升为带文字按钮 —— 「怎么把已有的稿子搬进来」是新用户
 * 第一件要做的事，图标猜不出来。
 *
 * **规模摘要去重（O-11）**：原来这里的「N 部作品 · X 万字」与下方四张统计卡
 * 同源同义，且格式化函数不同（`64.6 万` / `64.6万`）—— 同一屏两个数字两种写法。
 * 顶栏现在只说一句状态（数据在哪），数字交给统计卡一个地方说。
 *
 * 搜索词同时驱动书卡与灵感库过滤（一处输入，两处生效）。
 */
export default function ShelfTopBar({
  keyword,
  onKeywordChange,
  onCreateClick,
  onImportClick,
  importing,
  importPhase,
  onGlobalSettingClick,
  globalSettingOpening = false,
}: ShelfTopBarProps) {
  return (
    <div className="bs-topbar">
      <div className="bs-topbar__lead">
        <h1 className="bs-topbar__title">书架</h1>
        {/* 状态语而不是数字：数字已经由下方统计卡讲过一遍（O-11） */}
        <span className="bs-topbar__meta">本地优先 · 全部数据存本机</span>
      </div>
      <div className="bs-topbar__actions">
        <Input
          className="bs-topbar__search"
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="搜索作品或灵感"
          variant="filled"
          allowClear
          prefix={<SearchOutlined />}
        />
        {/* 工具条：一个容器装两颗入口。
            容器自身给底色与圆角，按钮不再各自描边 —— 这是「一排按钮」变成
            「一条工具条」的关键；两颗都还在这条 `.bs-topbar__actions` 里，
            引导锚点与「新建作品左侧」的位置关系不变。 */}
        <div className="bs-topbar__tools">
          {/* 「全局设定中心」独立窗口入口：工具条内保留文字的一颗。
              图标 + 文字保证可发现性；锚点供新手引导第 6 步高亮（M14）。 */}
          <Tooltip
            title={
              globalSettingOpening
                ? "正在打开全局设定中心…"
                : "跨作品共享的设定库（引用后可随全局自动同步）"
            }
          >
            <Button
              className="bs-topbar__global-setting"
              icon={globalSettingOpening ? <LoadingOutlined spin /> : <ClusterOutlined />}
              onClick={onGlobalSettingClick}
              aria-label="全局设定中心"
              aria-busy={globalSettingOpening || undefined}
              data-tour-target="shelf-global-setting"
            >
              {globalSettingOpening ? "正在打开…" : "全局设定中心"}
            </Button>
          </Tooltip>
          {/* 导入书籍（TXT / DOCX）：升为带文字按钮（O-10）。
              导入中换成 loading 图标 + 进度文案，宽度保持稳定不跳。 */}
          <Tooltip title={importing ? importPhase || "正在导入" : "导入 TXT / DOCX 书籍"}>
            <Button
              className="bs-topbar__import"
              icon={<ImportOutlined />}
              onClick={onImportClick}
              loading={importing}
              disabled={importing}
              aria-label={importing ? importPhase || "正在导入" : "导入书籍"}
              aria-busy={importing || undefined}
            >
              {importing ? "正在导入…" : "导入书籍"}
            </Button>
          </Tooltip>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onCreateClick}
          data-tour-target="shelf-new-work"
        >
          新建作品
        </Button>
      </div>
    </div>
  );
}
