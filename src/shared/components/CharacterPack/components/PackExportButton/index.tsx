import { Button, Dropdown } from "antd";
import { ExportOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackExportKey } from "../../pack-utils";
import { runPackInsertIntoChapter } from "../../pack-config";
import { copyText, downloadText } from "../../services/pack-export";

interface PackExportButtonProps {
  api: PackPanelApi;
  moduleKey: PackExportKey;
  /** 模块名：标题、文件名、提示文案共用同一份 */
  label: string;
}

/**
 * 模块级「导出面板文本」（1.39.1：系统流小说的 txt 排版，取代 Markdown 表格）。
 *
 * 一个图标按钮 + 两选一菜单（复制 / 下载），而不是两个并列按钮 ——
 * 模块头右侧本来就挤着「模板 / 新增 / 搜索 / 视图切换」，多摆一个按钮会把
 * 模块标题挤到省略号。菜单里的两个动作覆盖了两种落点：粘进正文（复制）与
 * 存一份留档（下载）。
 *
 * ⚠️ 文本**只在真正点击时才组装**（`build()` 在 handler 里调）。
 * 若在渲染期先算好再传给 `items`，面板每敲一个字都要把八段文本全建一遍 ——
 * 而它们 99% 的时间根本不会被用到。
 */
export default function PackExportButton({ api, moduleKey, label }: PackExportButtonProps) {
  const build = (): string => api.buildModuleText(moduleKey, label);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyText(build());
    if (ok) api.showToast(`已复制「${label}」的面板文本`);
    else api.showToast("复制失败，请改用「下载 .txt 文件」", "warning");
  };

  const handleDownload = async (): Promise<void> => {
    const path = await downloadText(`行囊-${label}.txt`, build(), "txt", "文本文件");
    if (path) api.showToast(`已导出：${path}`);
    else api.showToast("已取消导出", "info");
  };

  /**
   * 追加到本章正文末尾（REQ-034）。
   *
   * 走 `runPackInsertIntoChapter` 这条桥而不是直接拿到编辑器：行囊模块不认识
   * 编辑器（见 `pack-config.ts` 里那段说明）。桥那头没人接 = 当前宿主没有正文
   * （例如将来搬到分离窗口），此时如实说清原因，而不是静默什么都不发生。
   */
  const handleInsert = (): void => {
    const ok = runPackInsertIntoChapter(build());
    if (ok) api.showToast(`「${label}」已插入本章末尾`);
    else api.showToast("当前没有可写入的章节，请先在编辑器里打开一章", "warning");
  };

  return (
    <Dropdown
      trigger={["click"]}
      classNames={{ root: "cpk-dropdown" }}
      menu={{
        items: [
          { key: "copy", label: "复制面板文本", onClick: () => void handleCopy() },
          { key: "download", label: "下载 .txt 文件", onClick: () => void handleDownload() },
          { type: "divider" },
          { key: "insert", label: "插入本章末尾", onClick: () => handleInsert() },
        ],
      }}
    >
      <Button className="cpk-iconbtn" title={`导出「${label}」：复制 / 下载 / 插入本章末尾`}>
        <ExportOutlined />
      </Button>
    </Dropdown>
  );
}
