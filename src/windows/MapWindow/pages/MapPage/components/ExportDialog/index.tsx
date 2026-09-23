/**
 * 导出 PNG 对话框（RM6）：范围 / 倍率 / 输出尺寸 / 包含项开关 + 实时预览
 * 落盘走主进程 saveDialog（map-service.exportPng）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuiltWorld } from "../../map-terrain";
import { buildExportCanvas } from "../../map-export";
import type { MapContent } from "@/shared/types/electron.d.ts";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  world: BuiltWorld | null;
  content: MapContent;
  viewBox: { x: number; y: number; w: number; h: number };
  mapName: string;
  onExport: (dataUrl: string) => void;
}

export default function ExportDialog(props: ExportDialogProps) {
  const [range, setRange] = useState<"view" | "full">("view");
  const [scale, setScale] = useState(2);
  const [withTerrain, setWithTerrain] = useState(true);
  const [withAnnotations, setWithAnnotations] = useState(true);
  const [withLegend, setWithLegend] = useState(true);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  const opts = useMemo(
    () => ({ range, scale, withTerrain, withAnnotations, withLegend, style: (props.content.symbolStyle ?? "A") as "A" | "B" | "C", viewBox: props.viewBox }),
    [range, scale, withTerrain, withAnnotations, withLegend, props.content.symbolStyle, props.viewBox],
  );

  useEffect(() => {
    if (!props.open || !props.world) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const out = buildExportCanvas(props.world, props.content, opts);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 460;
    const ch = canvas.clientHeight || 240;
    // 缩放到预览框
    const ratio = Math.min(cw / out.width, ch / out.height);
    canvas.width = out.width * ratio * dpr;
    canvas.height = out.height * ratio * dpr;
    ctx.setTransform(ratio * dpr, 0, 0, ratio * dpr, 0, 0);
    ctx.drawImage(out, 0, 0);
  }, [props.open, props.world, props.content, opts]);

  if (!props.open || !props.world) return null;

  const outW = Math.round((range === "full" ? props.world.width : props.viewBox.w) * scale);
  const outH = Math.round((range === "full" ? props.world.height : props.viewBox.h) * scale) + (withLegend ? 96 * scale : 0);

  const doExport = async () => {
    if (!props.world) return;
    setBusy(true);
    const out = buildExportCanvas(props.world, props.content, opts);
    const dataUrl = out.toDataURL("image/png");
    props.onExport(dataUrl);
    setBusy(false);
    props.onClose();
  };

  return (
    <div className="mask modal-exp is-scene-modal">
      <div className="modal modal--slim">
        <div className="modal__head">
          <div>
            <h3>导出地图 PNG</h3>
            <p>走系统保存对话框，导出后可当插图直接放进作品</p>
          </div>
          <button type="button" className="icon-btn modal__close" onClick={props.onClose}><MapIcon name="close" size={16} /></button>
        </div>
        <div className="modal__body" style={{ display: "block", padding: "14px 16px", overflowY: "auto" }}>
          <div className="exp-grid">
            <label>导出范围</label>
            <div className="exp-radio">
              <button type="button" className={`btn btn--sm${range === "view" ? " is-on" : ""}`} onClick={() => setRange("view")}>当前视图</button>
              <button type="button" className={`btn btn--sm${range === "full" ? " is-on" : ""}`} onClick={() => setRange("full")}>整张地图</button>
            </div>
            <label>倍率</label>
            <div className="exp-radio">
              {[1, 2, 4].map((s) => (
                <button key={s} type="button" className={`btn btn--sm${scale === s ? " is-on" : ""}`} onClick={() => setScale(s)}>{s}×</button>
              ))}
            </div>
            <label>输出尺寸</label>
            <div><span className="dock__hint">{outW} × {outH} px</span></div>
          </div>
          <div style={{ borderTop: "1px solid var(--app-border)", marginTop: 12, paddingTop: 8 }}>
            <div className="check-row"><input type="checkbox" checked={withLegend} onChange={(e) => setWithLegend(e.target.checked)} /><label>包含标注列表（图例）</label></div>
            <div className="check-row"><input type="checkbox" checked={withAnnotations} onChange={(e) => setWithAnnotations(e.target.checked)} /><label>包含地点标注</label></div>
            <div className="check-row"><input type="checkbox" checked={withTerrain} onChange={(e) => setWithTerrain(e.target.checked)} /><label>包含地形底图</label></div>
          </div>
          <div className="exp-preview" style={{ marginTop: 10 }}>
            <canvas ref={previewRef} className="exp-preview__canvas" />
          </div>
        </div>
        <div className="modal__foot">
          <span className="dock__hint">预计 {(outW * outH * 4 / 1024 / 1024).toFixed(1)} MB</span>
          <div className="top-spacer" />
          <button type="button" className="btn" onClick={props.onClose}>取消</button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={doExport}><MapIcon name="download" size={14} /> 导出</button>
        </div>
      </div>
    </div>
  );
}
