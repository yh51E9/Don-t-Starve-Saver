#!/usr/bin/env node
/**
 * 设计令牌门禁：禁止再用写死的 px 字号，禁止 Mantine 的 light 变体。
 * 挂在 predev / prebuild，违反即 exit 1。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath 会正确解码 %20 之类的编码字符——目录名带空格时 pathname 直取会炸
const ROOT = fileURLToPath(new URL('../src', import.meta.url));
const RULES = [
  { name: '写死的 px 字号', pattern: /size="\d+(?:\.\d+)?px"/g },
  { name: 'ActionIcon 的 light 变体', pattern: /<ActionIcon[\s\S]{0,300}?variant="light"/g },
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(tsx|ts|css)$/.test(entry)) files.push(full);
  }
  return files;
}

const failures = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  for (const rule of RULES) {
    const matches = text.match(rule.pattern);
    if (matches) failures.push({ file, rule: rule.name, count: matches.length });
  }
}

if (failures.length) {
  console.error('\n设计令牌检查未通过：');
  for (const item of failures) {
    console.error(`  ${item.file.replace(ROOT, 'src')}  ${item.rule} ×${item.count}`);
  }
  console.error('');
  process.exit(1);
}

console.log('设计令牌检查通过：没有写死的 px 字号，也没有 variant="light"');
