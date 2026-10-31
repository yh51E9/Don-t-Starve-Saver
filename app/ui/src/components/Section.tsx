import { Box, Divider, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  right?: ReactNode;
  divider?: boolean;
  children?: ReactNode;
  /** md：设置页大标题版式（图标胶囊 + 留白分组，不用分隔线） */
  size?: 'sm' | 'md';
}

export function Section({ icon, title, right, divider = true, children, size = 'sm' }: Props) {
  const isMd = size === 'md';
  // 设置页不画横线：分组感由图标胶囊 + 段间留白 + 卡片边框共同承担
  const showRule = divider && !isMd;
  return (
    <Box style={{ marginBottom: isMd ? 22 : 12 }}>
      <Group justify="space-between" gap={7} mb={isMd ? 10 : 6} wrap="nowrap">
        <Group gap={isMd ? 10 : 7} wrap="nowrap">
          {icon && isMd ? (
            <Box
              style={{
                width: 26,
                height: 26,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--ds-accent) 12%, var(--ds-surface))',
              }}
            >
              {icon}
            </Box>
          ) : (
            icon
          )}
          <Text
            className="ds-section"
            fz={isMd ? 'var(--ds-fs-body)' : undefined}
            fw={isMd ? 600 : undefined}
          >
            {title}
          </Text>
        </Group>
        {right}
      </Group>
      {showRule && <Divider className="ds-section-rule" color="var(--ds-hairline)" mb={2} />}
      {children}
    </Box>
  );
}
