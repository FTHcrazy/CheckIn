import { useState } from "react";
import { App as AntdApp } from "antd";
import Page from "@/shared/components/Page";
import CompressDropZone from "./components/CompressDropZone";
import CompressSettings from "./components/CompressSettings";
import CompressSummary from "./components/CompressSummary";
import CompressList from "./components/CompressList";
import CompressCompareModal from "./components/CompressCompareModal";
import { useImageCompress } from "./hooks/useImageCompress";
import { downloadArchive } from "./image-export";
import "./index.scss";

/**
 * 图片压缩页。
 *
 * 把「PNG 单张量化」与「批量转格式 / 压质量」合成一个工作台：两者共用同一份
 * 参数与队列，输出格式选 PNG 就走调色板量化，选 JPEG / WebP 就走有损编码。
 * 拆成两页会让用户为了「同一批图里有的要 PNG 有的要 JPEG」来回切换并重选文件。
 */
export default function ImageCompressPage() {
  const {
    items,
    options,
    processing,
    summary,
    pendingCount,
    addFiles,
    removeItem,
    clearAll,
    setOptions,
    rerun,
  } = useImageCompress();
  const { message } = AntdApp.useApp();
  const [compareId, setCompareId] = useState<number | null>(null);

  const compareItem = items.find((item) => item.id === compareId) ?? null;

  const handleDownloadAll = () => {
    void downloadArchive(items)
      .then((count) => {
        if (count === 0) message.warning("还没有可下载的结果");
        else message.success(`已打包 ${count} 张图片`);
      })
      .catch(() => message.error("打包失败，可改为逐张下载"));
  };

  const handleClear = () => {
    clearAll();
    message.success("已清空列表");
  };

  return (
    <Page>
      <div className="imgc-page">
        <CompressDropZone onFiles={addFiles} />

        <section className="imgc-panel">
          <header className="imgc-panel__head">
            <h3 className="imgc-panel__title">压缩参数</h3>
            <span className="imgc-panel__hint">
              改动会对列表里的图片立即重压；结果不小于原图时自动保留原图
            </span>
          </header>
          <CompressSettings options={options} onChange={setOptions} />
        </section>

        <section className="imgc-panel imgc-panel--fill">
          <header className="imgc-panel__head">
            <h3 className="imgc-panel__title">图片列表</h3>
            <span className="imgc-panel__hint">
              全部在本地处理，不会上传到任何服务器
            </span>
          </header>
          <CompressSummary
            summary={summary}
            pendingCount={pendingCount}
            processing={processing}
            onRerun={rerun}
            onDownloadAll={handleDownloadAll}
            onClear={handleClear}
          />
          <CompressList
            items={items}
            onRemove={removeItem}
            onCompare={setCompareId}
          />
        </section>
      </div>

      <CompressCompareModal
        key={compareId ?? "none"}
        open={compareId !== null}
        item={compareItem}
        onClose={() => setCompareId(null)}
      />
    </Page>
  );
}
