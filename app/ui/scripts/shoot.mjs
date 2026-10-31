#!/usr/bin/env node
/**
 * 截图：用系统 Edge（不下载浏览器），打开发服务器或 dist。
 *   node scripts/shoot.mjs "http://localhost:5173/?mock&preset=nightfall&mode=dark" shot.png
 */
import { chromium } from 'playwright-core';

const url = process.argv[2];
const out = process.argv[3] ?? 'shot.png';
const width = Number(process.argv[4] ?? 1180);
const height = Number(process.argv[5] ?? 800);

if (!url) {
  console.error('用法: node scripts/shoot.mjs <url> <out.png> [width] [height]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
});
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1400);
await page.screenshot({ path: out });
await browser.close();

if (errors.length) {
  console.error('页面报错：');
  for (const line of errors) console.error('  ' + line);
  process.exit(1);
}
console.log('saved', out);
