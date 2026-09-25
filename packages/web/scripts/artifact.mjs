// 把 vite build 的輸出合成單一檔案 dist/artifact.html，用來發布成可以直接開的網頁。
// 發布平台會自己包上 <!doctype>、<head>、<body>，所以這裡只寫頁面內容，CSS 與 JS 全部內嵌。

import { readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const index = readFileSync(new URL('index.html', dist), 'utf8');
const asset = (pattern) => {
  const match = index.match(pattern);
  if (!match) throw new Error(`dist/index.html 裡找不到 ${pattern}`);
  return readFileSync(new URL(match[1].replace(/^\//, ''), dist), 'utf8');
};
const js = asset(/<script type="module" crossorigin src="([^"]+)"/).replaceAll('</script', '<\\/script');
const css = asset(/<link rel="stylesheet" crossorigin href="([^"]+)"/);
const fonts = index.match(/<link\s+rel="stylesheet"\s+href="(https:\/\/fonts\.googleapis\.com[^"]+)"/)[1];

const html = `<title>卡牌試玩桌</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
writeFileSync(new URL('artifact.html', dist), html);
console.log(`dist/artifact.html：${(html.length / 1024).toFixed(0)} KB`);
