// node:sqlite 在 Node 22 還標著「實驗中」，每次開伺服器都印一行 ExperimentalWarning。只把這一種藏起來，其他警告照常印。
// 要在載入 node:sqlite 之前 import（main.ts、admin.ts 的第一行）。
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.warn(`${warning.name}: ${warning.message}`);
});
