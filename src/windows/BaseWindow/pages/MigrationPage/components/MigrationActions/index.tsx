import { Button, Space } from "antd";
import { ExportOutlined, ImportOutlined } from "@ant-design/icons";
import "./index.scss";

interface MigrationActionsProps {
  exporting: boolean;
  importing: boolean;
  /** 未勾选任何数据时禁用导出 */
  canExport: boolean;
  onExport: () => void;
  onImport: () => void;
}

/** 导出 / 导入操作区 */
export default function MigrationActions({
  exporting,
  importing,
  canExport,
  onExport,
  onImport,
}: MigrationActionsProps) {
  return (
    <div className="migration-actions">
      <Space size={12} wrap>
        <Button
          type="primary"
          icon={<ExportOutlined />}
          loading={exporting}
          disabled={!canExport || importing}
          onClick={onExport}
        >
          {exporting ? "导出中" : "导出为 zip"}
        </Button>
        <Button icon={<ImportOutlined />} loading={importing} disabled={exporting} onClick={onImport}>
          {importing ? "导入中" : "导入 zip"}
        </Button>
      </Space>
    </div>
  );
}
