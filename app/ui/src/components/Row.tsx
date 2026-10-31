import { Box, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';

import { LAYOUT } from '../theme/layout';

interface Props {
  label: string;
  hint?: string;
  children: ReactNode;
  labelWidth?: number;
}

/**
 * 设置行卡片：label 列垂直居中 + 竖向分隔线 + 控件区。
 * 一行一张卡，label 与控件天然分割，卡片间由外层 Stack 提供间距。
 */
export function Row({ label, hint, children, labelWidth = LAYOUT.labelW }: Props) {
  return (
    <Box
      p={14}
      w="100%"
      style={{
        background: 'var(--ds-surface)',
        border: '0.5px solid var(--ds-hairline)',
        borderRadius: 'calc(var(--ds-radius) * 2)',
      }}
    >
      <Group align="stretch" wrap="nowrap" gap={14}>
        <Box
          style={{
            width: labelWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <Text fz="var(--ds-fs-body)" fw={500}>{label}</Text>
          {hint && (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={4} lh={1.5}>{hint}</Text>
          )}
        </Box>
        <Box
          style={{
            width: 1,
            alignSelf: 'stretch',
            background: 'var(--ds-hairline)',
            flexShrink: 0,
          }}
        />
        <Box
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          {children}
        </Box>
      </Group>
    </Box>
  );
}
