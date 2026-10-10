import { useEffect, useState } from "react";
import { BookOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import CharacterPackHost from "@/shared/components/CharacterPack";

/**
 * PackWindow —— 行囊独立窗口
 *
 * 行囊（CharacterPack）已从 NovelPage 内嵌面板升级为独立窗口：
 * 模块本体在 `shared/components/CharacterPack`（NovelWindow 与本窗口共用，
 * 窗口之间禁止互相导入）。
 *
 * 上下文（workId / chapterId）有两条投递路径，负载形状相同：
 * - `pack-window-context`：主进程在新窗口 did-finish-load 后下发（打开时携带）；
 * - `novel-work-changed`：NovelWindow 切换作品 / 章节后广播，本窗口主动跟进
 *   （重挂载宿主 → 重新装载 bundle；旧作品的未保存编辑已由草稿兜底）。
 *
 * 主角绑定同步无需本层参与：行囊模块内部已订阅 PACK_PROTAGONIST_EVENT
 * 跨窗口广播（`notifyProtagonistChanged` 同窗口 + broadcast 双发）。
 */

/** 行囊窗口上下文：跟随 NovelWindow 当前编辑的作品 / 章节 */
interface PackWindowContext {
  workId: string;
  chapterId: string;
}

function isPackWindowContext(value: unknown): value is PackWindowContext {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { workId?: unknown }).workId === "string"
  );
}

export default function PackWindowApp() {
  const [context, setContext] = useState<PackWindowContext | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return undefined;
    const handler = (...args: unknown[]): void => {
      // 同一 handler 服务两条投递路径：sendTo 的负载就是对象本身，
      // broadcast 亦同（经 preload 的 wrapper 转发），无需再归一化 Event 形态。
      const first = args[0];
      if (!isPackWindowContext(first)) return;
      setContext({
        workId: first.workId,
        chapterId: typeof first.chapterId === "string" ? first.chapterId : "",
      });
    };
    api.on("pack-window-context", handler);
    api.on("novel-work-changed", handler);
    return () => {
      api.off("pack-window-context", handler);
      api.off("novel-work-changed", handler);
    };
  }, []);

  return (
    <div className="window-shell">
      <WindowHeader title="行囊" icon={<BookOutlined />} />
      <div className="window-shell__body">
        {context ? (
          // key = workId：切作品时整只重挂 —— usePackData 的卸载兜底会把
          // 旧作品的草稿 flush 落库（渲染进程还活着，异步 IPC 能跑完），
          // 然后新作品从草稿 + 正式行完整装载
          <CharacterPackHost
            key={context.workId}
            workId={context.workId}
            chapterId={context.chapterId}
            onClose={() => window.electronAPI?.send("window-control", "close")}
          />
        ) : (
          <div className="pack-window__loading">正在打开行囊…</div>
        )}
      </div>
    </div>
  );
}
