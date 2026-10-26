import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Input,
  InputNumber,
  Select,
  Spin,
  Switch,
} from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloudServerOutlined,
  LaptopOutlined,
} from "@ant-design/icons";
import { useAiConfig } from "../../hooks/useAiConfig";
import type { AiProvider } from "@/shared/ai/ai-types";
import SettingsActionBar from "../SettingsActionBar";
import "./index.scss";

/**
 * 服务商模板（R-AI-01）。
 *
 * 与上一版（「选中只改 placeholder，从不覆盖用户已填内容」）的差别：**选中即填**。
 * 用户点「DeepSeek」这个动作本身就是「我要用 DeepSeek」，只把参考地址塞进占位符
 * 等于让他照着提示再手抄一遍；而 Cursor / Continue / VS Code 这类成熟配置页都是
 * 选中即写入。写入后用户仍可随意改，改了之后 `matchPreset` 会把下拉反查成
 * 「自定义」，不会出现「选了 DeepSeek 但地址是别家」的假状态。
 *
 * 端点与默认模型以 2026-10 官方文档为准；用户可随时改，故无需热更新。
 */
interface ProviderPreset {
  label: string;
  endpoint: string;
  model: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: "DeepSeek", endpoint: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "通义千问", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { label: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4" },
  { label: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
];

/** 自定义模板（不在预设里）：地址 / 模型名交给用户自己填 */
const CUSTOM_PRESET = "custom";

/**
 * AI 配置页（R-AI-01）。
 *
 * 布局参考成熟 AI 配置面板（Cursor 的 Models / Copilot 的设置页）的三段式：
 * **是否启用 → 用哪个服务 → 连接凭据 → 高级参数**，操作按钮收进底部常驻条，
 * 不再随内容滚走（固定 900×680 窗口里，按钮沉在长表单底部等于藏起来）。
 *
 * 交互取舍：
 * - 「保存」只在**真的改了东西**时可点，左侧状态点同时告诉用户「有未保存的更改 /
 *   已保存」—— 这是 Codex / Cursor 那类配置页的常规反馈，避免盲点保存；
 * - 「测试连接」在主进程侧读的是**已落库**的配置，所以草稿有改动时先存再测，
 *   按钮 title 直接说明这一点，不做悄悄保存。
 *
 * ⚠️ Key 只在用户输入的那一刻短暂驻留内存，提交后即弃；`getConfig` 只返回
 * `hasApiKey` 布尔，Key 永不回流渲染层（安全边界见 ai-handlers.ts）。
 */
export default function AISection() {
  const { message } = App.useApp();
  const { config, loading, saving, testing, testResult, save, test } = useAiConfig();

  // ── 草稿态：编辑中的字段，点「保存」才落库 ──
  const [draft, setDraft] = useState<{
    enabled: boolean;
    provider: AiProvider;
    preset: string;
    endpoint: string;
    model: string;
    apiKey: string;
    contextLen: number;
  }>({
    enabled: false,
    provider: "openai",
    preset: CUSTOM_PRESET,
    endpoint: "",
    model: "",
    apiKey: "",
    contextLen: 32000,
  });

  // 首次载入 / 保存后回读：把主进程配置映射进草稿
  useEffect(() => {
    if (!config) return;
    setDraft((prev) => ({
      ...prev,
      enabled: config.enabled,
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      contextLen: config.contextLen,
      apiKey: "", // 明文 Key 永不回流，这里恒空，保存时留空 = 不改 Key
      preset: matchPreset(config.endpoint, config.model),
    }));
  }, [config]);

  const presetOptions = useMemo(
    () => [
      ...PROVIDER_PRESETS.map((preset) => ({ value: preset.label, label: preset.label })),
      { value: CUSTOM_PRESET, label: "自定义（任意 OpenAI 兼容接口）" },
    ],
    [],
  );

  /** 当前选中模板（用于 Ollama 之外的服务商名称展示；custom 时为 null） */
  const activePreset = useMemo(
    () => PROVIDER_PRESETS.find((preset) => preset.label === draft.preset) ?? null,
    [draft.preset],
  );

  /** 已保存的 Key 是否已填（用于「已保存」提示，不返回明文） */
  const hasSavedKey = Boolean(config?.hasApiKey);

  /**
   * 草稿与已保存配置是否有差异。
   * 逐字段比较（不比对象引用）：`useEffect` 每次回读都会产出新对象，
   * 比引用会让「刚保存完」也一直显示有未保存的更改。
   */
  const isDirty = useMemo(() => {
    if (!config) return false;
    return (
      config.enabled !== draft.enabled ||
      config.provider !== draft.provider ||
      config.endpoint !== draft.endpoint ||
      config.model !== draft.model ||
      config.contextLen !== draft.contextLen ||
      (draft.provider === "openai" && draft.apiKey.length > 0)
    );
  }, [config, draft]);

  const canSave =
    isDirty && draft.endpoint.trim().length > 0 && draft.model.trim().length > 0;

  const handleProviderChange = (provider: AiProvider) => {
    if (provider === draft.provider) return;
    setDraft((prev) => ({
      ...prev,
      provider,
      // 切到 Ollama：清掉 Key 语义（Ollama 免 Key），地址给默认本地端点
      ...(provider === "ollama"
        ? { endpoint: prev.endpoint || "http://localhost:11434", apiKey: "" }
        : {}),
    }));
  };

  /** 选服务商 = 直说要它：把推荐地址与模型填进草稿（可再改） */
  const handleSelectPreset = (value: string) => {
    if (value === CUSTOM_PRESET) {
      setDraft((prev) => ({ ...prev, preset: value }));
      return;
    }
    const preset = PROVIDER_PRESETS.find((item) => item.label === value);
    if (!preset) return;
    setDraft((prev) => ({
      ...prev,
      preset: preset.label,
      endpoint: preset.endpoint,
      model: preset.model,
    }));
  };

  const handleSave = async () => {
    const ok = await save({
      enabled: draft.enabled,
      provider: draft.provider,
      endpoint: draft.endpoint,
      model: draft.model,
      contextLen: draft.contextLen,
      // 草稿 apiKey 非空才提交（空 = 不改 Key；Ollama 恒空）
      apiKey: draft.provider === "openai" ? draft.apiKey : "",
    });
    if (ok) {
      // 文案与其它页统一为「已保存」；左侧状态点同时转绿，两处反馈说的是同一件事
      message.success("已保存");
      setDraft((prev) => ({ ...prev, apiKey: "" }));
    }
  };

  const handleTest = async () => {
    // 主进程测试读的是已落库配置：草稿有改动就先保存，测的才是「当前填的」
    if (isDirty) {
      const ok = await save({
        enabled: draft.enabled,
        provider: draft.provider,
        endpoint: draft.endpoint,
        model: draft.model,
        contextLen: draft.contextLen,
        apiKey: draft.provider === "openai" ? draft.apiKey : "",
      });
      if (!ok) return;
    }
    await test();
  };

  if (loading) {
    return (
      <section className="settings-section">
        <h2 className="settings-section__title">AI 助手</h2>
        <div className="settings-section__body">
          <div className="settings-ai__loading">
            <Spin size="small" />
            <span>正在读取配置…</span>
          </div>
        </div>
      </section>
    );
  }

  const providerLabel =
    draft.provider === "ollama" ? "本地 Ollama" : (activePreset?.label ?? "自定义接口");

  /**
   * 底条左侧状态：配置读不到（主进程通道异常）时不给状态，免得把「读失败」
   * 谎报成「已保存」。卡片与操作条直接摊在页面内容栈上（fragment 不带包裹层），
   * 这样操作条的 `margin-top: auto` 才能作用到栈，切页时位置恒定。
   */
  const saveState = config ? (isDirty ? "dirty" : "saved") : undefined;

  return (
    <>
      {/* ① 总开关：唯一的「要不要用」 */}
      <section className="settings-section">
        <h2 className="settings-section__title">AI 助手</h2>
        <div className="settings-section__body">
          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">启用 AI 助手</span>
              <span className="settings-item__hint">
                {draft.enabled
                  ? `开启中：写作工具将调用 ${providerLabel}${draft.model ? ` · ${draft.model}` : ""}`
                  : "开启后，写作工具中的起名等能力才会调用模型"}
              </span>
            </div>
            <Switch
              checked={draft.enabled}
              onChange={(checked) => setDraft((prev) => ({ ...prev, enabled: checked }))}
            />
          </div>
        </div>
      </section>

      {/* ② 用哪个服务：两张大按钮当单选，比一行 Radio 更容易扫读 */}
      <section className="settings-section">
        <h2 className="settings-section__title">模型服务</h2>
        <div className="settings-section__body">
          <div className="settings-field">
            <span className="settings-field__label">连接方式</span>
            {/* 两张大按钮而不是 Antd Segmented：每张要带一行「是否免 Key / 数据去哪」
                的说明，Segmented 的选项只放得下标签。语义上它们是互斥的两态，
                所以用 aria-pressed 标选中态（键盘走原生 Tab，不假造 radiogroup）。 */}
            <div className="settings-ai__tiles">
              <Button
                className={`settings-ai__tile${draft.provider === "openai" ? " is-active" : ""}`}
                aria-pressed={draft.provider === "openai"}
                onClick={() => handleProviderChange("openai")}
              >
                <span className="settings-ai__tile-icon" aria-hidden="true">
                  <CloudServerOutlined />
                </span>
                <span className="settings-ai__tile-text">
                  <span className="settings-ai__tile-title">自定义接口</span>
                  <span className="settings-ai__tile-desc">任意 OpenAI 兼容服务，需自备 API Key</span>
                </span>
              </Button>

              <Button
                className={`settings-ai__tile${draft.provider === "ollama" ? " is-active" : ""}`}
                aria-pressed={draft.provider === "ollama"}
                onClick={() => handleProviderChange("ollama")}
              >
                <span className="settings-ai__tile-icon" aria-hidden="true">
                  <LaptopOutlined />
                </span>
                <span className="settings-ai__tile-text">
                  <span className="settings-ai__tile-title">本地 Ollama</span>
                  <span className="settings-ai__tile-desc">免 Key，数据不出本机</span>
                </span>
              </Button>
            </div>
          </div>

          {/* ③ 连接凭据：竖排字段（长地址要占满整行，左右分栏会看不全） */}
          {draft.provider === "openai" ? (
            <>
              <div className="settings-field">
                <span className="settings-field__label">服务商</span>
                <div className="settings-field__control">
                  <Select
                    className="settings-ai__preset"
                    aria-label="服务商"
                    value={draft.preset}
                    options={presetOptions}
                    onChange={handleSelectPreset}
                  />
                </div>
                <span className="settings-field__hint">
                  选一家会填入它的推荐地址与模型，之后仍可自行修改；改过就回到「自定义」
                </span>
              </div>

              <div className="settings-field">
                <span className="settings-field__label">接口地址</span>
                <div className="settings-field__control">
                  <Input
                    aria-label="接口地址"
                    value={draft.endpoint}
                    placeholder={activePreset ? activePreset.endpoint : "https://api.example.com/v1"}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((prev) => ({
                        ...prev,
                        endpoint: value,
                        preset: matchPreset(value, prev.model),
                      }));
                    }}
                  />
                </div>
                <span className="settings-field__hint">
                  OpenAI 兼容的 base 地址，一般以 <code>/v1</code> 结尾
                </span>
              </div>

              <div className="settings-field">
                <span className="settings-field__label">模型名</span>
                <div className="settings-field__control">
                  <Input
                    aria-label="模型名"
                    value={draft.model}
                    placeholder={
                      activePreset ? activePreset.model : "deepseek-chat / qwen-plus / glm-4 / gpt-4o-mini"
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((prev) => ({
                        ...prev,
                        model: value,
                        preset: matchPreset(prev.endpoint, value),
                      }));
                    }}
                  />
                </div>
                <span className="settings-field__hint">填你账号下可用的模型名，写错会在测试时报「模型不存在」</span>
              </div>

              <div className="settings-field">
                <span className="settings-field__label">
                  API Key
                  {hasSavedKey ? <span className="settings-ai__chip">已保存</span> : null}
                </span>
                <div className="settings-field__control">
                  <Input.Password
                    aria-label="API Key"
                    value={draft.apiKey}
                    placeholder={hasSavedKey ? "••••••••（已保存；输入新值可覆盖）" : "粘贴你的 API Key"}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, apiKey: event.target.value }))
                    }
                    autoComplete="off"
                  />
                </div>
                <span className="settings-field__hint">
                  {hasSavedKey
                    ? "已加密保存在本机。留空保存则保持原 Key 不变，输入新值可覆盖"
                    : "仅本机加密保存，请求直连所选服务商"}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="settings-field">
                <span className="settings-field__label">服务地址</span>
                <div className="settings-field__control">
                  <Input
                    aria-label="Ollama 服务地址"
                    value={draft.endpoint}
                    placeholder="http://localhost:11434"
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, endpoint: event.target.value }))
                    }
                  />
                </div>
                <span className="settings-field__hint">
                  本地默认 http://localhost:11434，也可填局域网内其它机器
                </span>
              </div>

              <div className="settings-field">
                <span className="settings-field__label">模型名</span>
                <div className="settings-field__control">
                  <Input
                    aria-label="Ollama 模型名"
                    value={draft.model}
                    placeholder="qwen2.5"
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, model: event.target.value }))
                    }
                  />
                </div>
                <span className="settings-field__hint">
                  填 Ollama 里已下载的模型名（如 qwen2.5、llama3.1、deepseek-r1）
                </span>
              </div>

              <div className="settings-field">
                <span className="settings-field__label">API Key</span>
                <span className="settings-field__hint">
                  本地模型无需 Key，数据不出本机
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ④ 高级参数：只有一项，不再折叠 —— 独立页里没有「收起」的必要 */}
      <section className="settings-section">
        <h2 className="settings-section__title">高级</h2>
        <div className="settings-section__body">
          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">上下文长度</span>
              <span className="settings-item__hint">
                模型可处理的最大 token 数，超长输入按此截断；不确定就留默认值
              </span>
            </div>
            <InputNumber
              className="settings-ai__number"
              aria-label="上下文长度"
              value={draft.contextLen}
              min={1000}
              max={2_000_000}
              step={1000}
              formatter={(value) => (value == null ? "" : `${value}`)}
              parser={(value) => Number((value ?? "").replace(/[^\d]/g, "")) || 0}
              onChange={(value) =>
                setDraft((prev) => ({ ...prev, contextLen: typeof value === "number" ? value : 0 }))
              }
            />
          </div>
        </div>
      </section>

      {/* 测试结果：内联状态条（成功 / 失败都留在原地，不弹窗打断填写） */}
      {testResult ? (
        <div
          className={`settings-ai__result is-${testResult.ok ? "ok" : "fail"}`}
          role="status"
        >
          {testResult.ok ? <CheckCircleFilled /> : <CloseCircleFilled />}
          <span>{testResult.message}</span>
        </div>
      ) : null}

      {/* 底部常驻操作条：内容再长也够得着，左侧常显「存了没」 */}
      <SettingsActionBar state={saveState}>
        <Button
          className="settings-btn"
          onClick={() => void handleTest()}
          loading={testing}
          title="测试会先保存当前填写内容，再按已保存的配置发起一次真实请求"
        >
          测试连接
        </Button>
        <Button
          className="settings-btn--primary"
          type="primary"
          onClick={() => void handleSave()}
          loading={saving}
          disabled={!canSave}
        >
          保存
        </Button>
      </SettingsActionBar>
    </>
  );
}

/** 反查某「地址 + 模型」是否命中预设模板（命中返回 label，否则 custom） */
function matchPreset(endpoint: string, model: string): string {
  const hit = PROVIDER_PRESETS.find(
    (preset) => preset.endpoint === endpoint.trim() && preset.model === model.trim(),
  );
  return hit ? hit.label : CUSTOM_PRESET;
}
