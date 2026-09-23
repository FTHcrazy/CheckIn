import { GlobalOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import MapPage from "./pages/MapPage/MapPage";
import "./index.scss";

/**
 * MapWindow —— CheckIn 小说架空地图编辑器窗口（docs/novel-map-prd.md）。
 *
 * 独立窗口承载：默认 1120×720、即关即销、单实例唤起。
 * 画布操作（拖拽/缩放/画笔）与编辑器互不抢焦点（独立窗口天然满足）。
 * 与 WorkerWindow 互不 import，联动全靠 SQLite + 主进程广播。
 */
export default function MapWindowApp() {
  return (
    <div className="window-shell">
      <WindowHeader
        title="CheckIn 地图"
        icon={<GlobalOutlined />}
        badge={<span className="map-badge">架空世界</span>}
      />
      <div className="window-shell__body">
        <MapPage />
      </div>
    </div>
  );
}
