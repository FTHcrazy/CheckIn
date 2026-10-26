import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Input,
  InputNumber,
  Radio,
  Select,
  Spin,
  Switch,
} from "antd";
import { useAiConfig } from "../../hooks/useAiConfig";
import type { AiProvider } from "@/shared/ai/ai-types";
import "./index.scss";

/**
 * 服务商模板（R-AI-01）：选中后**不覆盖**用户已填的地址 / 模型名，只在
 * 输入框的 placeholder 里弱提示该厂商的参考地址与默认模型——用户填了什么
 * 就保留什么，切换厂商不改用户意图。
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

/** 自定义模板（不在预设里）：地址/模型名交给用户自己填 */
const CUSTOM_PRESET = "custom";

/**
 * AI 助手分区（R-AI-01）。
 *
 * 分层配置：默认只露「总开关 + 模式」，高级项（上下文长度）折叠。小白走
 * 「选模板 → 填 Key → 测试 → 保存」，资深走「自定义 → 填任意 OpenAI 兼容
 * 地址/模型/Key」。本地 Ollama 免 Key、数据不出本机。
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 首次载入：把主进程配置映射进草稿
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
      ...PROVIDER_PRESETS.map((p) => ({ value: p.label, label: p.label })),
      { value: CUSTOM_PRESET, label: "自定义（任意 OpenAI 兼容接口）" },
    ],
    [],
  );

  /** 当前选中模板（用于 placeholder 弱提示参考地址/模型；custom 时为 null） */
  const activePreset = useMemo(
    () => PROVIDER_PRESETS.find((p) => p.label === draft.preset) ?? null,
    [draft.preset],
  );

  const isConfigured = Boolean(config && config.enabled);

  /** 已保存的 Key 是否已填（用于「Key 已填」提示，不返回明文） */
  const hasSavedKey = Boolean(config?.hasApiKey);

  const handleSelectPreset = (value: string) => {
    // 只记录选中态；不覆盖用户已填的地址 / 模型名（意图交给用户）
    setDraft((prev) => ({ ...prev, preset: value }));
  };

  const handleProviderChange = (provider: AiProvider) => {
    setDraft((prev) => ({ ...prev, provider }));
    // 切到 Ollama：清掉 Key 语义（Ollama 免 Key），地址给默认本地端点
    if (provider === "ollama") {
      setDraft((prev) => ({
        ...prev,
        provider,
        endpoint: prev.endpoint || "http://localhost:11434",
        apiKey: "",
      }));
    }
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
      message.success("AI 设置已保存");
      setDraft((prev) => ({ ...prev, apiKey: "" }));
    }
  };

  const handleTest = async () => {
    // 草稿与已保存配置不一致时，先保存再测，保证测的是「当前填的」而非旧配置
    const dirty =
      !config ||
      config.enabled !== draft.enabled ||
      config.provider !== draft.provider ||
      config.endpoint !== draft.endpoint ||
      config.model !== draft.model ||
      (draft.provider === "openai" && draft.apiKey.length > 0);
    if (dirty) {
      const ok = await save({
        enabled: true,
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
          <div className="settings-ai__lead" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: 24 }}>
            <Spin size="small" />
            <span>加载中…</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">AI 助手</h2>
      <div className="settings-section__body">
        {/* 总开关 */}
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">启用 AI 助手</span>
            <span className="settings-item__hint">
              开启后可在写作工具（起名、后续润色续写）中调用 AI
            </span>
          </div>
          <Switch
            checked={draft.enabled}
            onChange={(checked) => setDraft((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        {/* 模式选择 */}
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">模型服务</span>
            <span className="settings-item__hint">
              使用自己的模型：任意 OpenAI 兼容接口；本地 Ollama 免 Key、数据不出本机
            </span>
          </div>
          <Radio.Group
            value={draft.provider}
            onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
            size="small"
          >
            <Radio.Button value="openai">自己的模型</Radio.Button>
            <Radio.Button value="ollama">本地 Ollama</Radio.Button>
          </Radio.Group>
        </div>

        {/* OpenAI 兼容：服务商模板 + 地址 + 模型 + Key */}
        {draft.provider === "openai" ? (
          <>
            <div className="settings-ai__stack">
              <span className="settings-ai__stack-label">服务商</span>
              <Select
                className="settings-ai__select"
                value={draft.preset}
                options={presetOptions}
                onChange={handleSelectPreset}
              />
            </div>

            <div className="settings-ai__stack">
              <span className="settings-ai__stack-label">接口地址</span>
              <span className="settings-ai__stack-hint">
                填所选厂商的 OpenAI 兼容 base 地址；切换服务商会在占位提示里给出参考，不覆盖你已填内容
              </span>
              <Input
                className="settings-ai__input"
                value={draft.endpoint}
                placeholder={activePreset ? activePreset.endpoint : "https://api.example.com/v1"}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    endpoint: value,
                    preset: matchPreset(value, prev.model),
                  }));
                }}
              />
            </div>

            <div className="settings-ai__stack">
              <span className="settings-ai__stack-label">模型名</span>
              <span className="settings-ai__stack-hint">
                填你账号下可用的模型名；切换服务商同样只作占位提示
              </span>
              <Input
                className="settings-ai__input"
                value={draft.model}
                placeholder={activePreset ? activePreset.model : "deepseek-chat / qwen-plus / glm-4 / gpt-4o-mini"}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    model: value,
                    preset: matchPreset(prev.endpoint, value),
                  }));
                }}
              />
            </div>

            <div className="settings-ai__stack">
              <span className="settings-ai__stack-label">API Key</span>
              <span className="settings-ai__stack-hint">
                {hasSavedKey
                  ? "已保存一个 Key（以掩码示意，不显示明文）；输入新 Key 可覆盖，清空输入框保存则保持不变"
                  : "仅本机加密保存，直连所选模型服务，请妥善保管"}
              </span>
              <Input.Password
                className="settings-ai__input"
                value={draft.apiKey}
                placeholder={hasSavedKey ? "••••••••（已保存；输入新值可覆盖）" : "粘贴你的 API Key"}
                onChange={(e) => setDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <>
            <div className="settings-ai__stack">
              <span className="settings-ai__stack-label">Ollama 地址</span>
              <span className="settings-ai__stack-hint">
                本地默认 http://localhost:11434，也可填局域网内其它机器
              </span>
              <Input
                className="settings-ai__input"
                value={draft.endpoint}
                placeholder="http://localhost:11434"
                onChange={(e) => setDraft((prev) => ({ ...prev, endpoint: e.target.value }))}
              />
            </div>

            <div className="settings-ai__stack">
              <span className="settings-ai__stack-label">模型名</span>
              <span className="settings-ai__stack-hint">
                填 Ollama 里已下载的模型名（如 qwen2.5、llama3.1、deepseek-r1）
              </span>
              <Input
                className="settings-ai__input"
                value={draft.model}
                placeholder="qwen2.5"
                onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
              />
            </div>

            <div className="settings-ai__stack">
              <span className="settings-ai__stack-hint">
                本地模型无需 API Key，数据不出本机
              </span>
            </div>
          </>
        )}

        {/* 高级参数（折叠） */}
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">高级参数</span>
            <span className="settings-item__hint">上下文长度、采样参数等</span>
          </div>
          <Button
            className="settings-ai__btn"
            type="text"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "收起" : "展开"}
          </Button>
        </div>

        {showAdvanced ? (
          <div className="settings-ai__stack">
            <span className="settings-ai__stack-label">上下文长度</span>
            <span className="settings-ai__stack-hint">
              模型可处理的最大上下文（token），用于超长输入自动截断
            </span>
            <InputNumber
              className="settings-ai__input"
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
        ) : null}

        {/* 测试结果状态条 */}
        {testResult ? (
          <div
            className={`settings-ai__result settings-ai__result--${testResult.ok ? "ok" : "fail"}`}
          >
            {testResult.ok ? "✓ " : "✕ "}
            {testResult.message}
          </div>
        ) : null}

        {/* 操作区 */}
        <div className="settings-item">
          <div className="settings-item__text">
            <span className="settings-item__label">验证与保存</span>
            <span className="settings-item__hint">
              建议先「测试连接」确认 Key / 地址 / 模型可用，再保存
            </span>
          </div>
          <div className="settings-ai__actions">
            <Button className="settings-ai__btn" onClick={() => void handleTest()} loading={testing}>
              测试连接
            </Button>
            <Button
              type="primary"
              onClick={() => void handleSave()}
              loading={saving}
              disabled={!draft.endpoint.trim() || !draft.model.trim()}
            >
              保存
            </Button>
          </div>
        </div>

        {!isConfigured ? (
          <div className="settings-ai__result settings-ai__result--fail">
            尚未启用：打开顶部开关并保存后，写作工具里才会出现 AI 入口
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** 反查某「地址 + 模型」是否命中预设模板（命中返回 label，否则 custom） */
function matchPreset(endpoint: string, model: string): string {
  const hit = PROVIDER_PRESETS.find(
    (p) => p.endpoint === endpoint.trim() && p.model === model.trim(),
  );
  return hit ? hit.label : CUSTOM_PRESET;
}
