import { Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function StatRow({ icon, label, value, mono = false }: Props) {
  return (
    <Group justify="space-between" gap={8} wrap="nowrap">
      <Group gap={6} wrap="nowrap">
        {icon}
        <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">{label}</Text>
      </Group>
      <Text fz="var(--ds-fs-meta)" className={mono ? 'ds-mono' : undefined} c="var(--ds-text)">
        {value}
      </Text>
    </Group>
  );
}
