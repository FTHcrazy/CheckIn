import { useEffect } from "react";
import { App as AntdApp } from "antd";
import Page from "@/shared/components/Page";
import ChromaStage from "./components/ChromaStage";
import ChromaControls from "./components/ChromaControls";
import { useChromaKey } from "./hooks/useChromaKey";
import "./index.scss";

/**
 * 色键抠图页。
 *
 * 全部在本地 canvas 上完成：点图取色 → 调相似色阈值 → 导出 PNG。
 * 不上传、不调模型，所以没有网络等待，调参数就是即时反馈。
 */
export default function ChromaKeyPage() {
  const {
    key,
    tolerance,
    feather,
    image,
    removed,
    error,
    previewRef,
    hasImage,
    loadFile,
    pickAt,
    reset,
    exportPng,
    setKey,
    setTolerance,
    setFeather,
  } = useChromaKey();
  const { message } = AntdApp.useApp();

  // 截图后 Ctrl+V 直接进来（与图片压缩页保持一致的第二条入口）
  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      loadFile(files[0]);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [loadFile]);

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  const handleExport = async (): Promise<boolean> => {
    const ok = await exportPng();
    if (ok) message.success("已导出透明底 PNG");
    else message.warning("还没有可导出的结果");
    return ok;
  };

  return (
    <Page>
      <div className="ck-page">
        <ChromaStage
          previewRef={previewRef}
          hasImage={hasImage}
          onPick={pickAt}
          onDropFile={loadFile}
        />
        <ChromaControls
          keyColor={key}
          tolerance={tolerance}
          feather={feather}
          removed={removed}
          image={image}
          onKeyColor={setKey}
          onTolerance={setTolerance}
          onFeather={setFeather}
          onSelectFile={loadFile}
          onReset={reset}
          onExport={handleExport}
        />
      </div>
    </Page>
  );
}
