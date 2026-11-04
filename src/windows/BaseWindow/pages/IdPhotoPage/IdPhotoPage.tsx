import { useEffect } from "react";
import { App as AntdApp } from "antd";
import Page from "@/shared/components/Page";
import IdPhotoStage from "./components/IdPhotoStage";
import IdPhotoControls from "./components/IdPhotoControls";
import { useIdPhoto } from "./hooks/useIdPhoto";
import "./index.scss";

/**
 * 证件照换底色页。
 *
 * 全部在本地画布完成：边界漫水抠出人像 → 铺新底色 → 按证件尺寸输出。
 * 不上传、不调模型，换底色只是同一张透明底上的一次合成，点色块即时出新图。
 */
export default function IdPhotoPage() {
  const {
    options,
    image,
    stats,
    view,
    error,
    previewRef,
    hasImage,
    backdropReliable,
    loadFile,
    reset,
    panBy,
    exportResult,
    exportTransparent,
    setView,
    patch,
    setError,
  } = useIdPhoto();
  const { message } = AntdApp.useApp();

  // 截图后 Ctrl+V 直接进来（与图片压缩 / 色键抠图保持一致的第二个入口）
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
    if (!error) return;
    message.error(error);
    // 同一条错误只弹一次，否则下一次任意渲染都会重复提示
    setError("");
  }, [error, message, setError]);

  const handleExport = async (): Promise<boolean> => {
    const ok = await exportResult();
    if (ok) message.success(`已导出 ${options.width}×${options.height} · ${options.dpi} DPI`);
    else message.warning("还没有可导出的结果");
    return ok;
  };

  const handleExportTransparent = async (): Promise<boolean> => {
    const ok = await exportTransparent();
    if (ok) message.success("已导出透明底 PNG");
    else message.warning("还没有可导出的结果");
    return ok;
  };

  return (
    <Page>
      <div className="idp-page">
        <IdPhotoStage
          previewRef={previewRef}
          hasImage={hasImage}
          view={view}
          info={
            hasImage
              ? `${options.width} × ${options.height} px · ${options.dpi} DPI`
              : ""
          }
          onView={setView}
          onDropFile={loadFile}
          onPan={panBy}
        />
        <IdPhotoControls
          options={options}
          image={image}
          stats={stats}
          backdropReliable={backdropReliable}
          onPatch={patch}
          onSelectFile={loadFile}
          onReset={reset}
          onExport={handleExport}
          onExportTransparent={handleExportTransparent}
        />
      </div>
    </Page>
  );
}
