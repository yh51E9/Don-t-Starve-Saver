import { Avatar, Text } from '@mantine/core';

import { initialOf } from '../lib/format';
import { useAppStore } from '../lib/store/useAppStore';

type Size = 24 | 28 | 40 | 44 | 46 | 56 | 72 | 96 | 128;

const SIZE_FZ: Record<Size, string> = {
  24: 'var(--ds-fs-meta)',
  28: 'var(--ds-fs-meta)',
  40: 'var(--ds-fs-body)',
  44: 'var(--ds-fs-body)',
  46: 'var(--ds-fs-body)',
  56: 'var(--ds-fs-title)',
  72: 'var(--ds-fs-display, 28px)',
  96: 'var(--ds-fs-display, 34px)',
  128: 'var(--ds-fs-display, 42px)',
};

interface Props {
  character: string;
  label: string;
  size?: Size;
}

export function WorldAvatar({ character, label, size = 40 }: Props) {
  // 旧的 saveindex 里可能写 wmaxwell，游戏素材是 waxwell
  const key = character === 'wmaxwell' ? 'waxwell' : character;
  const src = useAppStore((state) => state.avatars[key]);

  if (src) {
    return (
      <Avatar
        size={size}
        radius="sm"
        src={src}
        alt={label}
        style={{
          backgroundColor: 'var(--ds-surface)',
          border: '1px solid var(--ds-hairline)',
        }}
      />
    );
  }

  return (
    <Avatar
      size={size}
      radius="sm"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--ds-accent) 16%, var(--ds-surface))',
        color: 'var(--ds-accent)',
      }}
    >
      <Text fz={SIZE_FZ[size]} fw={600} c="var(--ds-accent)">
        {initialOf(label)}
      </Text>
    </Avatar>
  );
}
