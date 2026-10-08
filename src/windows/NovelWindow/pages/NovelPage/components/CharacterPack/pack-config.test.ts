import { describe, expect, it } from "vitest";
import {
  notifyProtagonistChanged,
  PACK_PROTAGONIST_EVENT,
  readEventDetail,
  registerPackCloser,
  requestClosePackPanel,
  type PackProtagonistEventDetail,
} from "./pack-config";

/**
 * 事件负载归一化。
 *
 * 这一组测试钉死的是一个**纯静默**的失效模式：同一个事件有两条投递路径，
 * 负载形状不同（同窗口是 `CustomEvent.detail`，跨窗口是第一个参数本身）。
 * 曾经所有监听器都写 `args[0] as Detail`，于是同窗口那条路读出 `undefined`——
 * 读主角的会把值清空（点「设为主角」角标一闪就没），读境界的直接 return
 * （行囊和右侧面板各说各话）。而广播刻意排除发送者，没有任何一条路能兜住。
 */
describe("readEventDetail（事件负载归一化）", () => {
  it("跨窗口形状：第一个参数就是负载本身", () => {
    const payload: PackProtagonistEventDetail = { workId: "w1", entityId: "e1" };
    expect(readEventDetail<PackProtagonistEventDetail>([payload])).toEqual(payload);
  });

  it("同窗口形状：第一个参数是 CustomEvent，负载在 detail 上", () => {
    const payload: PackProtagonistEventDetail = { workId: "w1", entityId: "e1" };
    const event = new CustomEvent(PACK_PROTAGONIST_EVENT, { detail: payload });
    expect(readEventDetail<PackProtagonistEventDetail>([event])).toEqual(payload);
    // 反面：直接把事件对象当负载用，读 workerId 会得到 undefined
    expect((event as unknown as PackProtagonistEventDetail).workId).toBeUndefined();
  });

  it("无参数 / 无 detail 的裸 Event 都返回空值，且不抛", () => {
    expect(readEventDetail([])).toBeFalsy();
    expect(readEventDetail([new Event(PACK_PROTAGONIST_EVENT)])).toBeFalsy();
  });

  it("回归：广播后同窗口监听器能拿到负载（而不是拿到 CustomEvent 对象）", () => {
    const seen: Array<PackProtagonistEventDetail | undefined> = [];
    const handler = (...args: unknown[]) => {
      seen.push(readEventDetail<PackProtagonistEventDetail>(args));
    };
    window.addEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
    try {
      notifyProtagonistChanged("w1", "e1");
    } finally {
      window.removeEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ workId: "w1", entityId: "e1" });
  });
});

/**
 * 受保护关闭桥。
 *
 * 钉死「返回值是接管与否的诚实汇报」：调用方据此决定是否兜底。
 * 曾经三条外部路径都绕过这座桥直接 `setPackOpen(false)`，未保存拦截和草稿
 * flush 全被跳过 —— 在行囊里敲半天，关掉之后一个字都没留下。
 */
describe("受保护关闭桥（P1-8）", () => {
  it("面板未挂载时返回 false，调用方自行兜底", () => {
    registerPackCloser(null);
    expect(requestClosePackPanel()).toBe(false);
  });

  it("面板挂载后返回 true，并把关闭决定权交给面板", async () => {
    let called = 0;
    registerPackCloser(async () => {
      called += 1;
    });
    try {
      expect(requestClosePackPanel()).toBe(true);
      expect(requestClosePackPanel()).toBe(true);
      expect(called).toBe(2);
    } finally {
      registerPackCloser(null);
    }
  });

  it("面板拒绝关闭（有未保存改动时弹拦截）时桥仍然是 true —— 它只报告已接管", async () => {
    registerPackCloser(async () => {
      /* 面板选择什么都不做：弹出了关闭拦截 */
    });
    try {
      expect(requestClosePackPanel()).toBe(true);
    } finally {
      registerPackCloser(null);
    }
  });
});
