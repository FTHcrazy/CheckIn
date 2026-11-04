/**
 * `upng-js` 的最小类型声明。
 *
 * 该包（photopea/UPNG.js，MIT）没有随包发布 `.d.ts`，而 §6.0 禁止用 `any` 兜住
 * 第三方返回值，所以在这里按**实际用到的**三个 API 精确描述，而不是整包补齐。
 * 用到新 API 时在这里补一行，不要在使用处 cast。
 *
 * 为什么声明成 default 而不是具名导出：`UPNG.js` 的产物是 `module.exports = UPNG`
 * 的 CJS 形态，具名导入要靠 Vite 的 CJS 静态分析才能成立（分析不出来就是运行期
 * `undefined`，且不报错）。default 导入经 interop 一定拿到整个对象，最稳。
 *
 * ⚠️ `encode` 会**原地修改**传入的 RGBA buffer（量化时复用该内存），调用前必须
 * `slice(0)` 深拷贝 —— 否则同一张图试第二组色数时，拿到的已经是上一轮被改过的数据。
 */
declare module "upng-js" {
  /** `decode` 的返回：只描述本仓实际读写的字段 */
  interface UpngImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    /** 已解码的完整像素数据（含帧头，需经 toRGBA8 转成 RGBA8） */
    data: Uint8Array;
    frames: unknown[];
    tabs: Record<string, unknown>;
  }

  interface UpngApi {
    /** 第 4 个参数为调色板色数：0 = 真彩色（无损重编码），2~256 = 量化到 N 色 */
    encode(
      buffers: ArrayBuffer[],
      width: number,
      height: number,
      colors?: number,
      delays?: number[],
    ): ArrayBuffer;
    decode(buffer: ArrayBuffer | Uint8Array): UpngImage;
    /** 返回每帧的 RGBA8（非动图只有一帧） */
    toRGBA8(image: UpngImage): ArrayBuffer[];
    [key: string]: unknown;
  }

  const UPNG: UpngApi;
  export default UPNG;
}
