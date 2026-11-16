import { Button, Divider, Dropdown, Input, Select, Switch, Tooltip } from "antd";
import {
  BorderOutlined,
  ClearOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  GlobalOutlined,
  HighlightOutlined,
  MinusCircleOutlined,
  MoreOutlined,
  NodeIndexOutlined,
  PictureOutlined,
  RedoOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
} from "@ant-design/icons";
import { REGION_TOTAL_LIMIT, levelLabelOf } from "../../regions";
import { MAP_STYLES } from "../../style";
import { EXPORT_SIZES, type ExportSize } from "../../export";
import { POLYLINE_STYLES } from "../../polylineStyle";
import { BASE_IMAGES } from "../../sprites";
import { LABEL_SIZES, type MapLabelSize, type MapStyle } from "../../types";
import { MAP_SAVE_STATUS_TEXT, type MapTool } from "../../editorConstants";
import { useMapEditorState } from "../../hooks/useMapEditorState";
import { useMapEditor } from "../../hooks/useMapEditor";
import { useMapPersistence } from "../../persistence/useMapPersistence";
import "./index.scss";

interface MapToolbarProps {
  state: ReturnType<typeof useMapEditorState>;
  editor: ReturnType<typeof useMapEditor>;
  persistence: ReturnType<typeof useMapPersistence>;
  targetLevel: number;
  targetLevelOverflow: boolean;
  visibleLevels: Array<{ level: number; alpha: number }>;
  elementCountsByLevel: string;
  handleOpenLibrary: () => void;
  handleDelete: () => void;
  handlePickTool: (next: MapTool) => void;
  handleUndoPolylinePoint: () => void;
  finishPolyline: (options?: { closed?: boolean }) => void;
  handleCancelPolyline: () => void;
  handleUndoDraftPoint: () => void;
  closeDraft: () => void;
  handleCancelDraft: () => void;
  handleZoom: (direction: "in" | "out") => void;
  handleGenerateLand: () => void;
  handleExport: () => void;
  handleLabelSizeChange: (next: MapLabelSize) => void;
  handleClearLand: () => void;
  handleClear: () => void;
}

/**
 * 地图编辑器工具栏。
 *
 * 只渲染 UI：编辑态 / 文档数据 / 视图态由页面经 props 整体传入，组件内解构成
 * 与页面同名的局部变量，保证 JSX 主体与页面拆分前逐字一致（AGENTS §6.2.1）。
 */
