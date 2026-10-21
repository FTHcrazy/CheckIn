import { ClusterOutlined, ImportOutlined, LoadingOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import "./index.scss";

interface ShelfTopBarProps {
  workCount: number;
  /** 紧凑字数文案（64.6 万），由页面用 formatWordsCompact 派生 */
  totalWordsText: string;
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
 * 书架顶栏（R32）：书架标题 + 规模胶囊 + 搜索 + 全局设定 + 导入 + 新建作品。
 * 搜索词同时驱动书卡与灵感库过滤（一处输入，两处生效）。
 */
export default function ShelfTopBar({
  workCount,
  totalWordsText,
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
        <span className="bs-topbar__capsule">
          {workCount} 部作品 · {totalWordsText}字
        </span>
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
        {/* 「全局设定中心」独立窗口入口：与搜索 / 导入 / 新建同一行，置于「新建作品」左侧。
            图标 + 文字标签，保证可发现性；锚点供新手引导第 6 步高亮（M14）。 */}
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
        <Tooltip title={importing ? importPhase || "正在导入" : "导入 TXT 书籍"}>
          <Button
            className="bs-topbar__import"
            icon={<ImportOutlined />}
            onClick={onImportClick}
            loading={importing}
            disabled={importing}
          >
            {importing ? "导入中" : "导入书籍"}
          </Button>
        </Tooltip>
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
