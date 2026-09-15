/**
 * 窗口管理池
 * 统一管理所有 BrowserWindow 实例，提供注册、获取、广播能力
 */
import { BrowserWindow } from 'electron';

class WindowManager {
  private windows = new Map<string, BrowserWindow>();

  /**
   * 注册窗口到管理池
   * 自动监听 closed 事件，窗口关闭时自动注销
   */
  register(name: string, win: BrowserWindow): void {
    if (this.windows.has(name)) {
      const existing = this.windows.get(name);
      if (existing && !existing.isDestroyed()) {
        console.warn(`[windowManager] 窗口 "${name}" 已存在，将被替换`);
        existing.close();
      }
    }

    this.windows.set(name, win);
    console.log(`[windowManager] 注册窗口: ${name}`);

    // 自动清理：窗口关闭时注销
    win.on('closed', () => {
      if (this.windows.get(name) === win) {
        this.windows.delete(name);
        console.log(`[windowManager] 注销窗口: ${name}`);
      }
    });
  }

  /**
   * 注销指定窗口
   */
  unregister(name: string): void {
    this.windows.delete(name);
  }

  /**
   * 获取指定名称的窗口
   */
  get(name: string): BrowserWindow | undefined {
    const win = this.windows.get(name);
    return win && !win.isDestroyed() ? win : undefined;
  }

  /**
   * 获取所有已注册窗口（只读副本）
   */
  getAll(): Map<string, BrowserWindow> {
    return new Map(this.windows);
  }

  /**
   * 向所有窗口广播消息
   * @param exclude 排除的窗口名称（可选）
   */
  broadcast(event: string, data?: unknown, exclude?: string): void {
    for (const [name, win] of this.windows) {
      if (name === exclude) continue;
      if (!win.isDestroyed()) {
        win.webContents.send(event, data);
      }
    }
  }

  /**
   * 向指定窗口发送消息
   */
  sendTo(target: string, event: string, data?: unknown): void {
    const win = this.get(target);
    if (win) {
      win.webContents.send(event, data);
    }
  }

  /**
   * 获取所有窗口名称
   */
  getNames(): string[] {
    return Array.from(this.windows.keys());
  }

  /**
   * 检查窗口是否存在
   */
  has(name: string): boolean {
    const win = this.windows.get(name);
    return win !== undefined && !win.isDestroyed();
  }

  /**
   * 获取窗口数量
   */
  get size(): number {
    return this.windows.size;
  }
}

// 单例导出
export const windowManager = new WindowManager();
