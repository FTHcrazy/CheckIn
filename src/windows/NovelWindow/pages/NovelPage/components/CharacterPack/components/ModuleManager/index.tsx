import { Button, Modal, Switch } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleDesc, moduleLabel } from "../module-meta";
import "./index.scss";

interface ModuleManagerProps {
  api: PackPanelApi;
}

/** 模块拼装（E-1）：启用 / 排序 / 恢复默认 */
export default function ModuleManager({ api }: ModuleManagerProps) {
  const ordered = api.modules;

  const move = (index: number, delta: number) => {
    const next = [...ordered];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    api.setModuleOrder(next.map((module) => module.key));
  };

  return (
    <Modal
      open={api.moduleManagerOpen}
      title="模块管理"
      centered
      width={420}
      onCancel={() => api.setModuleManagerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button icon={<ReloadOutlined />} onClick={api.resetModules}>
            恢复默认
          </Button>
          <Button type="primary" onClick={() => api.setModuleManagerOpen(false)}>
            完成
          </Button>
        </div>
      }
    >
      <p className="cpk-guard__sub">
        关掉的模块会从面板上消失（配置保留，随时可以再打开）。顺序以拖动上下的方式调整。
      </p>
      <ul className="cpk-mgr">
        {ordered.map((module, index) => (
          <li key={module.key} className="cpk-mgr__row">
            <span className="cpk-mgr__ops">
              <Button
                className="cpk-iconbtn tiny"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="上移"
              >
                <ArrowUpOutlined />
              </Button>
              <Button
                className="cpk-iconbtn tiny"
                onClick={() => move(index, 1)}
                disabled={index === ordered.length - 1}
                title="下移"
              >
                <ArrowDownOutlined />
              </Button>
            </span>
            <span className="cpk-mgr__text">
              <span className="cpk-mgr__label">{moduleLabel(module.key)}</span>
              <span className="cpk-mgr__desc">{moduleDesc(module.key)}</span>
            </span>
            <Switch
              size="small"
              className="cpk-sw2"
              checked={module.enabled}
              onChange={(checked) => api.setModuleEnabled(module.key, checked)}
              title={module.enabled ? "已启用" : "已关闭"}
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
