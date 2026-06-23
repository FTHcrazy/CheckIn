const { execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

// 设置环境变量
process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';

try {
  console.log('=== Step 1: TypeScript 编译 ===');
  execSync('npx tsc -b', { stdio: 'inherit', cwd: root });

  console.log('\n=== Step 2: Vite 构建 ===');
  execSync('npx vite build', { stdio: 'inherit', cwd: root });

  console.log('\n=== Step 3: Electron Builder (--dir) ===');
  execSync('npx electron-builder --dir', { stdio: 'inherit', cwd: root });

  console.log('\n=== 构建完成! ===');
} catch (err) {
  console.error('构建失败:', err.message);
  process.exit(1);
}
