import { describe, expect, it } from "vitest";
import {
  countWords,
  DEFAULT_VOLUME_NAME,
  detectChapterNumbering,
  isChapterTitle,
  isVolumeTitle,
  parseTxtBook,
  stripChapterNumbering,
} from "./novel-import-parser";

describe("标题识别", () => {
  it("识别常见章节标题", () => {
    for (const line of [
      "第一章 初见",
      "第1章 初见",
      "第一百二十三章 终局",
      "第十回 交手",
      "第五十七节 尾声",
      "Chapter 12 The End",
      "  第003章 无缩进  ",
    ]) {
      expect(isChapterTitle(line), line).toBe(true);
    }
  });

  it("识别卷标题（严格模式）", () => {
    for (const line of [
      "第一卷 风起云涌",
      "第一卷：风起",
      "第 二 卷",
      "卷一",
      "卷12 少年游",
      "12卷 少年游",
      "Volume 3",
      "Book 2 归途",
    ]) {
      expect(isVolumeTitle(line), line).toBe(true);
    }
  });

  it("卷标题不算章，章标题不算卷", () => {
    expect(isChapterTitle("第一卷 风起")).toBe(false);
    expect(isVolumeTitle("第一章 初见")).toBe(false);
  });

  it("广告元信息行一律不识别为标题", () => {
    for (const line of [
      "第一章 请记住本站",
      "www.example.com",
      "最新章节",
      "作者：某某",
      "内容简介：",
      "【『第一章』】",
      "http://abc.com",
    ]) {
      expect(isChapterTitle(line), line).toBe(false);
      expect(isVolumeTitle(line), line).toBe(false);
    }
  });

  it("普通句子不误判", () => {
    for (const line of ["他走进第一卷书库", "这是一个很长的普通叙述段落，不属于任何标题"]) {
      expect(isChapterTitle(line), line).toBe(false);
      expect(isVolumeTitle(line), line).toBe(false);
    }
  });
});

describe("stripChapterNumbering（导入时剥掉序号前缀）", () => {
  it("剥掉阿拉伯数字序号", () => {
    expect(stripChapterNumbering("第1章 初见")).toBe("初见");
    expect(stripChapterNumbering("第003章 无缩进")).toBe("无缩进");
    expect(stripChapterNumbering("Chapter 12 The End")).toBe("The End");
  });

  it("剥掉中文数字序号", () => {
    expect(stripChapterNumbering("第一百二十三章 终局")).toBe("终局");
    expect(stripChapterNumbering("第十回 交手")).toBe("交手");
    expect(stripChapterNumbering("第五十七节 尾声")).toBe("尾声");
    expect(stripChapterNumbering("第三集 落幕")).toBe("落幕");
  });

  it("序号与章名之间是冒号 / 顿号 / 破折号也能剥", () => {
    expect(stripChapterNumbering("第一章：开端")).toBe("开端");
    expect(stripChapterNumbering("第一章、开端")).toBe("开端");
    expect(stripChapterNumbering("第一章 —— 开端")).toBe("开端");
    expect(stripChapterNumbering("第一章 · 开端")).toBe("开端");
  });

  it("只有序号没有章名：剥成空串（由调用方按本书规则补「第N×」）", () => {
    expect(stripChapterNumbering("第一章")).toBe("");
    expect(stripChapterNumbering("第十二回")).toBe("");
    expect(stripChapterNumbering("  第 3 章  ")).toBe("");
  });

  it("无序号前缀的标题原样返回（仅规整空白）", () => {
    expect(stripChapterNumbering("序章")).toBe("序章");
    expect(stripChapterNumbering("番外 · 那年夏天")).toBe("番外 · 那年夏天");
  });

  it("不误伤正文标题里以「第」开头的普通词", () => {
    // 「第一次」不是章节序号：缺「章」类后缀，不剥
    expect(stripChapterNumbering("第一次相遇")).toBe("第一次相遇");
    expect(stripChapterNumbering("第二天")).toBe("第二天");
  });
});

describe("detectChapterNumbering（按书自适应规则）", () => {
  it("识别阿拉伯数字 + 章", () => {
    expect(detectChapterNumbering(["第1章 A", "第2章 B", "第10章 C"])).toEqual({
      suffix: "章",
      numberStyle: "arabic",
    });
  });

  it("识别中文数字 + 章", () => {
    expect(detectChapterNumbering(["第一章 A", "第二章 B"])).toEqual({
      suffix: "章",
      numberStyle: "chinese",
    });
  });

  it("识别回 / 节 / 集 等其它后缀", () => {
    expect(detectChapterNumbering(["第一回 A", "第二回 B", "第三回 C"])?.suffix).toBe("回");
    expect(detectChapterNumbering(["第一节 A", "第二节 B"])?.suffix).toBe("节");
  });

  it("混合出现时取多数派", () => {
    expect(detectChapterNumbering(["第1章 A", "第二章 B", "第3章 C", "第4章 D"])).toEqual({
      suffix: "章",
      numberStyle: "arabic",
    });
  });

  it("样本不足或全无序号返回 null（上层保留全局默认）", () => {
    expect(detectChapterNumbering([])).toBeNull();
    expect(detectChapterNumbering(["序章", "尾声"])).toBeNull();
  });
});

