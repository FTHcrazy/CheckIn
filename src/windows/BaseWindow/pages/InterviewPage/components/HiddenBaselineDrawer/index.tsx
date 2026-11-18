import { Button, Drawer, Empty, Typography } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { QUESTION_BY_ID } from "../../data/interview-bank";
import "./index.scss";

const { Text } = Typography;

interface HiddenBaselineDrawerProps {
  open: boolean;
  /** 合并视图给的 `hiddenIds`：被隐藏的**基线题** id（自建题的软删不在这里） */
  hiddenIds: readonly string[];
  /** 正在恢复的那条（按钮 loading） */
  pendingId: string | null;
  onRestore: (id: string) => void;
  onClose: () => void;
}

/**
 * 「已隐藏的默认题」抽屉。
 *
 * 隐藏（墓碑）是**删除内置题**的唯一形态：不真删，因为升级会把基线重新灌回来 ——
 * 真删了用户会发现「删掉的题又回来了」。所以必须有一个地方能把它们找回来，
 * 否则「隐藏」就是个不可撤销的操作。
 *
 * 标题从 `QUESTION_BY_ID` 取基线原文：墓碑行的 `payload` 是空的（不变量 3），
 * 库里只有 `title` 一列，用它展示等于信任那份可能被导入文件改过的副本。
 */
export default function HiddenBaselineDrawer({
  open,
  hiddenIds,
  pendingId,
  onRestore,
  onClose,
}: HiddenBaselineDrawerProps) {
  return (
    <Drawer
      className="interview-hidden"
      title={`已隐藏的默认题${hiddenIds.length > 0 ? ` · ${hiddenIds.length}` : ""}`}
      size="large"
      open={open}
      onClose={onClose}
      // 与 KnowledgeDrawer / QuestionEditDrawer 同一处理：整体下移 34px，
      // 让 × 不落进标题栏的拖动带（系统命中测试判成 HTCAPTION，点了没反应）
      styles={{ root: { top: "var(--app-window-header-height, 34px)" } }}
    >
      <Text type="secondary" className="interview-hidden__hint">
        隐藏的题只是不再出现在题库里，内置内容一直留着。点「恢复」即刻回到底部原来的位置。
      </Text>

      {hiddenIds.length === 0 ? (
        <Empty
          className="interview-hidden__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="没有隐藏的默认题"
        />
      ) : (
        <ul className="interview-hidden__list">
          {hiddenIds.map((id) => {
            const baseline = QUESTION_BY_ID[id] ?? null;
            return (
              <li className="interview-hidden__item" key={id}>
                <div className="interview-hidden__text">
                  <span className="interview-hidden__title">{baseline?.title ?? id}</span>
                  {baseline ? (
                    <span className="interview-hidden__meta">
                      {baseline.topic} · {id}
                    </span>
                  ) : (
                    // 升级时基线把这道题删了：覆盖行成了孤儿，还能恢复但内容取不到
                    <span className="interview-hidden__meta">
                      当前版本已没有这道默认题，恢复后不会显示
                    </span>
                  )}
                </div>
                <Button
                  className="interview-hidden__restore"
                  type="link"
                  size="small"
                  icon={<UndoOutlined />}
                  loading={pendingId === id}
                  onClick={() => onRestore(id)}
                >
                  恢复
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
