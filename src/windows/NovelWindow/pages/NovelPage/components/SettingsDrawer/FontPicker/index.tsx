import { useEffect } from "react";
import { Button } from "antd";
import {
  FONT_PREVIEW_TEXT,
  PAPER_FONT_CANDIDATES,
  type PaperFontCandidate,
} from "../../../paper-fonts";
import type { usePaperFonts } from "../../../hooks/usePaperFonts";
import "./index.scss";

type PaperFonts = ReturnType<typeof usePaperFonts>;

/** 无字体能力时的兜底空状态（测试 / 极端场景） */
const NOOP_FONTS: PaperFonts = {
  installed: [],
  activeFamily: "",
  downloadingId: null,
  error: null,
  preview: () => {},
  download: async () => false,
  remove: async () => {},
  select: async () => {},
};

interface FontPickerProps {
  fonts?: PaperFonts;
}

/**
 * 正文字体选择器（排版抽屉内的字体区）。
 *
 * 每个候选一张卡：预览文字（未下载时用 webfont 动态预览）+ 风格标签 +
 * 下载/应用按钮。点「下载」拉取字体文件落盘，下载成功后即可选中为正文。
 * 「跟随系统」无需下载，始终可选中。
 */
export default function FontPicker({ fonts = NOOP_FONTS }: FontPickerProps) {
  const { activeFamily, downloadingId, error, preview, download, select } = fonts;

  const isDownloaded = (candidate: PaperFontCandidate): boolean =>
    candidate.family === "" ||
    fonts.installed.some((entry) => entry.family === candidate.family);

  // 首次渲染即触发所有候选的 webfont 预览加载（jsDelivr，惰性不阻塞）
  useEffect(() => {
    for (const candidate of PAPER_FONT_CANDIDATES) {
      if (candidate.previewCss) preview(candidate);
    }
  }, [preview]);

  return (
    <div className="nv-font">
      {PAPER_FONT_CANDIDATES.map((candidate) => {
        const downloaded = isDownloaded(candidate);
        const active = activeFamily === candidate.family;
        return (
          <div
            key={candidate.id}
            className={`nv-font__card${active ? " is-active" : ""}`}
          >
            <div className="nv-font__meta">
              <span className="nv-font__label">{candidate.label}</span>
              <span className="nv-font__style">{candidate.style}</span>
            </div>
            <p
              className="nv-font__preview"
              style={
                candidate.family
                  ? { fontFamily: `"${candidate.family}", serif` }
                  : undefined
              }
            >
              {FONT_PREVIEW_TEXT}
            </p>
            <p className="nv-font__hint">{candidate.hint}</p>
            <div className="nv-font__actions">
              {candidate.family === "" ? (
                <Button
                  className="nv-font__apply"
                  disabled={active}
                  onClick={() => void select("")}
                >
                  {active ? "已应用" : "应用"}
                </Button>
              ) : downloaded ? (
                <Button
                  className="nv-font__apply"
                  disabled={active}
                  onClick={() => void select(candidate.family)}
                >
                  {active ? "已应用" : "应用"}
                </Button>
              ) : (
                <Button
                  className="nv-font__download"
                  loading={downloadingId === candidate.id}
                  onClick={() => void download(candidate)}
                >
                  下载
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {error && <p className="nv-font__error">{error}</p>}
    </div>
  );
}
