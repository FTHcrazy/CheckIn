import { Badge, Button, Input, Tooltip } from "antd";
import {
  ClusterOutlined,
  ImportOutlined,
  LoadingOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import SvgIcon from "@/shared/components/SvgIcon";
import recycleBinSvg from "@/assets/novel/recycle-bin.svg?raw";
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
  /** 打开「数据安全」面板（一键全量备份 / 从备份恢复） */
  onSafetyClick: () => void;
  /** 打开回收站页面（2.5.0 起是独立页面，不再挤在数据安全弹窗里） */
  onTrashClick: () => void;
  /** 回收站里还有几项（>0 时按钮上挂角标，提示「有东西可以捞回来」） */
  trashCount?: number;
}

/**
 * 书架顶栏（R32）：书架标题 + 规模摘要 + 搜索 + 工具条 + 新建作品。
 *
 * 布局收敛过一次（2.5.1）：原先右侧是「搜索 + 四颗带文字的描边胶囊 + 主按钮」，
 * 六件东西平铺在同一行，视觉上像一排并列的按钮，主次全糊在一起。现在收成三段：
 *
 * ```
 * 书架 · 规模摘要          [ 搜索框 ]  ┊ ( 全局设定 | 备份 | 回收站 | 导入 )  [+ 新建作品]
 * ```
 *
 * - 四颗描边胶囊并进 `.bs-topbar__tools` —— 一个 surface 底的胶囊容器，读作
 *   「一排工具」而不是「四个按钮」；其中只有「全局设定中心」保留文字（跨书共享库
 *   是本页最需要被发现的次级入口，也是新手引导第 6 步的锚点），其余降为纯图标，
 *   语义交给 Tooltip 与 aria-label。
 * - 规模摘要从紫色 pill 降为静音小字：下面四张统计卡已经把这个数字讲了一遍，
 *   顶栏再放一颗同色色块只会跟主按钮抢焦点。
 * - 主按钮（新建作品）留在工具条外侧，靠间距与实底拉开层级。
 *
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
  onSafetyClick,
  onTrashClick,
  trashCount = 0,
}: ShelfTopBarProps) {
  return (
    <div className="bs-topbar">
      <div className="bs-topbar__lead">
        <h1 className="bs-topbar__title">书架</h1>
        {/* 规模摘要：与下方统计卡同源，这里只做「静音提示」，
            不再用 primary-weak 胶囊（它会与主按钮抢焦点，见文件头）。 */}
        <span className="bs-topbar__meta" title={`${workCount} 部作品 · ${totalWordsText}字`}>
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
        {/* 工具条：一个容器装四颗入口。
            容器自身给底色与圆角，按钮不再各自描边 —— 这是「一排按钮」变成
            「一条工具条」的关键；四颗都还在这条 `.bs-topbar__actions` 里，
            引导锚点与「新建作品左侧」的位置关系不变。 */}
        <div className="bs-topbar__tools">
          {/* 「全局设定中心」独立窗口入口：工具条内唯一保留文字的一颗。
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
          {/* 数据安全（P0）：一键全量备份 / 从备份恢复。
              属「这本书会不会丢」的元操作，不该藏进设置抽屉或右键菜单里；
              但在顶栏只需占一个图标位，语义由 Tooltip 交代。 */}
          <Tooltip title="数据安全 · 一键全量备份与从备份恢复">
            <Button
              className="bs-topbar__safety"
              icon={<SafetyCertificateOutlined />}
              onClick={onSafetyClick}
              aria-label="数据安全"
            />
          </Tooltip>
          {/* 回收站：独立页面入口（图标是设计给的 recycle-bin.svg，跟着文字色走）。
              角标只数条数 —— 是「有东西可以捞回来」的提示，不是错误。 */}
          <Tooltip
            title={
              trashCount > 0
                ? `回收站里还有 ${trashCount} 项，30 天内可原样恢复`
                : "删除的作品 / 卷 / 章节会先进回收站，可随时找回"
            }
          >
            <Button
              className="bs-topbar__recycle"
              icon={
                <Badge count={trashCount} size="small" offset={[2, -2]}>
                  <SvgIcon svg={recycleBinSvg} />
                </Badge>
              }
              onClick={onTrashClick}
              aria-label="回收站"
            />
          </Tooltip>
          {/* 导入书籍（TXT）：导入中换成 loading 图标，进度文案退到 aria-label
              与 Tooltip —— 图标位放不下一行字，而这一格又必须稳定不撑宽。 */}
          <Tooltip title={importing ? importPhase || "正在导入" : "导入 TXT 书籍"}>
            <Button
              className="bs-topbar__import"
              icon={<ImportOutlined />}
              onClick={onImportClick}
              loading={importing}
              disabled={importing}
              aria-label={importing ? importPhase || "正在导入" : "导入书籍"}
              aria-busy={importing || undefined}
            />
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
