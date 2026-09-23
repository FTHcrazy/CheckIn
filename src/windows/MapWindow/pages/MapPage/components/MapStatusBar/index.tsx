/**
 * 底部状态条（RM 状态信息）：格坐标 / 缩放 / 标注数 / 贴章数 / 比例尺提示 / 保存状态
 */
import "./index.scss";

export interface MapStatusBarProps {
  cell: { c: number; r: number } | null;
  zoomPct: number;
  annoCount: number;
  stampCount: number;
  scaleHint: string;
  saveState: "idle" | "saving" | "error";
  updatedAt?: number;
}

export default function MapStatusBar(props: MapStatusBarProps) {
  const save =
    props.saveState === "saving"
      ? "保存中…"
      : props.saveState === "error"
        ? "保存失败"
        : props.updatedAt
          ? `已保存 · ${new Date(props.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
          : "已保存";
  return (
    <div className="mw-status">
      <span>格坐标 <b>{props.cell ? `${props.cell.c}, ${props.cell.r}` : "—"}</b></span>
      <span>缩放 <b>{props.zoomPct}%</b></span>
      <span>标注 <b>{props.annoCount}</b></span>
      <span>贴章 <b>{props.stampCount}</b></span>
      <div className="mw-status__spacer" />
      <span>{props.scaleHint}</span>
      <span className="mw-status__save">{save}</span>
    </div>
  );
}
