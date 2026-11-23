/* Guitar Studio - Electron 主进程 */
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// 用户数据固定到 LocalAppData：Roaming 在部分受管环境不可写，
// 且便携版从临时目录运行，默认路径会导致 IndexedDB 无法持久化
const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
app.setPath('userData', path.join(localAppData, 'GuitarStudio'));

let mainWindow = null;

/* ---------------- 乐谱库：本地文件夹存储 ---------------- */

const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;
const PDF_EXT = /\.pdf$/i;

const DEFAULT_LIBRARY_DIR = path.join(app.getPath('documents'), '吉他乐谱库');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {};
  } catch (err) {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...patch }, null, 2), 'utf8');
  } catch (err) {
    console.warn('保存设置失败', err);
  }
}

// 乐谱库位置：优先使用用户在设置里选定的文件夹，否则用「文档 / 吉他乐谱库」
function libraryDir() {
  const custom = readSettings().libraryDir;
  return typeof custom === 'string' && custom.trim() ? custom : DEFAULT_LIBRARY_DIR;
}

async function ensureLibrary() {
  const dir = libraryDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

// 去掉 Windows 文件名非法字符，避免创建文件夹失败
function safeName(name, fallback = '乐谱') {
  let base = String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  base = base.replace(/^\.+|\.+$/g, '').trim();
  if (!base) base = fallback;
  return base.slice(0, 80);
}

async function uniqueFolder(base) {
  const dir = await ensureLibrary();
  let name = base;
  let i = 2;
  while (fs.existsSync(path.join(dir, name))) name = `${base} (${i++})`;
  return name;
}

function pageKind(fileName) {
  if (PDF_EXT.test(fileName)) return 'pdf';
  if (IMAGE_EXT.test(fileName)) return 'image';
  return null;
}

// 复制文件到图集文件夹，同名时自动追加序号
async function copyInto(folderAbs, sources) {
  const added = [];
  for (const src of sources) {
    try {
      if (!src || !fs.existsSync(src)) continue;
      const ext = path.extname(src);
      const stem = safeName(path.basename(src, ext), '乐谱');
      let target = `${stem}${ext}`;
      let i = 2;
      while (fs.existsSync(path.join(folderAbs, target))) target = `${stem} (${i++})${ext}`;
      await fsp.copyFile(src, path.join(folderAbs, target));
      added.push(target);
    } catch (err) {
      console.warn('复制乐谱失败', src, err);
    }
  }
  return added;
}

const CHART_FILE = 'chart.json';

async function readAlbum(folderName) {
  const dir = await ensureLibrary();
  const folderAbs = path.join(dir, folderName);
  const stat = await fsp.stat(folderAbs);
  const entries = (await fsp.readdir(folderAbs, { withFileTypes: true })).filter(
    (e) => e.isFile() && pageKind(e.name)
  );
  const pages = [];
  for (const entry of entries) {
    const full = path.join(folderAbs, entry.name);
    const st = await fsp.stat(full);
    pages.push({
      name: entry.name,
      kind: pageKind(entry.name),
      size: st.size,
      mtime: st.mtimeMs,
      path: full,
    });
  }
  pages.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));

  // 自制乐谱：文件夹内带 chart.json
  let chart = null;
  try {
    chart = JSON.parse(await fsp.readFile(path.join(folderAbs, CHART_FILE), 'utf8'));
  } catch (err) {
    chart = null;
  }
  const chartUpdated = chart && Number(chart.updated) ? Number(chart.updated) : 0;
  const updated = Math.max(stat.mtimeMs, chartUpdated, ...pages.map((p) => p.mtime));
  if (chart) {
    return {
      name: folderName,
      folder: folderName,
      type: 'chart',
      pages,
      chart: {
        version: Number(chart.version) || 1,
        kind: chart.kind === 'tab' ? 'tab' : 'chord',
        meta: chart.meta && typeof chart.meta === 'object' ? chart.meta : null,
        measures: Array.isArray(chart.measures) ? chart.measures : null,
        content: String(chart.content || ''),
        updated: chartUpdated,
      },
      updated,
      added: stat.birthtimeMs || stat.mtimeMs,
    };
  }
  if (!pages.length) return null;
  return {
    name: folderName,
    folder: folderName,
    pages,
    updated,
    added: stat.birthtimeMs || stat.mtimeMs,
  };
}

async function listAlbums() {
  const dir = await ensureLibrary();
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
  const albums = [];
  for (const entry of entries) {
    try {
      const album = await readAlbum(entry.name);
      if (album) albums.push(album);
    } catch (err) {
      console.warn('读取图集失败', entry.name, err);
    }
  }
  return albums;
}

