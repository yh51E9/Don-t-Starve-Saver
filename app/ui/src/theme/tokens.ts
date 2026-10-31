import type { ThemePreset } from '../lib/bridge/types';

export interface SchemeTokens {
  bg: string;
  bgSunken: string;
  surface: string;
  surfaceHover: string;
  hairline: string;
  hairlineStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  /** 状态灯：正常（绿） */
  success: string;
  /** 状态灯：注意/过渡（黄） */
  warning: string;
  /** 来源标记色相：青蓝（游戏关闭）/ 紫（定时）/ 玫红（导入） */
  info: string;
  violet: string;
  rose: string;
  focus: string;
}

export interface FontStack {
  body: string;
  display: string;
  mono: string;
  headingWeight: string;
  headingTracking: string;
}

export interface Preset {
  key: ThemePreset;
  label: string;
  blurb: string;
  radius: string;
  fonts: FontStack;
  light: SchemeTokens;
  dark: SchemeTokens;
}
