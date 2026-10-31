import { Box, Text } from '@mantine/core';
import type { ComponentType, ReactNode } from 'react';

interface Props {
  icon: ComponentType<{ size?: number; stroke?: number; color?: string }>;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, hint, action, compact = false }: Props) {
  return (
    <Box ta="center" pt={compact ? 28 : 64} px="lg">
      <Icon size={compact ? 34 : 44} stroke={1.2} color="var(--ds-text-faint)" />
      <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)" mt={10}>{title}</Text>
      {hint && (
        <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" mt={4} lh={1.5}>{hint}</Text>
      )}
      {action && <Box mt="sm">{action}</Box>}
    </Box>
  );
}
