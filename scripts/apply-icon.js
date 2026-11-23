/* 打包后用 rcedit 给内部 exe 应用自定义图标（electron-builder 在
   signAndEditExecutable=false 时会跳过内部 exe 的图标设置） */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cacheRoot = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign');

function findRcedit(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findRcedit(full);
      if (found) return found;
    } else if (entry.name === 'rcedit-x64.exe') {
      return full;
    }
  }
  return null;
}

const rcedit = findRcedit(cacheRoot);
if (!rcedit) {
  console.error('未找到 rcedit-x64.exe（请先运行一次 electron-builder）');
  process.exit(1);
}

const exe = path.join('dist', 'win-unpacked', 'Acoustic Guitar Studio.exe');
execFileSync(rcedit, [
  exe,
  '--set-icon', 'icon.ico',
  '--set-version-string', 'ProductName', 'Acoustic Guitar Studio',
  '--set-version-string', 'FileDescription', 'Acoustic Guitar Studio - 调音 节拍 乐谱 和弦',
  '--set-file-version', '1.0.0.0',
  '--set-version-string', 'FileVersion', '1.0.0.0',
  '--set-version-string', 'ProductVersion', '1.0.0.0',
  '--set-version-string', 'CompanyName', 'Acoustic Guitar Studio',
  '--set-version-string', 'LegalCopyright', 'MIT',
]);
console.log('图标与版本信息已写入', exe);
