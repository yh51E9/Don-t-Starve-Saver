import type { ThemePreset } from '../../lib/bridge/types';
import type { Preset } from '../tokens';
import { brass } from './brass.ts';
import { ledger } from './ledger.ts';
import { nightfall } from './nightfall.ts';

export const PRESETS: Record<ThemePreset, Preset> = { ledger, nightfall, brass };

/** 默认顺序：夜航最中性，放第一个 */
export const PRESET_LIST: Preset[] = [nightfall, ledger, brass];

export function getPreset(key: string | undefined): Preset {
  return PRESETS[(key ?? 'nightfall') as ThemePreset] ?? nightfall;
}
