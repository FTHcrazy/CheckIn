import { ClusterOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import WindowHeader from "@/shared/components/WindowHeader";
import { useGlobalSetting } from "./hooks/useGlobalSetting";
import GsBody from "./components/GsBody";
import "./index.scss";

/**
 * GlobalSettingWindow —— 全局设定中心独立窗口（Q1 定稿）
 *
 * 与行囊窗口同范式：单实例、即关即销、数据全部在主进程（窗口不持有草稿）。
 *
 * 状态机仍复用 shared 的 `useSettingCenter`（与书本侧同一份，见 `components/GsBody`），
 * 但**外壳是窗口私有的**：不再渲染 shared 的 `<SettingCenter>`，换成
 * `GsBody`（左栏带搜索 / 筛选 / 排序 / 引用徽标 / 双击改名 / 右键菜单，右栏顶部
 * 加一条常驻的「影响面条」，空库给引导卡）。重设计过程与取舍见 CHANGELOG 1.45.x。
 *
 * 实时刷新：`useGlobalSetting` 订阅 `global-setting-changed` 广播 —— 书侧
 * 建立引用 / 上架也会触发（写后重载），无需重开窗口即可看到计数变化。
 *
 * ⚠️ 三态分流的顺序不能变：**装载中 → 装载失败 → 主体**。装载失败必须落到
 * 可见的 `Alert` + 重试，**不得**退化成空库引导（那等于把失败伪装成「一个设定
 * 都没有」，见 R7④）。
 */
export default function GlobalSettingWindowApp() {
  const globalSetting = useGlobalSetting();

  return (
    <div className="window-shell">
      {/* 确认框的 contextHolder 必须渲染在组件树里（在 ThemeProvider/ConfigProvider 之内），
          才能继承主题 —— 静态 Modal.confirm 会脱离上下文导致暗色掉色（见 useGlobalSetting）。
          ⚠️ 必须排在 .gs-shell 之前：确认框由主体内的动作触发，holder 先挂载才能保证
          弹窗拿到上下文。 */}
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
          <GsBody data={globalSetting} />
        )}
      </div>
    </div>
  );
}
