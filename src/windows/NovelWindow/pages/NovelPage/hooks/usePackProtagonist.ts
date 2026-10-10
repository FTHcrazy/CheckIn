import { useCallback, useEffect, useRef, useState } from "react";
import {
  PACK_PROTAGONIST_EVENT,
  notifyProtagonistChanged,
  readEventDetail,
  type PackProtagonistEventDetail,
} from "@/shared/components/CharacterPack/pack-config";
import {
  fetchProtagonistBinding,
  writeProtagonistBinding,
} from "@/shared/components/CharacterPack/services/pack-service";

/**
 * 行囊主角绑定（右侧要素栏 ↔ 行囊面板的交叉点）。
 *
 * 「谁是主角」不另建表：唯一事实源是 `novel_pack_characters.entity_id`，
 * 本 hook 只是它在右侧要素栏这一侧的读数 + 写入口。真正的定义与广播都
 * 归行囊模块（pack-config / pack-service），这里只做页面级状态与订阅，
 * 保证行囊整体迁到独立窗口时本文件是唯一需要换入口的地方。
 *
 * 读取返回 null 表示该作品还没建过行囊角色（作者从没打开过行囊），
 * 此时右侧要素栏不显示任何主角角标，而不是伪造一个空主角。
 */
export function usePackProtagonist(workId: string) {
  const [entityId, setEntityId] = useState("");
  const [busy, setBusy] = useState(false);
  /** 请求序号：快速换书时旧请求的响应必须丢弃，否则会把上一本书的主角带过来 */
  const requestSeqRef = useRef(0);

  /** 重新读库。重置为模板书籍这类「改动发生在别的通道、workId 却不变」的场景需要它 */
  const refresh = useCallback(async (): Promise<void> => {
    const seq = (requestSeqRef.current += 1);
    if (!workId) {
      setEntityId("");
      return;
    }
    try {
      const result = await fetchProtagonistBinding(workId);
      if (seq !== requestSeqRef.current) return;
      setEntityId(result?.entityId ?? "");
    } catch {
      if (seq !== requestSeqRef.current) return;
      setEntityId("");
    }
  }, [workId]);

  // 装载：换书时整体重来
  useEffect(() => {
    void refresh();
    return undefined;
  }, [refresh]);

  // 同步：行囊面板那边绑定 / 解绑后，这里要跟着变（含分离窗口）
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const detail = readEventDetail<PackProtagonistEventDetail>(args);
      if (!detail || typeof detail !== "object") return;
      if (detail.workId && detail.workId !== workId) return;
      setEntityId(detail.entityId ?? "");
    };
    window.addEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);

    const api = window.electronAPI?.windowAPI;
    api?.on(PACK_PROTAGONIST_EVENT, handler);
    return () => {
      window.removeEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
      api?.off(PACK_PROTAGONIST_EVENT, handler);
    };
  }, [workId]);

  /**
   * 设为主角 / 换一个 / 再点一次即取消主角。
   *
   * 不做二次确认：动作本身可逆，且角标与卡片外观会立刻给出反馈，
   * 弹一次确认反而是给「随时可撤的一次点击」加税。
   */
  const designate = useCallback(
    async (nextEntityId: string): Promise<boolean> => {
      if (!workId) return false;
      const target = nextEntityId === entityId ? "" : nextEntityId;
      const rollback = entityId;
      // 作废在途的 refresh：否则它回来会把这次的乐观更新覆盖掉
      requestSeqRef.current += 1;
      setBusy(true);
      // 乐观更新：角标是即时反馈，等 IPC 回来再刷会有肉眼可见的延迟
      setEntityId(target);
      try {
        const ok = await writeProtagonistBinding(workId, target);
        if (!ok) {
          setEntityId(rollback);
          return false;
        }
        notifyProtagonistChanged(workId, target);
        return true;
      } catch {
        setEntityId(rollback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [workId, entityId],
  );

  return { protagonistEntityId: entityId, designate, busy, refresh };
}
