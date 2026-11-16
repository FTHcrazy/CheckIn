/**
 * `window-send-to` 选项契约（R27 / S6.1）
 *
 * 这组用例的存在理由是一次真机故障：`create: true` 从来没生效过。
 *
 * 渲染层按「第 4 位布尔 raise、第 5 位 options」传参，主进程只读第 4 个位置参数，
 * 于是 `{create:true}` 被丢掉、`readWindowSendOptions(true)` 只解析出 `raise`。
 * 表现是「主窗口关掉后点『在主窗口打开资料卡』→ 提示主窗口没能打开」，而静态
 * 检查、类型检查、源码字符串守卫**全都通过** —— 两边各自都是合法签名。
 *
 * 所以这里钉的不是「某段代码长什么样」，而是**两边互逆**：
 * `buildWindowSendOptions` 写出去的东西，`readWindowSendOptions` 必须原样读回来；
 * 而且旧的位置参数形状也要读得出 `create`，两份产物错位共存时才不会二次复发。
 */
import { describe, expect, it } from "vitest";
import { buildWindowSendOptions, readWindowSendOptions } from "./window-send-options";

describe("buildWindowSendOptions：preload 侧只往外送「一个」选项对象", () => {
  it("raise 与 options 合并成一个对象", () => {
    expect(buildWindowSendOptions(true, { create: true })).toEqual({
      raise: true,
      create: true,
    });
  });

  it("不传 raise 时不塞一个假的 false 覆盖别处的值", () => {
    expect(buildWindowSendOptions(undefined, { queue: true })).toEqual({ queue: true });
  });

  it("什么都不传就是一个空对象（主进程读到全 false）", () => {
    expect(buildWindowSendOptions()).toEqual({});
  });
});

describe("readWindowSendOptions：三个开关永远有确定值", () => {
  it("缺省全 false（不会因为 undefined 走进「静默丢弃」分支）", () => {
    expect(readWindowSendOptions()).toEqual({ raise: false, create: false, queue: false });
    expect(readWindowSendOptions(undefined)).toEqual({ raise: false, create: false, queue: false });
    expect(readWindowSendOptions(null)).toEqual({ raise: false, create: false, queue: false });
  });

  it("真值只认 === true，字符串 / 1 之类不算声明", () => {
    expect(readWindowSendOptions({ create: "true" })).toEqual({
      raise: false,
      create: false,
      queue: false,
    });
  });
});

describe("两边互逆：写出去的选项必须能原样读回来（本次故障的直接用例）", () => {
  it("create 经 build → read 一轮仍然是 create", () => {
    const wire = buildWindowSendOptions(true, { create: true });
    expect(readWindowSendOptions(wire)).toEqual({ raise: true, create: true, queue: false });
  });

  it("queue 与 create 同时声明不互相吞掉", () => {
    const wire = buildWindowSendOptions(false, { create: true, queue: true });
    expect(readWindowSendOptions(wire)).toEqual({ raise: false, create: true, queue: true });
  });
});

describe("旧签名容错：两份产物（preload / main）错位共存也要读到 create", () => {
  it("旧形状：第 4 位布尔 raise + 第 5 位 options", () => {
    // 旧 preload 的实际传参方式：readWindowSendOptions(true, {create:true})
    expect(readWindowSendOptions(true, { create: true })).toEqual({
      raise: true,
      create: true,
      queue: false,
    });
  });

  it("新形状：只有一个合并后的对象", () => {
    expect(readWindowSendOptions({ raise: true, create: true })).toEqual({
      raise: true,
      create: true,
      queue: false,
    });
  });

  it("混合形状：第 5 位缺失不影响第 4 位的解析", () => {
    expect(readWindowSendOptions({ create: true }, undefined)).toEqual({
      raise: false,
      create: true,
      queue: false,
    });
  });
});
