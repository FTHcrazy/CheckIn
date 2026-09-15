# Changelog

## [1.0.2] - 2026-09-15

### Fixed
- 修复 Todo 子任务输入框在中文输入法（IME）下被提前提交或失焦的问题。
- 修复新增任务输入框在中文输入时被误触发 Enter / Blur 导致拼音中断的问题。
- 为新建任务和子任务输入框增加 composition 状态保护，避免中文输入过程被中断。
- 验证通过：`pnpm exec tsc -p tsconfig.app.json --noEmit`。
