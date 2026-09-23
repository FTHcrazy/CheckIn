import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOTATION } from "../novel-config";
import type { NovelEntity } from "../types";
import {
  hoverActions,
  registerHoverResolver,
  useHoverStore,
} from "./useHoverStore";

const state = () => useHoverStore.getState();

/** 构造一个只带展示必需字段的要素（store 只做快照，不做业务判断） */
function entity(id: string, name: string): NovelEntity {
  return {
    id,
    workId: "w1",
    type: "character",
    name,
    aliases: [],
    summary: "简介",
    content: "",
    fields: {},
    sort: 1,
  };
}

describe("useHoverStore（悬浮资料卡意图）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerHoverResolver(null);
    state().dismiss();
  });

  afterEach(() => {
    registerHoverResolver(null);
    state().dismiss();
    vi.useRealTimers();
  });

  it("指针停留满阈值才浮现，并解析出要素快照", () => {
    registerHoverResolver((id) => (id === "e1" ? entity("e1", "苏晚") : null));

    state().enter("e1", 10, 20);
    expect(state().target).toBeNull();

    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs - 1);
    expect(state().target).toBeNull();

    vi.advanceTimersByTime(2);
    expect(state().target).toEqual({ entityId: "e1", x: 10, y: 20 });
    expect(state().entity?.name).toBe("苏晚");
  });

  it("浮现前移开则不显示，移开后满关闭时长才收起", () => {
    registerHoverResolver((id) => entity(id, "苏晚"));

    state().enter("e1", 10, 20);
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs - 1);
    state().leave();
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs);
    expect(state().target).toBeNull();

    // 已显示 → leave 后要等关闭时长才消失
    state().enter("e1", 10, 20);
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs + 1);
    expect(state().target).not.toBeNull();

    state().leave();
    vi.advanceTimersByTime(ANNOTATION.hoverCloseMs - 1);
    expect(state().target).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(state().target).toBeNull();
    expect(state().entity).toBeNull();
  });

  it("同一要素内移动只改坐标；坐标没变时不产生新对象（不触发重渲染）", () => {
    registerHoverResolver((id) => entity(id, "苏晚"));
    state().enter("e1", 10, 20);
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs + 1);

    const before = state().target;
    state().enter("e1", 10, 20);
    expect(state().target).toBe(before);

    state().enter("e1", 11, 21);
    expect(state().target).not.toBe(before);
    expect(state().target).toEqual({ entityId: "e1", x: 11, y: 21 });
    // 已显示时移动不再重新计时，卡片不会闪
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs * 2);
    expect(state().target).toEqual({ entityId: "e1", x: 11, y: 21 });
  });

  it("从上一个词直接滑到另一个词：重新计时且不再沿用旧 entityId", () => {
    registerHoverResolver((id) => entity(id, id === "e1" ? "苏晚" : "陆昭"));
    state().enter("e1", 10, 20);
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs + 1);
    expect(state().entity?.name).toBe("苏晚");

    state().enter("e2", 30, 40);
    expect(state().target?.entityId).toBe("e1"); // 尚未到时，仍显示旧卡

    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs + 1);
    expect(state().target).toEqual({ entityId: "e2", x: 30, y: 40 });
    expect(state().entity?.name).toBe("陆昭");
  });

  it("dismiss 立即收起并作废在途计时器；已关闭时不再通知", () => {
    registerHoverResolver((id) => entity(id, "苏晚"));

    state().enter("e1", 10, 20);
    state().dismiss();
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs * 2);
    expect(state().target).toBeNull();

    // 已关闭状态下再 dismiss：target 引用保持不变（不产生空提交）
    const before = state().target;
    state().dismiss();
    expect(state().target).toBe(before);
  });

  it("未注册解析器时目标照常浮现但要素为空（卡片不渲染）", () => {
    state().enter("e1", 10, 20);
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs + 1);
    expect(state().target).not.toBeNull();
    expect(state().entity).toBeNull();
  });

  it("hoverActions 是稳定入口，与 store 动作行为一致", () => {
    registerHoverResolver((id) => entity(id, "苏晚"));

    hoverActions.enter("e1", 5, 6);
    vi.advanceTimersByTime(ANNOTATION.hoverOpenMs + 1);
    expect(state().target).toEqual({ entityId: "e1", x: 5, y: 6 });

    hoverActions.dismiss();
    expect(state().target).toBeNull();
  });
});
