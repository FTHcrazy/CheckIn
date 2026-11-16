import type { RefObject } from "react";
import { InboxOutlined } from "@ant-design/icons";
import "./index.scss";

interface ChromaStageProps {
  previewRef: RefObject<HTMLCanvasElement | null>;
  hasImage: boolean;
  onPick: (clientX: number, clientY: number, rect: DOMRect) => void;
  onDropFile: (file: File) => void;
}

/**
 * 预览舞台：棋盘格 + 结果图，点击即吸管取色。
 *
 * 画布始终挂载（空图时用 CSS 隐藏）——一旦改成条件渲染，`previewRef` 在图片
 * 加载完成的那一刻还是 null，首次结果就画不出来。
 */
export default function ChromaStage({
  previewRef,
  hasImage,
  onPick,
  onDropFile,
}: ChromaStageProps) {
  return (
    <div
      className="ck-stage"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onDropFile(file);
      }}
    >
      <canvas
        ref={previewRef}
        className={`ck-stage__canvas${hasImage ? "" : " is-empty"}`}
        onClick={(event) => {
          if (!hasImage) return;
          onPick(
            event.clientX,
            event.clientY,
            event.currentTarget.getBoundingClientRect(),
          );
        }}
      />

      {hasImage ? null : (
        <div className="ck-stage__placeholder">
          <p className="ck-stage__icon">
            <InboxOutlined />
          </p>
          <p className="ck-stage__title">把图片拖进来，或点右侧「选择图片」</p>
          <p className="ck-stage__hint">
            纯色背景的图片效果最好；也支持截图后直接 Ctrl+V 粘贴
          </p>
        </div>
      )}
    </div>
  );
}
