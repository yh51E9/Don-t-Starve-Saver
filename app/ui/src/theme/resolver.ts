import type { CSSVariablesResolver } from '@mantine/core';

import { LAYOUT } from './layout';
import type { Preset, SchemeTokens } from './tokens';

/**
 * 字号比例表：滑杆 14–22px 共 9 档，其中 15–19 五档在此手工调校，
 * 其余档位由 scaleFor 的公式兜底。每档都是整数 px——
 * 小数 px 会让 WebView2 做亚像素渲染，小字全部发虚，这是"字糊"的根因。
 */
const FONT_SCALES: Record<number, { micro: number; meta: number; body: number; title: number }> = {
  15: { micro: 12, meta: 13, body: 15, title: 17 },
  16: { micro: 12, meta: 13, body: 16, title: 17 },
  17: { micro: 13, meta: 14, body: 16, title: 18 },
  18: { micro: 13, meta: 14, body: 17, title: 19 },
  19: { micro: 14, meta: 15, body: 17, title: 20 },
};

/** 9 档取值：命中 FONT_SCALES（15–19 有调校表）用调校值，其余档位同比例公式兜底。 */
function scaleFor(fontSize: number): { micro: number; meta: number; body: number; title: number } {
  return FONT_SCALES[fontSize] ?? {
    micro: Math.max(11, fontSize - 4),
    meta: Math.max(12, fontSize - 3),
    body: fontSize - 1,
    title: fontSize + 1,
  };
}

/**
 * 列宽缩放系数：以 17px 标准字号为 1.0，跟随 micro 档（表格单元格内容的主力字号）。
 * 列宽在存储里始终是「17px 基准 px」，渲染时乘这个系数；钳制 ≥1，
 * 小字号不缩——基准列宽是按 17px 调好的，缩小反而会让表头挤成两行。
 */
export function colScale(fontSize: number): number {
  return Math.max(1, scaleFor(fontSize).micro / scaleFor(17).micro);
}

function schemeVars(tokens: SchemeTokens): Record<string, string> {
  return {
    '--ds-bg': tokens.bg,
    '--ds-bg-sunken': tokens.bgSunken,
    '--ds-surface': tokens.surface,
    '--ds-surface-hover': tokens.surfaceHover,
    '--ds-hairline': tokens.hairline,
    '--ds-hairline-strong': tokens.hairlineStrong,
    '--ds-text': tokens.text,
    '--ds-text-dim': tokens.textDim,
    '--ds-text-faint': tokens.textFaint,
    '--ds-accent': tokens.accent,
    '--ds-accent-hover': tokens.accentHover,
    '--ds-accent-active': tokens.accentActive,
    '--ds-on-accent': tokens.onAccent,
    '--ds-danger': tokens.danger,
    '--ds-on-danger': tokens.onDanger,
    '--ds-success': tokens.success,
    '--ds-warning': tokens.warning,
    '--ds-info': tokens.info,
    '--ds-violet': tokens.violet,
    '--ds-rose': tokens.rose,
    '--ds-focus': tokens.focus,

    // 映射 Mantine 自己的语义变量，内置组件就不用逐个覆盖样式
    '--mantine-color-body': tokens.bg,
    '--mantine-color-text': tokens.text,
    '--mantine-color-dimmed': tokens.textDim,
    '--mantine-color-placeholder': tokens.textFaint,
    '--mantine-color-default-border': tokens.hairline,
    '--mantine-color-default': tokens.surface,
    '--mantine-color-default-hover': tokens.surfaceHover,
    '--mantine-color-anchor': tokens.accent,
    '--mantine-color-error': tokens.danger,
    '--mantine-color-dark-8': tokens.bgSunken,
    '--mantine-color-dark-7': tokens.bg,
    '--mantine-color-dark-6': tokens.surface,
    '--mantine-color-dark-5': tokens.surfaceHover,
    '--mantine-color-dark-4': tokens.hairlineStrong,
    '--mantine-color-dark-3': tokens.textFaint,
    '--mantine-color-dark-2': tokens.textDim,
    '--mantine-color-dark-1': tokens.text,
    '--mantine-color-dark-0': tokens.text,
  };
}

export function buildResolver(preset: Preset, fontSize = 17): CSSVariablesResolver {
  const scale = scaleFor(fontSize);
  return () => ({
    variables: {
      '--ds-radius': preset.radius,
      '--ds-font-body': preset.fonts.body,
      '--ds-font-display': preset.fonts.display,
      '--ds-font-mono': preset.fonts.mono,
      '--ds-heading-track': preset.fonts.headingTracking,

      // 四档字号：所有文字只能从这四个里取（整数 px，见 FONT_SCALES）
      '--ds-fs-micro': `${scale.micro}px`,
      '--ds-fs-meta': `${scale.meta}px`,
      '--ds-fs-body': `${scale.body}px`,
      '--ds-fs-title': `${scale.title}px`,

      // 三档图标
      '--ds-icon-sm': '14px',
      '--ds-icon-md': '18px',
      '--ds-icon-lg': '22px',

      // 两档过渡时长：克制丝滑（尊重 prefers-reduced-motion）
      '--ds-t-fast': '120ms',
      '--ds-t-med': '180ms',

      // 布局唯一来源
      '--ds-header-h': `${LAYOUT.headerH}px`,
      '--ds-rail-w': `${LAYOUT.railW}px`,
      '--ds-aside-w': `${LAYOUT.asideW}px`,
      '--ds-row-h': `${LAYOUT.rowH}px`,
    },
    light: schemeVars(preset.light),
    dark: schemeVars(preset.dark),
  });
}
