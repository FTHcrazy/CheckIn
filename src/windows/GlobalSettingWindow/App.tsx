import { useCallback } from "react";
import { ClusterOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
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
 * ⚠️ 传 `variant="panel"`，**不套外层 Modal**（1.45.1）：本窗口整窗就是这一张
 * 设定中心，再套一层浮层就是「窗口套弹窗」—— 标题栏与浮层标题重复（两处都写
 * 「全局设定中心」）、多出第二枚关闭叉、还多一层遮罩（连带要在 index.scss 里把
 * 标题栏 z-index 抬到遮罩之上，三键才点得到）。`variant="panel"` 下标题改由窗口
 * 标题栏出（`跨书共享` 徽标挂在标题右侧插槽），内容区直接铺满。
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
      {/* 确认框的 contextHolder 必须渲染在组件树里（在 ThemeProvider/ConfigProvider 之内），
          才能继承主题 —— 静态 Modal.confirm 会脱离上下文导致暗色掉色（见 useGlobalSetting） */}
      {globalSetting.modalContextHolder}
      <WindowHeader
        title="全局设定中心"
        icon={<ClusterOutlined />}
        // 「跨书共享」原本是浮层标题里的 pill；去掉浮层后移到标题栏，
        // 保住这条关键语义（这里的设定会被别的书引用，改动会同步过去）
        badge={<span className="gs-window__badge">跨书共享</span>}
      />
      <div className="window-shell__body">
        {globalSetting.loading ? (
          <div className="gs-window__loading">正在打开全局设定中心…</div>
        ) : globalSetting.loadError ? (
          // 装载失败：必须是**可见错误态**而不是白屏 / 永久「正在打开…」。
          // 空库与装载失败是两件事，混在一起会让用户以为数据丢了。
          <div className="gs-window__error">
            <Alert
              type="error"
              showIcon
              title="全局设定库装载失败"
              description={globalSetting.loadError}
              action={
                <Button size="small" onClick={globalSetting.reload}>
                  重试
                </Button>
              }
            />
          </div>
        ) : (
          // panel 形态：整窗就是这一张设定中心，不套 Modal。
          // `open` 仍传（对外契约要求），panel 形态下不参与渲染。
          <SettingCenter
            source="global"
            variant="panel"
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
            // 模板能力绑 workId，属本书域；全局库本期不做（U3）——**不传**模板 props
            // 即「本形态不提供模板能力」，SettingCenter 据此收走「另存为模板」入口、
            // SaveTemplateModal 与模板库里的「我的模板」区块（此前传 5 个空实现 +
            // 组件无条件渲染 = 点了没反应的僵尸入口，N-04）。
            // ⚠️ 「模板库」入口**仍然保留**：内置预设是纯本地能力（SETTING_PRESETS 常量，
            // 不依赖 IPC），`onApplyPreset` 全局库有真实实现 —— 一并收走会让全局库
            // 白白丢掉「套用内置预设」。
            onApplyPreset={globalSetting.onApplyPreset}
          />
        )}
      </div>
    </div>
  );
}
