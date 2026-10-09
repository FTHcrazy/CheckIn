import { EnvironmentOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import MapEditorPage from "./pages/MapEditorPage";

/**
 * MapWindow —— 地图编辑器窗口（full 版开放入口，即关即销）。
 *
 * 本文件只做窗口壳组装（标题栏 + 页面），页面逻辑与样式各自归位：
 * - pages/MapEditorPage   画布 + 素材面板 + 工具栏
 *
 * 窗口边界：不与其它窗口互相导入（AGENTS §2.2.0）。
 */
export default function MapWindowApp() {
  return (
    <div className="window-shell">
      <WindowHeader title="地图" icon={<EnvironmentOutlined />} />
      <div className="window-shell__body">
        <div className="map-window-page">
          <MapEditorPage />
        </div>
      </div>
    </div>
  );
}
