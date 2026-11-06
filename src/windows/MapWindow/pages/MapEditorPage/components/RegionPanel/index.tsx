import { Button, Space, Tag, Tooltip } from "antd";
import {
  ApartmentOutlined,
  CloseOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  MergeCellsOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import type { MapRegion, RegionLevelDef } from "../../regions";
import { levelLabelOf } from "../../regions";
import "./index.scss";

/**
 * 区块操作面板 —— 选中一个区块后浮出的上下文操作条。
 *
 * 【职责】把「嵌套子地图」的两条生成路径与"进入/退出"闭环暴露给用户：
 *   · 未嵌子图 → 「圈定生成子图」（路径 B）+「绑定已有子图」（路径 A′ 跨图选择器）
 *   · 已嵌子图 → 子图摘要 + 「聚焦此区域」（进入）+「回到全景」（退出）+「移除子图」
 *   两者都追加「合并子区域」（R-REG-04）：把该区块的全部后代删掉，它自己成为叶子。
 *
 * 【为什么要"进入/退出"两个按钮】圈定生成之后，用户最先问的是"然后呢"。
 * 子图的分区线只有在视口推进到该区块、并继续放大时才会显现；面板上如果没有
 * 一个明确的"进入"动作，生成完就等于什么都没发生。退出用「回到全景」而不是
 * 撤销 —— 撤销会把子图一起撤掉，语义完全不同。
 */
interface RegionPanelProps {
  /** 当前选中的区块；null = 不渲染 */
  region: MapRegion | null;
  /**
   * 当前文档的有效层级定义（`regionSchemaOf(doc)` 的结果）。
   *
   * 【为什么必须由 props 传】层级名已经可配置（R-REG-01），面板不能再读常量表
   * `REGION_LEVELS`；而它是纯展示组件（不读 store），只能由页面递进来。
   */
  schema?: readonly RegionLevelDef[];
  /**
   * 选中区块的**祖先链 + 自身**（根 → 父 → 自身）。
   *
   * 【为什么由 props 传进来而不是在这里算】本组件是**纯展示**组件（不读 store）。
   * 面包屑要的 `doc.regions` 只有 hook 有，让面板去订阅 store 会破坏这个范式
   * （架构 §6-2）。
   */
  regionPath?: MapRegion[];
  /**
   * 选中区块是否叶子（`children(P).length === 0`）。
   *
   * 只有**非叶子**才显示面包屑：叶子是"最小可操作单位"，它的位置已经由画布上的
   * 面高亮表达清楚，再补一行路径只是噪声。
   */
  isLeaf?: boolean;
  /**
   * 子树摘要（后代的块数 / 其中带子图的块数），只用于按钮文案与灰化。
   *
   * `count = 0` ⇒ 叶子 ⇒ 「合并子区域」`disabled`。
   */
  subtreeInfo?: { count: number; withSubmap: number };
  /** 圈定生成子图（路径 B） */
  onCarve: (regionId: string) => void;
  /** 绑定已有子图（路径 A′：先弹跨图选择器，拷贝一张库里的图到该区块） */
  onEmbed: (regionId: string) => void;
  /** 合并该区块的全部子区块（R-REG-04） */
  onMerge: (regionId: string) => void;
  /** 移除子图 */
  onRemove: (regionId: string) => void;
  /** 把视口推进到该区块（进入子图视野） */
  onFocus: (regionId: string) => void;
  /** 视口退回整张纸 */
  onFocusWorld: () => void;
  /** 关闭面板（取消选中区块） */
  onClose: () => void;
}

export default function RegionPanel({
  region,
  schema,
  regionPath = [],
  isLeaf = true,
  subtreeInfo = { count: 0, withSubmap: 0 },
  onCarve,
  onEmbed,
  onMerge,
  onRemove,
  onFocus,
  onFocusWorld,
  onClose,
}: RegionPanelProps) {
  if (!region) return null;

  const levelLabel = levelLabelOf(schema, region.level);
  const submap = region.submap;
  const hasSubmap = Boolean(submap);
  // 渐入阈值：只有"自动推出来"的才有值（绑定已有子图时可能缺省）
  const enterPercent = region.submapEnterScale
    ? Math.round(region.submapEnterScale * 100)
    : null;

  /**
   * 面包屑各段。
   *
   * 【两道过滤，缺一不可】① `name` 为空的段直接跳过（否则会出现「a / / c」）；
   * ② 祖先被合并过导致断链时，`ancestorPathOf` 在 hook 里已停下，所以这里拿到的
   * 本身就是一条连续链 —— 不需要再补占位段，也**绝不**渲染 "undefined"
   * （PRD §6-A-④ 明确要求）。
   */
  const crumbs = regionPath.filter((r) => r.name.trim().length > 0);

  /**
   * 「合并子区域」按钮。
   *
   * 【为什么叶子要 disabled 而不是隐藏】隐藏会让面板的按钮数量随选中对象跳变，
   * 用户刚记住"倒数第二个是移除子图"，换个区块就全变了。灰化 + Tooltip 说明
   * "该区块没有子区域"，既保持布局稳定，也解释了为什么点不动（PRD §4.3）。
   *
   * 【为什么 Tooltip 里套一层 span】antd 的 `disabled` 按钮不派发鼠标事件，
   * 外层 Tooltip 收不到 hover ⇒ 说明文字永远不出现（这条在既有代码里是隐性坑）。
   * 套一层 `<span>` 让事件落在可接收的节点上，Tooltip 才有效。
   */
  const mergeButton = (
    <Tooltip
      title={
        isLeaf || subtreeInfo.count === 0
          ? "该区块没有子区域"
          : `将「${region.name.trim() || "未命名区块"}」下的 ${subtreeInfo.count} 个子区块合并为一个（可撤销）`
      }
    >
      <span className="region-panel__merge-wrap">
        <Button
          size="small"
          block
          icon={<MergeCellsOutlined />}
          disabled={isLeaf || subtreeInfo.count === 0}
          onClick={() => onMerge(region.id)}
        >
          合并子区域
          {subtreeInfo.count > 0 ? `（${subtreeInfo.count}）` : ""}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <div className="region-panel">
      <div className="region-panel__header">
        <span className="region-panel__title">区块操作</span>
        <Tooltip title="关闭（Esc）">
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
        </Tooltip>
      </div>

      {!isLeaf && crumbs.length > 0 && (
        <div className="region-panel__breadcrumb" aria-label="层级路径">
          {crumbs.map((crumb, index) => (
            <span key={crumb.id} className="region-panel__breadcrumb-item">
              {index > 0 && <span className="region-panel__breadcrumb-sep">/</span>}
              <span
                className={
                  crumb.id === region.id
                    ? "region-panel__breadcrumb-self"
                    : "region-panel__breadcrumb-ancestor"
                }
              >
                {crumb.name}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="region-panel__meta">
        <Tag className="region-panel__tag">{levelLabel}</Tag>
        <span className="region-panel__name">{region.name || "未命名区块"}</span>
      </div>

      <div className="region-panel__actions">
        {hasSubmap ? (
          <Space orientation="vertical" style={{ width: "100%" }} size={6}>
            <div className="region-panel__submap-hint">
              已嵌入子图 · {submap!.regions.length} 个分区
              {enterPercent !== null && ` · 放大到 ${enterPercent}% 后淡入`}
            </div>
            <Space size={6} wrap>
              <Tooltip title="把视口推进到这块地，继续放大即可看到子图分区">
                <Button
                  size="small"
                  type="primary"
                  icon={<ZoomInOutlined />}
                  onClick={() => onFocus(region.id)}
                >
                  聚焦此区域
                </Button>
              </Tooltip>
              <Tooltip title="视口退回整张纸（不会移除子图）">
                <Button size="small" icon={<ZoomOutOutlined />} onClick={onFocusWorld}>
                  回到全景
                </Button>
              </Tooltip>
            </Space>
            {/* 合并按钮：位置按 PRD §4.3 —— 「聚焦此区域」之后、「移除子图」之前 */}
            {mergeButton}
            <Tooltip title="移除该区块上的子图，恢复为普通区块（可撤销）">
              <Button
                size="small"
                danger
                type="text"
                block
                icon={<DeleteOutlined />}
                onClick={() => onRemove(region.id)}
              >
                移除子图
              </Button>
            </Tooltip>
            {/*
              下一阶段要补的内容，直接写在面板里 —— 用户能看见"还没有什么"，
              比默默只在文档里记一条待办更有用。
            */}
            <div className="region-panel__todo">
              子图内部的地貌与素材编辑在后续版本补齐；当前可查看其分区划分。
            </div>
          </Space>
        ) : (
          <Space orientation="vertical" style={{ width: "100%" }}>
            <Tooltip title="圈定该区块，在其内部现场生成一张子地图（可撤销）">
              <Button
                size="small"
                type="primary"
                icon={<ApartmentOutlined />}
                block
                onClick={() => onCarve(region.id)}
              >
                圈定生成子图
              </Button>
            </Tooltip>
            <Tooltip title="从地图库选一张图，拷贝一份绑定到该区块（可撤销）">
              <Button
                size="small"
                icon={<FolderOpenOutlined />}
                block
                onClick={() => onEmbed(region.id)}
              >
                绑定已有子图
              </Button>
            </Tooltip>
            {mergeButton}
          </Space>
        )}
      </div>
    </div>
  );
}
