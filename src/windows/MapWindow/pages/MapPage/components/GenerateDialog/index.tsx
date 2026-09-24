/**
 * 随机生成对话框（RM8）：地形约束模板多选 + 一键出图 + 换一批 + 采用落图
 * 预览用同一套 map-render，所见即所得；同 seed + 同约束必出同图。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildWorld, randomSeed, type BuiltWorld, type TerrainTemplates } from "../../map-terrain";
import { drawTerrain } from "../../map-render";
import { MAP_PAPER } from "../../map-symbols";
import { TEMPLATE_OPTIONS, RES_PRESETS, DEFAULT_RES } from "../../map-config";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface GenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onAdopt: (world: BuiltWorld, templates: TerrainTemplates, resKey: string) => void;
  initialSeed?: string;
  initialTemplates?: TerrainTemplates;
  initialRes?: string;
}

export default function GenerateDialog(props: GenerateDialogProps) {
  const [seed, setSeed] = useState(props.initialSeed ?? randomSeed());
  const [templates, setTemplates] = useState<TerrainTemplates>(props.initialTemplates ?? { threeSea: true, northSnow: true });
  const [resKey, setResKey] = useState(props.initialRes ?? DEFAULT_RES);
  const [counter, setCounter] = useState(0);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (props.open) {
      setSeed(props.initialSeed ?? randomSeed());
      setTemplates(props.initialTemplates ?? { threeSea: true, northSnow: true });
    }
  }, [props.open]);

  const world = useMemo(() => {
    const preset = RES_PRESETS.find((p) => p.key === resKey) ?? RES_PRESETS[1];
    return buildWorld({ cols: preset.cols, rows: preset.rows, seed, templates });
  }, [seed, templates, resKey]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 360;
    const ch = canvas.clientHeight || 220;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAP_PAPER;
    ctx.fillRect(0, 0, cw, ch);
    const k = Math.min(cw / world.width, ch / world.height);
    ctx.translate((cw - world.width * k) / 2, (ch - world.height * k) / 2);
    ctx.scale(k, k);
    drawTerrain(ctx, world, { style: "A" });
  }, [world]);

  const toggleTpl = (key: keyof TerrainTemplates) => {
    setTemplates((t) => ({ ...t, [key]: !t[key] }));
  };
  const reroll = () => {
    setSeed(randomSeed());
    setCounter((c) => c + 1);
  };

  if (!props.open) return null;

  return (
    <div className="mask modal-gen is-scene-modal">
      <div className="modal">
        <div className="modal__head">
          <div>
            <h3>随机生成地形</h3>
            <p>勾选地形约束后一键出图 · 同 seed + 同约束必出同图</p>
          </div>
          <button type="button" className="icon-btn modal__close" onClick={props.onClose}><MapIcon name="close" size={16} /></button>
        </div>
        <div className="modal__body">
          <div className="gen-left">
            <div className="side-section-title" style={{ padding: "0 0 6px" }}>地形约束模板 <i>· 可多选</i></div>
            {(["base", "hot"] as const).map((g) => (
              <div key={g} className="tpl-group">
                <div className="tpl-group__label">
                  {g === "base" ? "基础格局" : "热门小说格局"}
                </div>
                {TEMPLATE_OPTIONS.filter((t) => t.group === g).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`tpl${templates[t.key as keyof TerrainTemplates] ? " is-on" : ""}`}
                    onClick={() => toggleTpl(t.key as keyof TerrainTemplates)}
                  >
                    <span className="tpl__box"><MapIcon name="check" size={11} /></span>
                    <span className="tpl__text"><b>{t.name}</b><span>{t.desc}</span></span>
                  </button>
                ))}
              </div>
            ))}
            <div className="field-note" style={{ marginTop: 8, fontSize: 12, color: "var(--app-text-muted)" }}>
              约束只管大格局，细节交给噪声 + 手改；不满意就「换一批」。
            </div>
            <div className="side-section-title" style={{ padding: "12px 0 6px" }}>栅格分辨率</div>
            <div className="exp-radio">
              {RES_PRESETS.map((p) => (
                <button key={p.key} type="button" className={`btn btn--sm${resKey === p.key ? " is-on" : ""}`} onClick={() => setResKey(p.key)}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="gen-right">
            <div className="gen-preview">
              <canvas ref={previewRef} className="gen-preview__canvas" />
              <span className="gen-preview__tag">seed · {seed}</span>
            </div>
            <div className="seed-row">
              <span className="dock__hint">seed</span>
              <input className="input" value={seed} readOnly />
              <button type="button" className="btn btn--sm" onClick={() => setSeed(randomSeed())}><MapIcon name="lock" size={14} /> 换种子</button>
            </div>
            <div className="check-row" style={{ fontSize: 12, color: "var(--app-text-muted)" }}>
              采用后仍可用地形画笔逐格手改；seed 随图存档，随时重生成同一张。
            </div>
          </div>
        </div>
        <div className="modal__foot">
          <span className="dock__hint">本批已生成 {5 + counter} 张候选</span>
          <div className="top-spacer" />
          <button type="button" className="btn" onClick={props.onClose}>取消</button>
          <button type="button" className="btn" onClick={reroll}><MapIcon name="refresh" size={14} /> 换一批</button>
          <button type="button" className="btn btn--primary" onClick={() => props.onAdopt(world, templates, resKey)}><MapIcon name="check" size={14} /> 采用并落图</button>
        </div>
      </div>
    </div>
  );
}
