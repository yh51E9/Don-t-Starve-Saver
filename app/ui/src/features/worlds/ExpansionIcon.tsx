/** 版本图标：原版 DS = 松树，巨人国 = 鹿角（官方 logo 的鹿角元素），其余沿用模式图标。 */
import {
  IconBuildingCastle,
  IconGhost,
  IconMap,
  IconMountain,
  IconSailboat,
  IconVolcano,
} from '@tabler/icons-react';

export function PineIcon({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color ?? 'currentColor'} aria-hidden>
      <path d="M12 2.5 17.2 9.2h-3.1l5 6.6h-6.1V22h-2v-6.2H4.9l5-6.6H6.8Z" />
    </svg>
  );
}

export function AntlersIcon({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* 独眼巨鹿的鹿角：中梁 + 两叉，左右对称 */}
      <path d="M12 21v-4.6" />
      <path d="M12 16.4c-2.3 0-3.8-1.2-4.7-3.1" />
      <path d="M12 16.4c2.3 0 3.8-1.2 4.7-3.1" />
      <path d="M7.3 13.3 5.1 9.6" />
      <path d="M16.7 13.3 18.9 9.6" />
      <path d="M5.1 9.6 3.9 5.4M5.1 9.6 7.6 6.2" />
      <path d="M18.9 9.6 20.1 5.4M18.9 9.6 16.4 6.2" />
    </svg>
  );
}

const MODE_ICONS: Record<string, typeof IconSailboat> = {
  shipwrecked: IconSailboat,
  porkland: IconBuildingCastle,
  cave: IconMountain,
  volcano: IconVolcano,
  adventure: IconMap,
  screecher: IconGhost,
};

export function ExpansionIcon({
  mode,
  dlc,
  size = 16,
  color,
}: {
  mode: string;
  dlc?: string[];
  size?: number;
  color?: string;
}) {
  if (mode === 'survival' || !mode) {
    // 有巨人国 DLC → 鹿角；纯原版 → 松树
    return (dlc ?? []).includes('巨人国')
      ? <AntlersIcon size={size} color={color} />
      : <PineIcon size={size} color={color} />;
  }
  const Icon = MODE_ICONS[mode] ?? IconGhost;
  return <Icon size={size} stroke={1.8} color={color} />;
}
