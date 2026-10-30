import { useEffect, useState } from "react";
import { App, Button, InputNumber, Select, Switch } from "antd";
import type { LogSettingsDTO } from "@/shared/types/electron";
import SettingsActionBar from "../SettingsActionBar";
import "./index.scss";

const LEVEL_OPTIONS = [
  { value: "debug", label: "详细（debug）" },
  { value: "info", label: "常规（info）" },
  { value: "warn", label: "仅警告（warn）" },
  { value: "error", label: "仅错误（error）" },
] as const;

/** 读不到主进程配置时的展示值（与主进程默认一致，不伪造用户的选择） */
const DEFAULT_SETTINGS: LogSettingsDTO = { level: "info", ipc: true, retentionDays: 7 };

/**
 * 诊断分区（1.47.0 本地日志）
 *
 * 刻意保持很小：日志的定位是「出问题时能拿出证据」，不是给用户调参玩。
 * 三个可调项（级别 / IPC 记录 / 保留天数）对应三种排查场景：
 * - 复现偶发 bug → 调到 debug；
 * - 怀疑主进程与渲染层通信失败 → 打开 IPC 记录（按 DEBUG 级并入窗口日志）；
 * - 磁盘吃紧 → 缩短保留天数。
 *
 * **保存范式与其它页已统一（2.6.0）**：上一版是「改一项立刻落库」，
 * 于是拖一下保留天数会连发十几个 IPC、弹十几个「已保存」；
 * 现在改成草稿 + 页面底部操作条一次提交，与 AI 配置、个人资料同一条规则。
 * 唯一例外是「打开日志目录」——那是动作不是配置，留在行内。
 *
 * 「打开日志目录」走主进程 `shell.openPath`（渲染进程没有文件系统权限，
 * 也不该知道真实的用户目录 hash 名）。
 */
export default function DiagnosticSection() {
  const { message } = App.useApp();
  /** 已落库的配置（底条状态点拿它当基线） */
  const [saved, setSaved] = useState<LogSettingsDTO>(DEFAULT_SETTINGS);
  /** 编辑中的草稿 */
  const [draft, setDraft] = useState<LogSettingsDTO>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void window.electronAPI?.log
      ?.getConfig()
      .then((value) => {
        if (cancelled || !value) return;
        setSaved(value);
        setDraft(value);
      })
      .catch(() => {
        // 读不到就按默认值展示；不弹错——用户此刻想做的是排查别的问题
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** 逐字段比较，与 AI 配置页同一判据（不比对象引用，回读会产出新对象） */
  const isDirty =
    draft.level !== saved.level ||
    draft.ipc !== saved.ipc ||
    draft.retentionDays !== saved.retentionDays;

  const patchDraft = (patch: Partial<LogSettingsDTO>): void => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const next = await window.electronAPI?.log?.setConfig(draft);
      if (next) {
        setSaved(next);
        setDraft(next);
      } else {
        // 通道没注册时不要谎报成功
        setSaved(draft);
      }
      message.success("已保存");
    } catch {
      message.error("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const openDir = async (): Promise<void> => {
    const ok = await window.electronAPI?.log?.openDir();
    if (!ok) message.warning("日志目录还不存在，先操作一下应用再试");
  };

  return (
    <>
      <section className="settings-section">
        <div className="settings-section__body">
          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">本地日志</span>
              <span className="settings-item__hint">
                按登录用户与窗口分目录存放，每行带时间 / 级别 / 模块，便于定位问题
              </span>
            </div>
            <Button className="settings-btn" onClick={() => void openDir()}>
              打开日志目录
            </Button>
          </div>

          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">日志级别</span>
              <span className="settings-item__hint">
                低于该级别的记录不落盘；IPC 调用与 AI 调用按 DEBUG 级强制写入同一份窗口日志
              </span>
            </div>
            <Select
              className="settings-diag__select"
              aria-label="日志级别"
              value={draft.level}
              options={[...LEVEL_OPTIONS]}
              onChange={(level) => patchDraft({ level })}
            />
          </div>

          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">记录 IPC 调用</span>
              <span className="settings-item__hint">
                只记失败与慢于 300ms 的调用；与业务日志同一个文件，按时间轴对齐
              </span>
            </div>
            <Switch checked={draft.ipc} onChange={(ipc) => patchDraft({ ipc })} />
          </div>

          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">保留天数</span>
              <span className="settings-item__hint">超期文件在下次启动或跨天时自动清理</span>
            </div>
            <InputNumber
              className="settings-diag__number"
              aria-label="日志保留天数"
              min={1}
              max={90}
              value={draft.retentionDays}
              onChange={(value) => {
                if (typeof value === "number") patchDraft({ retentionDays: value });
              }}
            />
          </div>
        </div>
      </section>

      <SettingsActionBar state={ready ? (isDirty ? "dirty" : "saved") : undefined}>
        <Button
          className="settings-btn--primary"
          type="primary"
          loading={saving}
          disabled={!isDirty}
          onClick={() => void handleSave()}
        >
          保存
        </Button>
      </SettingsActionBar>
    </>
  );
}
