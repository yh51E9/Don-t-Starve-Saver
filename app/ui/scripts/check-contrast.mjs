#!/usr/bin/env node
/**
 * 对比度门禁：每套主题 × 明暗，逐对检查 WCAG 比值。
 * 挂了就 exit 1，predev / prebuild 都会跑。
 *
 * 依赖 Node 原生 TS 类型剥离（Node 22.18+ / 24 默认开启）。
 */
import { PRESET_LIST } from '../src/theme/presets/index.ts';

const PAIRS = [
  ['text', 'bg', 7.0],
  ['text', 'surface', 7.0],
  ['text', 'surfaceHover', 7.0],
  ['textDim', 'bg', 4.5],
  ['textDim', 'surface', 4.5],
  ['textFaint', 'bg', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['onAccent', 'accent', 4.5],
  ['onAccent', 'accentHover', 4.5],
  ['onAccent', 'accentActive', 4.5],
  ['danger', 'bg', 4.5],
  ['onDanger', 'danger', 4.5],
  // 状态灯（6px 图形指示）按 WCAG 1.4.11 非文本 3:1 校验；头灯坐在 bg-sunken 上
  ['success', 'bg', 3.0],
  ['success', 'bgSunken', 3.0],
  ['warning', 'bg', 3.0],
  ['warning', 'bgSunken', 3.0],
  // 来源标记色（图标/描边用）同按非文本 3:1
  ['info', 'bg', 3.0],
  ['info', 'surface', 3.0],
  ['violet', 'bg', 3.0],
  ['violet', 'surface', 3.0],
  ['rose', 'bg', 3.0],
  ['rose', 'surface', 3.0],
  ['hairlineStrong', 'bg', 3.0],
  ['focus', 'bg', 3.0],
];

function channels(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

const failures = [];
let checks = 0;

for (const preset of PRESET_LIST) {
  for (const scheme of ['light', 'dark']) {
    const tokens = preset[scheme];
    for (const [fg, bg, minimum] of PAIRS) {
      checks += 1;
      const value = contrast(tokens[fg], tokens[bg]);
      if (value + 1e-9 < minimum) {
        failures.push({
          preset: preset.key,
          scheme,
          pair: `${fg}/${bg}`,
          value: value.toFixed(2),
          minimum,
          colors: `${tokens[fg]} on ${tokens[bg]}`,
        });
      }
    }
  }
}

if (failures.length) {
  console.error(`\n对比度检查未通过：${failures.length} / ${checks}\n`);
  for (const item of failures) {
    console.error(
      `  ${item.preset.padEnd(10)} ${item.scheme.padEnd(5)} ${item.pair.padEnd(26)} ` +
      `${item.value} < ${item.minimum}   ${item.colors}`,
    );
  }
  console.error('');
  process.exit(1);
}

console.log(`对比度检查通过：${PRESET_LIST.length} 套主题 × 2 种明暗 × ${PAIRS.length} 组 = ${checks} 项`);
