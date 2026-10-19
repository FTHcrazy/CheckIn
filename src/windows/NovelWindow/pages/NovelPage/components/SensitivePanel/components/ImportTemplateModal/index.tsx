import { Modal, Button } from "antd";
import { CopyOutlined, DownloadOutlined } from "@ant-design/icons";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import {
  IMPORT_RULES,
  IMPORT_TEMPLATE_FILE_NAME,
  IMPORT_TEMPLATE_JSON_ARRAY,
  IMPORT_TEMPLATE_JSON_OBJECT,
  IMPORT_TEMPLATE_TEXT,
} from "../../../../sensitive/import-template";
import "./index.scss";

interface ImportTemplateModalProps {
  open: boolean;
  onClose: () => void;
  /** 复用面板的轻提示（复制成功 / 下载结果） */
  onNotify: (text: string, tone?: ToastTone) => void;
}

/**
 * 「导入词库」的格式示意。
 *
 * 用 Modal 而不是 Popover：内容要同时展示三种格式 + 规则清单，Popover 在右栏
 * （最窄 280px）会被挤成一条竖线，且无法滚动阅读。
 *
 * ⚠️ Modal 挂在 body portal，样式一律以 `.nv-tpl-modal` 独立命名空间声明，
 * **不能** scope 在 `.nv-panel` 下（那里根本选不到它的 DOM）。
 */
export default function ImportTemplateModal({
  open,
  onClose,
  onNotify,
}: ImportTemplateModalProps) {
  const handleCopy = (): void => {
    void navigator.clipboard
      ?.writeText(IMPORT_TEMPLATE_TEXT)
      .then(() => onNotify("模板已复制，粘贴到 .txt 保存即可导入", "success"))
      .catch(() => onNotify("复制失败，可手动选中模板文本", "error"));
  };

  const handleDownload = (): void => {
    try {
      const blob = new Blob([IMPORT_TEMPLATE_TEXT], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = IMPORT_TEMPLATE_FILE_NAME;
      anchor.click();
      // 立刻回收会让部分环境下载失败，推迟一拍
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotify("模板已下载到「下载」文件夹", "success");
    } catch {
      onNotify("下载失败，可改用「复制模板」", "error");
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="词库导入格式"
      width={520}
      rootClassName="nv-tpl-modal"
      footer={[
        <Button key="copy" className="nv-tpl__btn" icon={<CopyOutlined />} onClick={handleCopy}>
          复制模板
        </Button>,
        <Button
          key="download"
          className="nv-tpl__btn"
          icon={<DownloadOutlined />}
          onClick={handleDownload}
        >
          下载模板
        </Button>,
        <Button key="close" className="nv-tpl__btn nv-tpl__btn--primary" onClick={onClose}>
          知道了
        </Button>,
      ]}
    >
      <div className="nv-tpl">
        <p className="nv-tpl__lead">
          支持纯文本与 JSON 两种写法，导入时自动去重、跳过无效行。推荐直接用纯文本：
        </p>

        <div className="nv-tpl__block">
          <div className="nv-tpl__block-head">
            <span className="nv-tpl__tag">推荐</span>
            <span className="nv-tpl__block-title">纯文本 · 每行一个词（.txt）</span>
          </div>
          <pre className="nv-tpl__code">{IMPORT_TEMPLATE_TEXT.trimEnd()}</pre>
        </div>

        <div className="nv-tpl__block">
          <div className="nv-tpl__block-head">
            <span className="nv-tpl__tag nv-tpl__tag--muted">兼容</span>
            <span className="nv-tpl__block-title">JSON · 字符串数组或 words 字段（.json）</span>
          </div>
          <pre className="nv-tpl__code">{IMPORT_TEMPLATE_JSON_ARRAY}</pre>
          <pre className="nv-tpl__code">{IMPORT_TEMPLATE_JSON_OBJECT}</pre>
        </div>

        <ul className="nv-tpl__rules">
          {IMPORT_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
