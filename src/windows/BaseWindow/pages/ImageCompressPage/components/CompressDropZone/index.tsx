import { useCallback, useEffect, useRef } from "react";
import { Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import "./index.scss";

interface CompressDropZoneProps {
  onFiles: (files: File[]) => void;
}

/**
 * 选图区：点击 / 拖拽 / 粘贴三条入口。
 *
 * 批量选择必须**攒成一批**再交给 store：antd 的 `beforeUpload` 是逐文件回调，
 * 逐个 addFiles 会让每一批都被下一次调度顶掉（令牌一换旧任务就作废），
 * 结果只剩最后一张被压。这里用 0ms 定时器合并同一轮事件里的文件。
 */
export default function CompressDropZone({ onFiles }: CompressDropZoneProps) {
  const bufferRef = useRef<File[]>([]);
  const timerRef = useRef<number | null>(null);
  const onFilesRef = useRef(onFiles);

  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  const queue = useCallback((files: File[]) => {
    if (files.length === 0) return;
    bufferRef.current = [...bufferRef.current, ...files];
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      const batch = bufferRef.current;
      bufferRef.current = [];
      timerRef.current = null;
      onFilesRef.current(batch);
    }, 0);
  }, []);

  // 卸载时清掉未触发的合并任务，避免对已卸载组件派发
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      bufferRef.current = [];
    },
    [],
  );

  // 截图后直接 Ctrl+V：写作/设计场景里这是最常用的一条入口
  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      queue(files);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [queue]);

  return (
    <Upload.Dragger
      className="imgc-drop"
      multiple
      accept="image/*"
      showUploadList={false}
      openFileDialogOnClick
      beforeUpload={(file) => {
        // 逐个回调都会进来；`queue` 里的 0ms 合并会把同一轮事件的文件攒成一批
        queue([file]);
        // 返回 false = 不进入 antd 的上传队列（本页全部在本地处理，不上传）
        return false;
      }}
    >
      <p className="imgc-drop__icon">
        <InboxOutlined />
      </p>
      <p className="imgc-drop__title">点击选择，或把图片拖到这里</p>
      <p className="imgc-drop__hint">
        支持 PNG / JPEG / WebP / GIF / BMP，可多选；也支持截图后直接 Ctrl+V 粘贴
      </p>
    </Upload.Dragger>
  );
}
