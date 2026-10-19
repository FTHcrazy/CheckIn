import { useEffect, useState } from "react";
import { App, Button, InputNumber, Select, Switch } from "antd";
import type { LogSettingsDTO } from "@/shared/types/electron";
import "./index.scss";

const LEVEL_OPTIONS = [
  { value: "debug", label: "详细（debug）" },
  { value: "info", label: "常规（info）" },
  { value: "warn", label: "仅警告（warn）" },
  { value: "error", label: "仅错误（error）" },
] as const;

/**
 * 诊断分区（1.47.0 本地日志）
 *
 * 刻意保持很小：日志的定位是「出问题时能拿出证据」，不是给用户调参玩。
 * 三个可调项（级别 / IPC 记录 / 保留天数）对应三种排查场景：
 * - 复现偶发 bug → 调到 debug；
 * - 怀疑主进程与渲染层通信失败 → 打开 IPC 记录（写独立的 ipc.log）；
 * - 磁盘吃紧 → 缩短保留天数。
 *
 * 「打开日志目录」走主进程 `shell.openPath`（渲染进程没有文件系统权限，
 * 也不该知道真实的用户目录 hash 名）。
 */
export default function DiagnosticSection() {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<LogSettingsDTO | null>(null);

  useEffect(() => {
    void window.electronAPI?.log
      ?.getConfig()
      .then((value) => setSettings(value ?? null))
      .catch(() => setSettings(null));
  }, []);

  const patch = async (next: Partial<LogSettingsDTO>): Promise<void> => {
    const saved = await window.electronAPI?.log?.setConfig(next);
    if (saved) setSettings(saved);
    message.success("已保存");
  };

  const openDir = async (): Promise<void> => {
    const ok = await window.electronAPI?.log?.openDir();
    if (!ok) message.warning("日志目录还不存在，先操作一下应用再试");
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">诊断</h2>
      <div className="settings-section__body">
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">本地日志</span>
            <span className="settings-item__hint">
              按登录用户与窗口分目录存放，每行带时间 / 级别 / 模块，便于定位问题
            </span>
          </div>
          <Button className="settings-diag__btn" onClick={() => void openDir()}>
            打开日志目录
          </Button>
        </div>

        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">日志级别</span>
            <span className="settings-item__hint">
              低于该级别的记录不落盘；IPC 通信日志单独存 ipc.log
            </span>
          </div>
          <Select
            className="settings-diag__select"
            value={settings?.level ?? "info"}
            options={[...LEVEL_OPTIONS]}
            onChange={(value) => void patch({ level: value })}
          />
        </div>

        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">记录 IPC 通信</span>
            <span className="settings-item__hint">
              只记失败与慢于 300ms 的调用，正常高频调用不会刷屏
            </span>
          </div>
          <Switch
            checked={settings?.ipc ?? true}
            onChange={(checked) => void patch({ ipc: checked })}
          />
        </div>

        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">保留天数</span>
            <span className="settings-item__hint">超期文件在下次启动或跨天时自动清理</span>
          </div>
          <InputNumber
            className="settings-diag__number"
            min={1}
            max={90}
            value={settings?.retentionDays ?? 7}
            onChange={(value) => {
              if (typeof value === "number") void patch({ retentionDays: value });
            }}
          />
        </div>
      </div>
    </section>
  );
}
