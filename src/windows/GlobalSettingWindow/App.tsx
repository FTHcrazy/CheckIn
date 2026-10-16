import { useCallback } from "react";
import { ClusterOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import SettingCenter from "@/shared/components/SettingCenter";
import { useGlobalSetting } from "./hooks/useGlobalSetting";
import "./index.scss";

/**
 * GlobalSettingWindow —— 全局设定中心独立窗口（Q1 定稿）
 *
 * 与行囊窗口同范式：单实例、即关即销、数据全部在主进程（窗口不持有草稿）。
 * 复用本书设定中心的三栏结构 —— 组件本体在 `shared/components/SettingCenter`
 * （跨窗口共享，窗口之间禁止互相导入），这里传 `source="global"` 切成
 * 「跨书共享库」形态：标题 / 提示语 / 动作区差异化，分类行带「N 部书引用」徽标。
 *
 * 实时刷新：`useGlobalSetting` 订阅 `global-setting-changed` 广播 —— 书侧
 * 建立引用 / 上架也会触发（写后重载），无需重开窗口即可看到计数变化。
 */
export default function GlobalSettingWindowApp() {
  const globalSetting = useGlobalSetting();

  /** 关窗：走 window-control（由各窗口自己的 close 语义决定行为，本窗口即关即销） */
  const closeWindow = useCallback(() => {
    window.electronAPI?.send("window-control", "close");
  }, []);

  return (
    <div className="window-shell">
      <WindowHeader title="全局设定中心" icon={<ClusterOutlined />} />
      <div className="window-shell__body">
        {globalSetting.loading ? (
          <div className="gs-window__loading">正在打开全局设定中心…</div>
        ) : (
          // open 恒真：整窗就是这一张设定中心；onClose（Esc / 点遮罩）收窗
          <SettingCenter
            source="global"
            open
            workName="跨书共享"
            settings={globalSetting.settings}
            focusCategoryId={null}
            onClose={closeWindow}
            onCreateCategory={globalSetting.onCreateCategory}
            onPatchCategory={globalSetting.onPatchCategory}
            onDeleteCategory={globalSetting.onDeleteCategory}
            onReorderCategories={globalSetting.onReorderCategories}
            onAddLevel={globalSetting.onAddLevel}
            onBatchAddLevels={globalSetting.onBatchAddLevels}
            onPatchLevel={globalSetting.onPatchLevel}
            onDeleteLevel={globalSetting.onDeleteLevel}
            onReorderLevels={globalSetting.onReorderLevels}
            onSplitLevel={globalSetting.onSplitLevel}
            onMergeLevel={globalSetting.onMergeLevel}
            onExport={globalSetting.onExport}
            // 模板能力绑 workId，属本书域；全局库本期不做（U3），给空实现
            onSaveTemplate={() => {}}
            templates={[]}
            onRefreshTemplates={() => {}}
            onApplyTemplate={() => {}}
            onDeleteTemplate={() => {}}
            onApplyPreset={globalSetting.onApplyPreset}
          />
        )}
      </div>
    </div>
  );
}
