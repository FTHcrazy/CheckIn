import { EnvironmentOutlined } from "@ant-design/icons";
import "./index.scss";

/**
 * BaseWindow 标题栏「地图」入口。
 *
 * 点击后经主进程唤起 MapWindow（单实例：已开则聚焦）。
 * 仅作为 WindowHeader 的 actions 插槽使用，不承载任何地图逻辑本身。
 */
export default function MapEntry() {
  return (
    <button
      type="button"
      className="map-entry"
      title="地图"
      aria-label="打开地图"
      onClick={() => window.electronAPI?.send("map-window-open", null)}
    >
      <EnvironmentOutlined className="map-entry__icon" />
    </button>
  );
}
