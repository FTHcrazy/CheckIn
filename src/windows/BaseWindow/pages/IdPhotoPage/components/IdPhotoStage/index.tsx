import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Segmented } from "antd";
import { DragOutlined, InboxOutlined } from "@ant-design/icons";
import type { PhotoView } from "../../hooks/useIdPhoto";
import "./index.scss";

interface IdPhotoStageProps {
  previewRef: RefObject<HTMLCanvasElement | null>;
  hasImage: boolean;
  view: PhotoView;
  /** 左上角的尺寸 / DPI 说明 */
  info: string;
  onView: (view: PhotoView) => void;
  onDropFile: (file: File) => void;
  /** 画布上的拖动位移（屏幕像素），由页面换算成构图锚点 */
  onPan: (dx: number, dy: number) => void;
}

const VIEW_OPTIONS = [
  { label: "原图", value: "original" },
  { label: "成品", value: "result" },
  { label: "透明底", value: "cutout" },
];

/**
 * 预览舞台：三视图切换 + 拖拽上传 + 拖动构图。
 *
 * 画布始终挂载（空图时 CSS 隐藏）——条件渲染会让 `previewRef` 在图片解码完成
 * 的那一刻还是 null，第一次合成结果就画不出来。
 *
 * 只有「成品」视图能拖：另两个视图画的是原图与未缩放的前景，拖动它们不会
 * 改变任何东西，允许拖反而会让人以为没生效。
 */
export default function IdPhotoStage({
  previewRef,
  hasImage,
  view,
  info,
  onView,
  onDropFile,
  onPan,
}: IdPhotoStageProps) {
  const [dragging, setDragging] = useState(false);
  /** 上一次指针位置；null = 当前没有拖动（与「位移为 0」区分开） */
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const canPan = hasImage && view === "result";

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canPan) return;
    // 只接左键/单指，右键菜单与双指缩放留给系统
    if (event.button !== 0) return;
    lastPointRef.current = { x: event.clientX, y: event.clientY };
    // 指针移出画布后仍要继续收到 move，否则拖到边缘就断。
    // 指针已被系统回收时（合成事件、快速连点）会抛异常，不能让它中断拖动。
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 捕获失败只是拖出画布会停，本地拖动仍然可用
    }
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const last = lastPointRef.current;
    if (!last) return;
    // 拖动中途切到别的视图时，预览画布已经换成另一种尺寸，再换算就会跳位
    if (!canPan) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (dx === 0 && dy === 0) return;
    lastPointRef.current = { x: event.clientX, y: event.clientY };
    onPan(dx, dy);
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!lastPointRef.current) return;
    lastPointRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="idp-stage"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onDropFile(file);
      }}
    >
      <div className="idp-stage__bar">
        <Segmented
          size="small"
          value={view}
          disabled={!hasImage}
          options={VIEW_OPTIONS}
          onChange={(value) => onView(value as PhotoView)}
        />
        <span className="idp-stage__info">{info}</span>
      </div>

      <div className="idp-stage__canvas-wrap">
        <canvas
          ref={previewRef}
          className={[
            "idp-stage__canvas",
            hasImage ? "" : "is-empty",
            canPan ? "is-draggable" : "",
            dragging ? "is-dragging" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />

        {hasImage ? null : (
          <div className="idp-stage__placeholder">
            <p className="idp-stage__icon">
              <InboxOutlined />
            </p>
            <p className="idp-stage__title">把证件照拖进来，或点右侧「选择照片」</p>
            <p className="idp-stage__hint">
              纯色背景（蓝底 / 红底 / 白底）的正面照效果最好；也支持截图后 Ctrl+V 粘贴
            </p>
          </div>
        )}

        {canPan ? (
          <p className="idp-stage__pan-tip">
            <DragOutlined />
            按住图片拖动可调整构图
          </p>
        ) : null}
      </div>
    </div>
  );
}
