import { App as AntApp } from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import MapEditorPage from "./pages/MapEditorPage";

/**
 * MapWindow —— 地图编辑器窗口（full 版开放入口，即关即销）。
 *
 * 本文件只做窗口壳组装（标题栏 + 页面），页面逻辑与样式各自归位：
 * - pages/MapEditorPage   画布 + 素材面板 + 工具栏
 *
 * 【为什么这里必须包一层 antd `<App>`】页面与 `useMapPersistence` 都用
 * `AntApp.useApp()` 取 `message` / `modal`。而 antd 的 `AppContext` 默认值是
 * `{ message: {}, notification: {}, modal: {} }`（`antd/es/app/context.js`）——
 * **没有 `<App>` 时不会报"缺少 Provider"，而是给你三个空对象**：调用
 * `message.success(...)` 直接 `TypeError`，`modal.confirm(...)` 同样抛。
 * 后果是静默的：写操作其实已经成功，但收尾那句话抛错，promise 变成 reject，
 * 于是「二次确认弹窗不关 + 列表不刷新」（删除地图就是这么坏了大半年）。
 *
 * `component={false}`：不额外套 div，避免打断 `.window-shell__body` 的
 * `height: 100%` 链（画布靠它撑满）；`message` / 弹窗的宿主节点照常挂载。
 *
 * 窗口边界：不与其它窗口互相导入（AGENTS §2.2.0）。
 */
export default function MapWindowApp() {
  return (
    <AntApp component={false}>
      <div className="window-shell">
        <WindowHeader title="地图" icon={<EnvironmentOutlined />} />
        <div className="window-shell__body">
          <div className="map-window-page">
            <MapEditorPage />
          </div>
        </div>
      </div>
    </AntApp>
  );
}
