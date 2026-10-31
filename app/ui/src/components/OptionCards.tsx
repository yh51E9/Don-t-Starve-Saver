import { Box, Group, Radio, Stack, Text } from '@mantine/core';

import type { ReactNode } from 'react';

export interface OptionCardItem<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

/**
 * 卡片式单选组：图标 + 标题 + 一句说明，横排自适应换行。
 * 全设置的"档位类"选项（明暗/字号/触发方式/保留策略/关闭行为）统一用它。
 */
export function OptionCards<T extends string | number>({
  value,
  onChange,
  items,
  minChildWidth = 150,
}: {
  value: T;
  onChange: (next: T) => void;
  items: OptionCardItem<T>[];
  minChildWidth?: number;
}) {
  return (
    <Radio.Group
      value={String(value)}
      onChange={(next) => {
        const found = items.find((item) => String(item.value) === next);
        if (found) onChange(found.value);
      }}
    >
      <Group gap={8} wrap="wrap" w="100%" align="stretch">
        {items.map((item) => {
          const active = String(item.value) === String(value);
          return (
            <Radio.Card
              key={String(item.value)}
              value={String(item.value)}
              className="ds-option-card"
              data-active={active}
              p={10}
              style={{ flex: `1 1 ${minChildWidth}px`, minWidth: minChildWidth - 20, height: '100%' }}
            >
              <Group wrap="nowrap" gap={8} align="flex-start">
                <Radio.Indicator mt={2} />
                <Box style={{ minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    {item.icon}
                    <Text fz="var(--ds-fs-body)" fw={500} truncate>{item.label}</Text>
                  </Group>
                  {item.hint && (
                    <Text
                      fz="var(--ds-fs-micro)"
                      c="var(--ds-text-faint)"
                      mt={2}
                      lh={1.45}
                      style={{ minHeight: '2.9em' }}  // 统一占两行高：跨字号档位卡片等高
                    >
                      {item.hint}
                    </Text>
                  )}
                </Box>
              </Group>
            </Radio.Card>
          );
        })}
      </Group>
    </Radio.Group>
  );
}

/** 说明块：卡片内选项下方的补充文案（统一注释样式） */
export function OptionNote({ children }: { children: ReactNode }) {
  return (
    <Stack gap={0}>
      {children}
    </Stack>
  );
}