function registerLibraryIpc() {
  ipcMain.handle('library:path', () => libraryDir());

  // 选择自定义乐谱库文件夹
  ipcMain.handle('library:chooseDir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择乐谱库文件夹',
      defaultPath: libraryDir(),
      buttonLabel: '使用此文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const dir = res.filePaths[0];
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (err) {
      return { ok: false, error: err.message };
    }
    writeSettings({ libraryDir: dir });
    return { ok: true, dir, default: false };
  });

  ipcMain.handle('library:list', () => listAlbums());

  ipcMain.handle('library:create', async (_e, name, sources) => {
    try {
      const base = safeName(name);
      const folder = await uniqueFolder(base);
      const dir = await ensureLibrary();
      const folderAbs = path.join(dir, folder);
      await fsp.mkdir(folderAbs, { recursive: true });
      const added = await copyInto(folderAbs, Array.isArray(sources) ? sources : []);
      if (!added.length) {
        await fsp.rm(folderAbs, { recursive: true, force: true });
        return { ok: false, error: '没有可导入文件（无法获取文件路径）。' };
      }
      return { ok: true, folder };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('library:createChart', async (_e, name, payload) => {
    try {
      const base = safeName(name, '自制乐谱');
      const folder = await uniqueFolder(base);
      const dir = await ensureLibrary();
      const folderAbs = path.join(dir, folder);
      await fsp.mkdir(folderAbs, { recursive: true });
      await fsp.writeFile(
        path.join(folderAbs, CHART_FILE),
        JSON.stringify({ ...(payload || {}), updated: Date.now() }, null, 2),
        'utf8'
      );
      return { ok: true, folder };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('library:saveChart', async (_e, folder, payload) => {
    try {
      const dir = await ensureLibrary();
      const folderAbs = path.join(dir, safeName(folder));
      if (!fs.existsSync(folderAbs)) return { ok: false, error: '乐谱不存在' };
      await fsp.writeFile(
        path.join(folderAbs, CHART_FILE),
        JSON.stringify({ ...(payload || {}), updated: Date.now() }, null, 2),
        'utf8'
      );
      const now = new Date();
      await fsp.utimes(folderAbs, now, now);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('library:addPages', async (_e, folder, sources) => {
    try {
      const dir = await ensureLibrary();
      const folderAbs = path.join(dir, safeName(folder));
      if (!fs.existsSync(folderAbs)) return { ok: false, error: '图集不存在' };
      const added = await copyInto(folderAbs, Array.isArray(sources) ? sources : []);
      if (!added.length) return { ok: false, error: '没有可导入文件（无法获取文件路径）。' };
      const now = new Date();
      await fsp.utimes(folderAbs, now, now);
      return { ok: true, added };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('library:rename', async (_e, folder, newName) => {
    try {
      const dir = await ensureLibrary();
      const from = path.join(dir, folder);
      const base = safeName(newName);
      if (!fs.existsSync(from)) return { ok: false, error: '图集不存在' };
      if (base === folder) return { ok: true, folder };
      const to = path.join(dir, base);
      if (fs.existsSync(to)) return { ok: false, error: `已存在同名图集「${base}」` };
      await fsp.rename(from, to);
      const now = new Date();
      await fsp.utimes(to, now, now);
      return { ok: true, folder: base };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('library:remove', async (_e, folder) => {
    try {
      const dir = await ensureLibrary();
      await fsp.rm(path.join(dir, folder), { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('library:open', async () => {
    const dir = await ensureLibrary();
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('library:openAlbum', async (_e, folder) => {
    const dir = await ensureLibrary();
    await shell.openPath(path.join(dir, folder));
    return true;
  });

  // 迁移旧版 IndexedDB 数据时使用：直接写入文件内容
  ipcMain.handle('library:importAlbum', async (_e, name, pages) => {
    try {
      const base = safeName(name);
      const folder = await uniqueFolder(base);
      const dir = await ensureLibrary();
      const folderAbs = path.join(dir, folder);
      await fsp.mkdir(folderAbs, { recursive: true });
      for (const page of Array.isArray(pages) ? pages : []) {
        const fileName = safeName(page.name, '乐谱');
        await fsp.writeFile(path.join(folderAbs, fileName), Buffer.from(page.buffer));
      }
      return { ok: true, folder };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 自制乐谱：选择图片导出位置
  ipcMain.handle('chart:imageSavePath', async (_e, defaultName) => {
    try {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const base = safeName(
        String(defaultName || '自制乐谱').replace(/\.(png|jpe?g)$/i, ''),
        '自制乐谱'
      );
      const res = await dialog.showSaveDialog(win, {
        title: '导出乐谱图片',
        defaultPath: path.join(app.getPath('pictures'), base + '.png'),
        filters: [
          { name: 'PNG 图片', extensions: ['png'] },
          { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
        ],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      return { ok: true, filePath: res.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 自制乐谱：把渲染好的 dataURL 写入磁盘
  ipcMain.handle('chart:writeImage', async (_e, filePath, dataUrl) => {
    try {
      const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl || ''));
      if (!match) return { ok: false, error: '图片数据无效' };
      const target = String(filePath || '');
      if (!target) return { ok: false, error: '保存路径为空' };
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, Buffer.from(match[2], 'base64'));
      return { ok: true, filePath: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'Acoustic Guitar Studio · 吉他练习台',
    backgroundColor: '#0a0c11',
    webPreferences: {
      // 通过 preload 暴露最小化的文件存储能力，渲染进程不直接接触 Node
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 启用 Chromium 内置 PDF 阅读器，否则乐谱库里的 PDF 页会显示空白
      plugins: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerLibraryIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