describe("parseTxtBook", () => {
  it("无卷结构：全部章节归入默认卷「正文」", () => {
    const text = [
      "第一章 开端",
      "正文一。",
      "",
      "第二章 发展",
      "正文二。",
    ].join("\n");

    const book = parseTxtBook(text);
    expect(book.structured).toBe(true);
    expect(book.volumes).toHaveLength(1);
    expect(book.volumes[0].name).toBe(DEFAULT_VOLUME_NAME);
    // 1.34.0：序号已剥离，只留纯章名；序号由左栏序号列派生展示
    expect(book.chapters.map((c) => c.title)).toEqual(["开端", "发展"]);
    expect(book.chapters.every((c) => c.volumeIndex === 0)).toBe(true);
    expect(book.chapters[0].content).toBe("正文一。");
    expect(book.chapters[1].content).toBe("正文二。");
    expect(book.numberingRule).toEqual({ suffix: "章", numberStyle: "chinese" });
  });

  it("卷归档：章节归属最近一个卷", () => {
    const text = [
      "第一卷 少年",
      "第一章 出生",
      "他出生了。",
      "第二章 求学",
      "他去求学。",
      "第二卷 风云",
      "第三章 出山",
      "他出山了。",
    ].join("\n");

    const book = parseTxtBook(text);
    expect(book.volumes.map((v) => v.name)).toEqual(["第一卷 少年", "第二卷 风云"]);
    expect(book.chapters.map((c) => c.title)).toEqual(["出生", "求学", "出山"]);
    // 前两章属卷 0，第三章属卷 1
    expect(book.chapters.map((c) => c.volumeIndex)).toEqual([0, 0, 1]);
  });

  it("开新卷后章节不会被上一卷续写", () => {
    const text = ["第一卷 A", "第一章 x", "aaa", "第二卷 B", "bbb"].join("\n");
    const book = parseTxtBook(text);
    // 「bbb」应落在卷 1 的兜底序章，而不是续到「第一章 x」里
    const first = book.chapters.find((c) => c.content === "aaa");
    expect(first?.title).toBe("x");
    const volumeOneChapters = book.chapters.filter((c) => c.volumeIndex === 1);
    expect(volumeOneChapters).toHaveLength(1);
    expect(volumeOneChapters[0].content).toBe("bbb");
  });

  it("无卷标记但开头有引文：开兜底序章容纳", () => {
    const text = ["这是引子。", "第一章 开端", "正文。"].join("\n");
    const book = parseTxtBook(text);
    expect(book.chapters[0].title).toContain("序");
    expect(book.chapters[0].content).toBe("这是引子。");
    expect(book.chapters[1].title).toBe("开端");
    expect(book.structured).toBe(true);
  });

  it("卷标记前的前言并入首个真实卷（不留「正文」空卷）", () => {
    // 书名 / 作者 / 网址在前，首个「第X卷」在后
    const text = [
      "《样例小说》",
      "作者：某某",
      "www.example.com",
      "第一卷 少年游",
      "第一章 出生",
      "他出生了。",
    ].join("\n");

    const book = parseTxtBook(text);
    // 没有多余的「正文」卷
    expect(book.volumes.map((v) => v.name)).toEqual(["第一卷 少年游"]);
    // 前言归入该卷的「· 序」章，且卷下标已修正为 0
    expect(book.chapters[0].title).toBe("第一卷 少年游 · 序");
    expect(book.chapters[0].volumeIndex).toBe(0);
    expect(book.chapters[0].content).toContain("《样例小说》");
    // 正常章节紧随其后，同属卷 0
    expect(book.chapters[1].title).toBe("出生");
    expect(book.chapters[1].volumeIndex).toBe(0);
  });

  it("无任何卷标记时前言仍留「正文 · 序」", () => {
    const text = ["前言一句。", "第一章 开端", "正文。"].join("\n");
    const book = parseTxtBook(text);
    expect(book.volumes.map((v) => v.name)).toEqual([DEFAULT_VOLUME_NAME]);
    expect(book.chapters[0].title).toBe("正文 · 序");
    expect(book.chapters[0].volumeIndex).toBe(0);
  });

  it("相邻重复标题折叠", () => {
    const text = ["第一章 开端", "第一章 开端", "正文。"].join("\n");
    const book = parseTxtBook(text);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].content).toBe("正文。");
  });

  it("相邻重复标题折叠按原始行判，剥序号后的空标题不被误折叠", () => {
    // 回归守卫：剥完序号后标题都是空串，若拿剥后的串判「相邻重复」，
    // 第二章往后会被整章丢掉 —— 必须按原始行判。
    const text = ["第一章", "正文一。", "第二章", "正文二。", "第三章", "正文三。"].join("\n");
    const book = parseTxtBook(text);
    expect(book.chapters).toHaveLength(3);
    expect(book.chapters.map((c) => c.content)).toEqual(["正文一。", "正文二。", "正文三。"]);
    // 剥后同为空，但原始行不同 → 都算真实章
    expect(book.chapters.every((c) => c.explicit)).toBe(true);
  });

  it("完全没有章节结构：整本兜底成一章且 structured=false", () => {
    const text = "这是一段没有任何章节标题的散文。\n第二段。";
    const book = parseTxtBook(text);
    expect(book.structured).toBe(false);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].content).toContain("散文");
    expect(book.volumes[0].name).toBe(DEFAULT_VOLUME_NAME);
    // 无章标题 → 识别不出规则，上层保留全局默认
    expect(book.numberingRule).toBeNull();
  });

  it("只有卷、没有章标题：仍算未结构化，不产出空章", () => {
    const text = ["第一卷 少年", "", "第二卷 风云"].join("\n");
    const book = parseTxtBook(text);
    expect(book.structured).toBe(false);
    expect(book.chapters).toHaveLength(1);
  });

  it("Windows 换行 \\r\\n 正确处理", () => {
    const text = "第一章 A\r\naaa\r\n第二章 B\r\nbbb";
    const book = parseTxtBook(text);
    expect(book.chapters.map((c) => c.title)).toEqual(["A", "B"]);
    expect(book.chapters[0].content).toBe("aaa");
    expect(book.chapters[1].content).toBe("bbb");
  });

  it("章标题里的多余空白被规整", () => {
    const book = parseTxtBook("第  一  章    开端\n正文");
    expect(book.chapters[0].title).toBe("开端");
  });

  it("导入书仅有序号、无章名：剥成空标题交给落库兜底", () => {
    const book = parseTxtBook("第一章\n正文一。\n\n第二章\n正文二。");
    expect(book.chapters.map((c) => c.title)).toEqual(["", ""]);
    expect(book.numberingRule).toEqual({ suffix: "章", numberStyle: "chinese" });
  });

  describe("正文行首缩进（REQ-059）", () => {
    it("全角空格缩进被剥掉：缩进统一交给编辑器 CSS，正文里不留空格", () => {
      // 事故：盗版 TXT 每段用两个全角空格做缩进，导进来后叠在 CSS 的 2em 上，
      // 手写段 2 字宽、导入段 4 字宽，字体缺字形时还渲染成空方块。
      const book = parseTxtBook(
        ["第一章 开端", "　　第一段。", "　　第二段。"].join("\n"),
      );
      expect(book.chapters[0].content).toBe("第一段。\n第二段。");
    });

    it("半角空格 / 制表符 / 不换行空格 / 零宽空格一并剥掉", () => {
      const book = parseTxtBook(
        [
          "第一章 开端",
          "   第一段。",
          "\t第二段。",
          "\u00a0\u3000第三段。",
          "\u200b第四段。",
        ].join("\n"),
      );
      expect(book.chapters[0].content).toBe(
        "第一段。\n第二段。\n第三段。\n第四段。",
      );
    });

    it("行尾空白也一并剥掉（粘贴时常带不可见的尾随空格）", () => {
      const book = parseTxtBook("第一章 开端\n第一段。  \u3000");
      expect(book.chapters[0].content).toBe("第一段。");
    });

    it("空行保留：分段习惯是作者的结构，不在导入时改动", () => {
      const book = parseTxtBook(
        ["第一章 开端", "　　第一段。", "", "　　第二段。"].join("\n"),
      );
      expect(book.chapters[0].content).toBe("第一段。\n\n第二段。");
    });

    it("无章结构的整本兜底同样剥缩进", () => {
      const book = parseTxtBook("　　第一段。\n　　第二段。");
      expect(book.chapters[0].content).toBe("第一段。\n第二段。");
    });
  });
});

describe("countWords", () => {
  it("忽略空白字符", () => {
    expect(countWords("你好 世界\n第二行")).toBe(7);
    expect(countWords("   ")).toBe(0);
  });
});
