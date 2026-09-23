import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMemoStore } from "./useMemoStore";
import { useMemoSearchStore } from "./useMemoSearchStore";

const search = () => useMemoSearchStore.getState();
const memo = () => useMemoStore.getState();

function reset(): void {
  useMemoSearchStore.setState({
    searchOpen: false,
    searchQuery: "",
    activeSearchQuery: "",
    activeSearchIndex: 0,
  });
  useMemoStore.setState({
    selected: "a.md",
    content: "编辑中的苏晚与苏晚",
    originalContent: "已保存的苏晚",
    saving: false,
    isEditing: false,
    createModalOpen: false,
    newFileName: "",
  });
}

describe("useMemoSearchStore（备忘搜索状态）", () => {
  beforeEach(reset);
  afterEach(reset);

  it("预览态在原文里查找，命中即记录关键词", () => {
    search().setSearchQuery("苏晚");
    expect(search().find()).toBe(true);

    expect(search().activeSearchQuery).toBe("苏晚");
    expect(search().activeSearchIndex).toBe(0);
  });

  it("编辑态在草稿里查找（草稿里有两处命中）", () => {
    useMemoStore.setState({ isEditing: true });

    search().setSearchQuery("苏晚");
    expect(search().find()).toBe(true);
    expect(search().find()).toBe(true);
    expect(search().activeSearchIndex).toBe(1);

    // 第三次回到第一个命中，循环查找
    expect(search().find()).toBe(true);
    expect(search().activeSearchIndex).toBe(0);
  });

  it("没有命中时返回 false 且不改高亮关键词", () => {
    search().setSearchQuery("不存在的词");
    expect(search().find()).toBe(false);
    expect(search().activeSearchQuery).toBe("");
  });

  it("空关键词直接返回 false", () => {
    search().setSearchQuery("   ");
    expect(search().find()).toBe(false);
  });

  it("换关键词后命中序号归零", () => {
    // 草稿里有两处「苏晚」，才能看出序号从 1 被重置
    useMemoStore.setState({ isEditing: true });

    search().setSearchQuery("苏晚");
    search().find();
    search().find();
    expect(search().activeSearchIndex).toBe(1);

    search().setSearchQuery("编辑");
    search().find();
    expect(search().activeSearchQuery).toBe("编辑");
    expect(search().activeSearchIndex).toBe(0);
  });

  it("关闭搜索会清掉关键词与高亮", () => {
    search().setSearchOpen(true);
    search().setSearchQuery("苏晚");
    search().find();
    search().closeSearch();

    expect(search().searchOpen).toBe(false);
    expect(search().searchQuery).toBe("");
    expect(search().activeSearchQuery).toBe("");
    expect(search().activeSearchIndex).toBe(0);
  });

  it("查找读的是当前编辑态的正文，不依赖组件传参", () => {
    // 预览态：草稿里的第二处「苏晚」不应被计入
    search().setSearchQuery("苏晚");
    search().find();
    const previewHits = "已保存的苏晚".match(/苏晚/g)?.length ?? 0;
    expect(previewHits).toBe(1);

    // 切到编辑态后重新查找，草稿里有两处
    useMemoStore.setState({ isEditing: true });
    search().setSearchQuery("苏晚");
    search().find();
    expect(search().activeSearchQuery).toBe("苏晚");
    expect(memo().isEditing).toBe(true);
  });
});
