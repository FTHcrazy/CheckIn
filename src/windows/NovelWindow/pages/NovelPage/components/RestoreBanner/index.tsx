import { WarningFilled } from "@ant-design/icons";
import { formatClock } from "../../novel-utils";
import type { NovelRecovery } from "../../types";
import "./index.scss";

interface RestoreBannerProps {
  recovery: NovelRecovery;
  onAcknowledge: () => void;
}

/**
 * 崩溃恢复横幅（设计方案 §07 🛡️）
 *
 * 顶部细横幅，非模态；点「知道了」后本次会话不再出现。
 * 刻意不提供「放弃恢复」——丢稿风险不该交给用户判断。
 */
export default function RestoreBanner({
  recovery,
  onAcknowledge,
}: RestoreBannerProps) {
  return (
    <div className="nv-recbar" role="status">
      <WarningFilled className="nv-recbar__icon" />
      <span className="nv-recbar__text">
        检测到上次未正常退出，已恢复至 {formatClock(recovery.snapshotTime)}{" "}
        的自动快照（含本次新增 {recovery.deltaWords} 字）
      </span>
      <button type="button" className="nv-recbar__ack" onClick={onAcknowledge}>
        知道了
      </button>
    </div>
  );
}