export default function MapToolbar(props: MapToolbarProps) {
  const {
    editor,
    persistence,
    targetLevel,
    targetLevelOverflow,
    visibleLevels,
    elementCountsByLevel,
    handleOpenLibrary,
    handleDelete,
    handlePickTool,
    handleUndoPolylinePoint,
    finishPolyline,
    handleCancelPolyline,
    handleUndoDraftPoint,
    closeDraft,
    handleCancelDraft,
    handleZoom,
    handleGenerateLand,
    handleExport,
    handleLabelSizeChange,
    handleClearLand,
    handleClear,
  } = props;
  const {
    tool,
    splitRegions,
    setSplitRegions,
    seedText,
    setSeedText,
    pendingLabel,
    setPendingLabel,
    polylineStyleId,
    setPolylineStyleId,
    polylinePoints,
    draftPoints,
    exportSize,
    setExportSize,
    exporting,
    sceneReady,
    setGeneratorOpen,
    labelSize,
  } = props.state;
  const {
    doc,
    viewport,
    selectedId,
    selectedRegionId,
    selectedRegion,
    schema,
    currentLevel,
    canUndo,
    canRedo,
  } = editor;

  return (
    <div className="map-editor__toolbar">
      {/*
        地图库入口（最左）：显示"我在改哪张图" + 存档状态。
        【为什么放最左而不是收进「更多」】切图是低频但高权重的动作
        （改错图 = 一下午白干），当前文件名必须一直在眼前。
      */}
      <div className="map-editor__toolbar-group">
        <Tooltip title="地图库：切换 / 新建 / 重命名 / 绑定作品">
          <Button
            size="small"
            icon={<DatabaseOutlined />}
            onClick={() => void handleOpenLibrary()}
          >
            {/*
              标题自己包一层 span 做省略：地图名可到 40 字，直接让按钮撑开会把
              工具栏后半截挤到换行；而 antd Button 内部结构不是稳定契约，
              不去给它里面的节点写选择器。
            */}
            <span className="map-editor__library-title">{persistence.title || "地图库"}</span>
          </Button>
        </Tooltip>
        <Tooltip title={MAP_SAVE_STATUS_TEXT[persistence.status]}>
          <span
            className={`map-editor__save-dot map-editor__save-dot--${persistence.status}`}
            role="status"
            aria-label={MAP_SAVE_STATUS_TEXT[persistence.status]}
          />
        </Tooltip>
      </div>

      <Divider orientation="vertical" />

      <div className="map-editor__toolbar-group">
        <Tooltip title="撤销 (Ctrl+Z)">
          <Button
            size="small"
            icon={<UndoOutlined />}
            disabled={!canUndo}
            onClick={editor.undo}
          />
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Shift+Z)">
          <Button
            size="small"
            icon={<RedoOutlined />}
            disabled={!canRedo}
            onClick={editor.redo}
          />
        </Tooltip>
      </div>

      <Divider orientation="vertical" />

      <div className="map-editor__toolbar-group">
        <Tooltip title="删除选中 (Delete)">
          <Button
            size="small"
            icon={<DeleteOutlined />}
            disabled={!selectedId}
            onClick={handleDelete}
          />
        </Tooltip>
      </div>

      <Divider orientation="vertical" />

      {/*
        工具切换：选择 / 画区（R-REG-03）。
        【为什么是两个 Button 而不是 Segmented】`Segmented` 渲染的是 radio，
        键盘与读屏语义是"选项"；这里切换的是**指针语义**（点一下会发生什么），
        按按钮理解才对，也更便于按可访问名取用（`getByRole("button", {name:"画区"})`）。
      */}
      <div className="map-editor__toolbar-group">
        {/*
          三个模式按钮图标化（B1）：文字版曾把工具栏挤到换行，而模式的含义
          Tooltip 一句话就够。可访问名不丢 —— aria-label 与原文案一致，
          测试与读屏都按名字取用。
        */}
        <Tooltip title="选择：点击区块 / 素材进行选中与拖动">
          <Button
            size="small"
            type={tool === "select" ? "primary" : "default"}
            icon={<BorderOutlined />}
            aria-label="选择"
            aria-pressed={tool === "select"}
            onClick={() => handlePickTool("select")}
          />
        </Tooltip>
        <Tooltip title="画区：在画布上逐点勾勒一个区块（Enter 闭合、Esc 取消、双击闭合）">
          <Button
            size="small"
            type={tool === "draw" ? "primary" : "default"}
            icon={<HighlightOutlined />}
            aria-label="画区"
            aria-pressed={tool === "draw"}
            onClick={() => handlePickTool("draw")}
          />
        </Tooltip>
        <Tooltip title="折线：逐点画道路 / 河流 / 山脊 / 势力边界（Enter 收尾、Esc 取消、双击收尾）">
          <Button
            size="small"
            type={tool === "polyline" ? "primary" : "default"}
            icon={<NodeIndexOutlined />}
            aria-label="折线"
            aria-pressed={tool === "polyline"}
            onClick={() => handlePickTool("polyline")}
          />
        </Tooltip>
      </div>

      {/*
        折线动作区：只在折线态出现。
        样式下拉放在这里而不是属性面板里 —— "画之前先选档"比"画完再一个个改"顺，
        而属性面板负责的是"这条线现在长什么样"（两条入口改的是同一个 `styleId`）。
        【为什么没有"层级"指示】折线的层级取落笔时的主导层级（与素材同规则），
        但**不做**区块那种"父块决定层级"的约束：一条官道可以横穿几个郡。
      */}
      {tool === "polyline" && (
        <>
          <Divider orientation="vertical" />
          <div className="map-editor__toolbar-group map-editor__draw-actions">
            <Select
              size="small"
              className="map-editor__polyline-style"
              value={polylineStyleId}
              aria-label="折线样式"
              onChange={(v) => setPolylineStyleId(v)}
              options={POLYLINE_STYLES.map((s) => ({
                value: s.id,
                // 档名 + "什么时候用它"的一句话（下拉里就能选对，不必先画一条试试）
                label: (
                  <span title={s.hint}>
                    {s.label}
                  </span>
                ),
              }))}
            />
            <span className="map-editor__draw-count">{`已画 ${polylinePoints.length} 点`}</span>
            <Tooltip title="撤掉最后落下的那个控制点（Backspace）">
              <Button
                size="small"
                icon={<UndoOutlined />}
                disabled={polylinePoints.length === 0}
                aria-label="撤销一个折线控制点"
                onClick={handleUndoPolylinePoint}
              >
                撤销上一点
              </Button>
            </Tooltip>
            <Tooltip
              title={
                polylinePoints.length < 2 ? "至少需要 2 个点才能成一条线" : "落库并选中（Enter）"
              }
            >
              <Button
                size="small"
                type="primary"
                disabled={polylinePoints.length < 2}
                aria-label="完成折线"
                onClick={() => finishPolyline()}
              >
                完成
              </Button>
            </Tooltip>
            <Tooltip title={polylinePoints.length > 0 ? "丢弃草稿（Esc）" : "退出折线"}>
              <Button size="small" aria-label="取消折线" onClick={handleCancelPolyline}>
                取消
              </Button>
            </Tooltip>
          </div>
        </>
      )}

      {/*
        画区动作区：只在画区态出现。
        【为什么"层级"是只读指示】新块的层级由"当前选中哪一块"唯一决定（裁决 5），
        让用户在这里改层级就等于引入第二个事实源 —— 想换层级，去点选父块。
        【为什么「完成」在 <3 点时 disabled】三点才能构成面；给一个点了没反应的
        按钮比不给更糟（用户会反复点）。
      */}
      {tool === "draw" && (
        <>
          <Divider orientation="vertical" />
          <div className="map-editor__toolbar-group map-editor__draw-actions">
            <span
              className={
                targetLevelOverflow
                  ? "map-editor__draw-level map-editor__draw-level--overflow"
                  : "map-editor__draw-level"
              }
              title={
                targetLevelOverflow
                  ? `已达最深层级（共 ${schema.length} 级）：选一个更浅的区块再画`
                  : selectedRegion
                    ? `将作为「${selectedRegion.name}」的子区块`
                    : "未选中区块：将画在顶层"
              }
            >
              {/*
                【层级文案为什么带 L 序号】只显示名称时，两个层级同名（用户可能把
                两级都叫"区域"）就看不出自己在画第几层。`levelLabelOf` 对空名回落
                成 `L{n}`，两者拼起来任何配置下都可读。
                【2.42.0】层级已下线（schema 仅 1 级）：选中区块后再画必然越界，
                此时不再拼"层级 L2 L2"这种双 L 回落串，直接给封顶提示。
              */}
              {targetLevelOverflow
                ? `已达最深层级（共 ${schema.length} 级）`
                : `层级 L${targetLevel + 1} ${levelLabelOf(schema, targetLevel)}`}
            </span>
            <span className="map-editor__draw-count">
              {`已画 ${draftPoints.length} 点 · 已用 ${doc.regions.length}/${REGION_TOTAL_LIMIT}`}
            </span>
            <Tooltip title="撤掉最后落下的那个顶点">
              <Button
                size="small"
                icon={<UndoOutlined />}
                disabled={draftPoints.length === 0}
                onClick={handleUndoDraftPoint}
              >
                撤销上一点
              </Button>
            </Tooltip>
            <Tooltip
              title={
                draftPoints.length < 3
                  ? "至少需要 3 个顶点才能闭合"
                  : "闭合多边形并创建区块（Enter）"
              }
            >
              <Button
                size="small"
                type="primary"
                disabled={draftPoints.length < 3}
                onClick={closeDraft}
              >
                完成
              </Button>
            </Tooltip>
            <Tooltip title={draftPoints.length > 0 ? "丢弃草稿（Esc）" : "退出画区"}>
              <Button size="small" onClick={handleCancelDraft}>
                取消
              </Button>
            </Tooltip>
          </div>
        </>
      )}

      <Divider orientation="vertical" />

      <div className="map-editor__toolbar-group">
        <Tooltip title="缩小">
          <Button size="small" icon={<ZoomOutOutlined />} onClick={() => handleZoom("out")} />
        </Tooltip>
        <span className="map-editor__zoom-label">
          {Math.round(viewport.scale * 100)}%
        </span>
        <Tooltip title="放大">
          <Button size="small" icon={<ZoomInOutlined />} onClick={() => handleZoom("in")} />
        </Tooltip>
        <Tooltip title="适应窗口">
          <Button size="small" icon={<ExpandOutlined />} onClick={editor.fitView} />
        </Tooltip>
      </div>

      {currentLevel !== null && (
        <>
          <Divider orientation="vertical" />
          <Tooltip
            title={
              `缩放 ${Math.round(viewport.scale * 100)}% · ` +
              visibleLevels
                .map((v) => `${levelLabelOf(schema, v.level)} ${Math.round(v.alpha * 100)}%`)
                .join(" · ") +
              (elementCountsByLevel ? `｜素材：${elementCountsByLevel}` : "")
            }
          >
            <span className="map-editor__level-chip">
              {visibleLevels.length > 1
                ? visibleLevels.map((v) => levelLabelOf(schema, v.level)).join(" ↔ ")
                : levelLabelOf(schema, currentLevel)}
            </span>
          </Tooltip>
        </>
      )}

      <Divider orientation="vertical" />

      {/*
        一键成图（B3 / R-MAP-21）：生成器入口。
        【为什么在「生成陆地」左边】它是"从零到一张图"的主路径（新用户第一下
        该点的按钮），「生成陆地」等手动动作降为进阶路径。
      */}
      <div className="map-editor__toolbar-group">
        <Tooltip title="随机生成整张图（陆地 + 素材 + 聚落与道路 + 地名，可撤销）">
          <Button
            size="small"
            icon={<PictureOutlined />}
            onClick={() => setGeneratorOpen(true)}
          >
            一键成图
          </Button>
        </Tooltip>
      </div>

      <Divider orientation="vertical" />

      <div className="map-editor__toolbar-group">
        <Tooltip
          title={
            splitRegions
              ? "生成陆地，并在陆地内部重新划分区块（手动区块保留，可撤销）"
              : "只生成陆地，不划分区块（自动区块清除，手动区块保留，可撤销）"
          }
        >
          <Button size="small" icon={<GlobalOutlined />} onClick={handleGenerateLand}>
            生成陆地
          </Button>
        </Tooltip>
        {/*
          「同时划出区块」（R-REG-02）：默认关。
          做成「生成陆地」的**配套下拉**而不是第二个按钮 —— 它是同一个动作的一个选项，
          分开放会让人以为是两条命令。用 `Switch` 而不是勾选菜单项：
          菜单项点一下就关闭，用户看不到"当前是开还是关"。
        */}
        <Dropdown
          trigger={["click"]}
          placement="bottomLeft"
          popupRender={() => (
            <div className="map-editor__land-options">
              <div className="map-editor__more-row map-editor__more-row--between">
                <span className="map-editor__more-label">同时划出区块</span>
                <Switch
                  size="small"
                  aria-label="同时划出区块"
                  checked={splitRegions}
                  onChange={setSplitRegions}
                />
              </div>
              <div className="map-editor__land-options-hint">
                勾选后与旧版一致（在陆地内逐岛切分）；默认只生成陆地，分区留给你手动划分。
              </div>
            </div>
          )}
        >
          {/*
            ⚠️ 可访问名不能含"生成陆地"（否则按 name=/生成陆地/ 取按钮会命中两个，
            既有页面用例会以 "found multiple elements" 变红，且那与被测行为无关）。
          */}
          <Button size="small" icon={<DownOutlined />} aria-label="陆地选项" />
        </Dropdown>
        {/*
          陆地种子（状态指示，保留在主栏）：生成陆地后紧跟按钮显示，评审/截图
          比对要靠它复现同一块陆地，收进「更多」会让它脱离操作上下文。
        */}
        {doc.land && <span className="map-editor__land-seed">seed {doc.land.seed}</span>}
        {/*
          「生成区块」按钮 2.50.0 移除：国家生成已并入**一键成图**的「生成国家」
          选项（算法对齐逆向目标，见 `domain/countries.ts`）。留在主栏会让人以为
          这是"另一条切分算法"，而它现在只会产出与新算法观感不一致的 Voronoi 图。
        */}
        {/*
          「国家分区」：预留入口（2.50.0）。
          语义是"选中一个国家后，在它内部再划分下级区域"——参考实现的
          `start_state0` / `start_state1`（郡 / 州）就是这一层。当前只做到
          国家一级（用户裁决 2.42.0 关闭层级），所以这里先占位、禁用到实现为止。
          【为什么现在就摆出来】用户明确要求"预留"，且按钮位置本身是设计决策：
          它必须挨着国家相关操作，等真做的时候不用再挪工具栏。
        */}
        <Tooltip
          title={
            selectedRegionId
              ? "在选中的国家内部再划分下级区域（暂未开放）"
              : "先选中一个国家，再在它内部划分下级区域（暂未开放）"
          }
        >
          <Button size="small" icon={<NodeIndexOutlined />} aria-label="国家分区" disabled>
            国家分区
          </Button>
        </Tooltip>
        {/*
          区块数（状态指示，保留在主栏）：这是「生成国家」后最重要的即时反馈，
          且多个端到端用例靠它确认生成完成，收进「更多」反而打断操作节奏。
        */}
        {doc.regions.length > 0 && (
          <span className="map-editor__region-count">已生成 {doc.regions.length} 块</span>
        )}
      </div>

      <Divider orientation="vertical" />

      <div className="map-editor__toolbar-group">
        <Tooltip title="在画布上单击落位，然后输入地名（回车确认、Esc 取消、空文本不创建）">
          <Button
            size="small"
            type={pendingLabel ? "primary" : "default"}
            icon={<EditOutlined />}
            aria-label="加标注"
            onClick={() => {
              // 与"待放置素材""画区"三者互斥：一次点击只能有一种落位意图
              setPendingLabel((v) => !v);
              editor.setPendingSpriteId(null);
              handlePickTool("select");
            }}
          />
        </Tooltip>
        {/*
          地名计数（状态指示，保留在主栏）：与「素材 N」同理，是「加标注」后
          的即时反馈，紧跟操作点。
          【素材的「地名」输入框已迁入属性面板（B1）】它是"选中对象的属性"，
          跟尺寸 / 旋转同一语境 —— 放工具栏等于把属性拆在两处。
        */}
        <span className="map-editor__label-count">地名 {doc.labels.length}</span>
      </div>

      <div className="map-editor__toolbar-spacer" />

      <Tooltip title="把当前地图导出成 PNG（成品图，不含选中框）">
        <Button
          size="small"
          type="primary"
          icon={<DownloadOutlined />}
          loading={exporting}
          disabled={!sceneReady}
          onClick={handleExport}
        >
          导出 PNG
        </Button>
      </Tooltip>

      {/*
        「更多」收纳面板：低频 / 需要状态说明的操作收进来，主工具栏只留高频，
        避免窗口较窄时工具栏换行错乱。用 popupRender 放 Select/Switch/Input
        （menu items 只适合纯按钮动作）。
      */}
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        popupRender={() => (
          <div className="map-editor__more-panel">
            <div className="map-editor__more-row">
              <span className="map-editor__more-label">风格</span>
              <Select<MapStyle>
                className="map-editor__select map-editor__select--style"
                size="small"
                value={doc.style}
                style={{ width: 108 }}
                options={MAP_STYLES.map((item) => ({ value: item.key, label: item.label }))}
                onChange={editor.setStyle}
              />
            </div>
            <div className="map-editor__more-row">
              <span className="map-editor__more-label">底图</span>
              {/*
                底图家族（B3）：4 档同风格海面/羊皮纸纹理，切换即时生效。
                换底图走撤销栈（与风格同档）——切错了 Ctrl+Z 能回来。
              */}
              <Select
                className="map-editor__select map-editor__select--base"
                size="small"
                value={doc.baseImageId}
                style={{ width: 108 }}
                options={BASE_IMAGES.map((b) => ({ value: b.id, label: b.label }))}
                onChange={editor.setBaseImage}
              />
            </div>
            <div className="map-editor__more-row">
              <span className="map-editor__more-label">导出尺寸</span>
              <Select<ExportSize>
                className="map-editor__select map-editor__select--export"
                size="small"
                value={exportSize}
                style={{ width: 108 }}
                options={EXPORT_SIZES.map((size) => ({ value: size, label: `${size}px` }))}
                onChange={setExportSize}
              />
            </div>
            <div className="map-editor__more-row">
              <span className="map-editor__more-label">地名字号</span>
              <Select<MapLabelSize>
                className="map-editor__select map-editor__select--label-size"
                size="small"
                value={labelSize}
                style={{ width: 108 }}
                options={LABEL_SIZES.map((size) => ({ value: size, label: `${size} 号` }))}
                onChange={handleLabelSizeChange}
              />
            </div>
            <div className="map-editor__more-row">
              <span className="map-editor__more-label">陆地种子</span>
              <Input
                size="small"
                value={seedText}
                placeholder="留空 = 随机"
                style={{ width: 108 }}
                onChange={(e) => setSeedText(e.target.value)}
              />
            </div>
            <div className="map-editor__more-row map-editor__more-row--between">
              <span className="map-editor__more-label">显示分区</span>
              <Switch
                size="small"
                checked={doc.showRegions}
                onChange={editor.toggleRegions}
              />
            </div>
            <Divider style={{ margin: "8px 0" }} />
            <div className="map-editor__more-actions">
              <Button
                size="small"
                icon={<MinusCircleOutlined />}
                disabled={!doc.land}
                onClick={handleClearLand}
              >
                清除陆地
              </Button>
              <Button
                size="small"
                icon={<MinusCircleOutlined />}
                disabled={doc.regions.length === 0}
                onClick={editor.clearRegions}
              >
                清除区块
              </Button>
              <Button
                size="small"
                danger
                icon={<ClearOutlined />}
                disabled={doc.elements.length === 0}
                onClick={handleClear}
              >
                清空画布
              </Button>
            </div>
          </div>
        )}
      >
        <Button size="small" icon={<MoreOutlined />} />
      </Dropdown>

      <span className="map-editor__count">素材 {doc.elements.length}</span>
    </div>
  );
}
