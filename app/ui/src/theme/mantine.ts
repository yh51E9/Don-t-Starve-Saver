import { createTheme } from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';

import type { ColorScheme } from '../lib/bridge/types';
import type { Preset } from './tokens';

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mix(from: string, to: string, ratio: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * ratio,
    a[1] + (b[1] - a[1]) * ratio,
    a[2] + (b[2] - a[2]) * ratio,
  ]);
}

/**
 * Mantine 的 primaryColor 必须是 10 阶元组。
 * 前段从底色渐变到强调色，后半段向黑压，锚点强制等于 accent——
 * 这样 Button/Badge/Loader 拿到的就是主题里那个准确的颜色。
 */
export function accentRamp(preset: Preset, scheme: ColorScheme): MantineColorsTuple {
  const tokens = preset[scheme];
  const anchor = scheme === 'light' ? 6 : 4;
  const ramp = Array.from({ length: 10 }, (_, index) =>
    mix(tokens.bg, tokens.accent, Math.max(0.22, ((index + 1) / 10) * 0.95)));
  for (let index = anchor + 1; index < 10; index += 1) {
    ramp[index] = mix(tokens.accent, '#000000', ((index - anchor) / (9 - anchor)) * 0.34);
  }
  ramp[anchor] = tokens.accent;
  return ramp as unknown as MantineColorsTuple;
}

export function buildTheme(preset: Preset, scheme: ColorScheme) {
  const tokens = preset[scheme];
  return createTheme({
    primaryColor: 'accent',
    primaryShade: { light: 6, dark: 4 },
    colors: { accent: accentRamp(preset, scheme) },
    fontFamily: preset.fonts.body,
    fontFamilyMonospace: preset.fonts.mono,
    headings: {
      fontFamily: preset.fonts.display,
      fontWeight: preset.fonts.headingWeight,
      sizes: {
        h1: { fontSize: '24px', lineHeight: '1.2' },
        h2: { fontSize: '20px', lineHeight: '1.25' },
        h3: { fontSize: '18px', lineHeight: '1.3' },
        h4: { fontSize: '16px', lineHeight: '1.35' },
        h5: { fontSize: '14px', lineHeight: '1.4' },
        h6: { fontSize: '13px', lineHeight: '1.4' },
      },
    },
    defaultRadius: preset.radius,
    radius: {
      xs: '1px',
      sm: preset.radius,
      md: preset.radius,
      lg: `calc(${preset.radius} * 2)`,
      xl: `calc(${preset.radius} * 3)`,
    },
    spacing: {
      // 全部整数 px：小数间距会让 1px 边框落在半像素上
      xs: '6px',
      sm: '10px',
      md: '14px',
      lg: '19px',
      xl: '29px',
    },
    fontSizes: {
      // 字号走我们自己的四档 token（整数 px），Mantine 的 xs/sm/md/lg 全部跟随
      xs: 'var(--ds-fs-micro)',
      sm: 'var(--ds-fs-meta)',
      md: 'var(--ds-fs-body)',
      lg: 'var(--ds-fs-title)',
      xl: 'var(--ds-fs-title)',
    },
    cursorType: 'pointer',
    respectReducedMotion: true,
    components: {
      Button: { defaultProps: { radius: preset.radius } },
      ActionIcon: { defaultProps: { radius: preset.radius, variant: 'subtle' } },
      Paper: { defaultProps: { radius: preset.radius } },
      Card: { defaultProps: { radius: preset.radius, withBorder: true } },
      Badge: { defaultProps: { radius: preset.radius } },
      TextInput: { defaultProps: { radius: preset.radius } },
      NumberInput: { defaultProps: { radius: preset.radius } },
      Select: { defaultProps: { radius: preset.radius, checkIconPosition: 'right' } },
      Tooltip: { defaultProps: { withArrow: true, openDelay: 260, radius: preset.radius } },
      Modal: {
        defaultProps: {
          radius: preset.radius,
          centered: true,
          overlayProps: { blur: 2 },
          // 全局统一弹层过渡：一处生效，所有 Modal/确认框
          transitionProps: { transition: 'pop', duration: 180, timingFunction: 'ease' },
        },
      },
      SegmentedControl: { defaultProps: { radius: preset.radius } },
      Switch: { defaultProps: { size: 'sm' } },
      Text: { defaultProps: { lineHeight: 1.45 } },
    },
    other: { preset: preset.key, tokens, radius: preset.radius },
  });
}
