/* Guitar Studio - preload：仅暴露乐谱文件存储接口 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('gsDisk', {
  libraryPath: () => ipcRenderer.invoke('library:path'),
  chooseDir: () => ipcRenderer.invoke('library:chooseDir'),
  list: () => ipcRenderer.invoke('library:list'),
  create: (name, paths) => ipcRenderer.invoke('library:create', name, paths),
  createChart: (name, content) => ipcRenderer.invoke('library:createChart', name, content),
  saveChart: (folder, content) => ipcRenderer.invoke('library:saveChart', folder, content),
  addPages: (folder, paths) => ipcRenderer.invoke('library:addPages', folder, paths),
  rename: (folder, name) => ipcRenderer.invoke('library:rename', folder, name),
  remove: (folder) => ipcRenderer.invoke('library:remove', folder),
  openLibrary: () => ipcRenderer.invoke('library:open'),
  openAlbum: (folder) => ipcRenderer.invoke('library:openAlbum', folder),
  importAlbum: (name, pages) => ipcRenderer.invoke('library:importAlbum', name, pages),
  // 自制乐谱图片导出
  chartImageSavePath: (name) => ipcRenderer.invoke('chart:imageSavePath', name),
  writeChartImage: (filePath, dataUrl) => ipcRenderer.invoke('chart:writeImage', filePath, dataUrl),
  // 取得用户所选文件在磁盘上的真实路径
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (err) {
      return '';
    }
  },
});
