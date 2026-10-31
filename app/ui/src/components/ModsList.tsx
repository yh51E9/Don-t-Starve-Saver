import { Box, Button, Collapse, Group, HoverCard, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPuzzle } from '@tabler/icons-react';
import { useState } from 'react';

import { shortModId } from '../lib/clipboard';
import { getBridge } from '../lib/bridge/api';
import { ModIcon } from './ModIcon';
import type { ModInfo } from '../lib/bridge/types';

function ModHoverRow({ mod }: { mod: ModInfo }) {
  const [preview, setPreview] = useState<string | null>(null);
  const label = mod.resolved ? mod.name : shortModId(mod.id);

  const loadPreview = () => {
    if (preview !== null || !mod.icon) return;
    getBridge()
      .then((bridge) => bridge.modiconPreview(mod.id))
      .then((result) => setPreview(result.url || ''))
      .catch(() => setPreview(''));
  };

  return (
    <HoverCard position="left" withArrow openDelay={200} shadow="md" onOpen={loadPreview}>
      <HoverCard.Target>
        <Group gap={10} wrap="nowrap" px={4} py={3} style={{ borderRadius: 6, cursor: 'default' }}>
          <ModIcon icon={mod.icon} name={label} seed={mod.id} size={26} />
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fz="var(--ds-fs-meta)" c={mod.resolved ? 'var(--ds-text)' : 'var(--ds-text-faint)'} truncate>
              {label}
            </Text>
            {mod.resolved && mod.author && (
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">作者 {mod.author}</Text>
            )}
          </Box>
        </Group>
      </HoverCard.Target>
      <HoverCard.Dropdown p={10} style={{ maxWidth: 320 }}>
        {mod.icon && (
          <img
            src={preview || mod.icon}
            alt={label}
            style={{
              display: 'block',
              borderRadius: 10,
              marginBottom: 8,
              maxWidth: 200,
              maxHeight: 200,
              width: 'auto',
              height: 'auto',
            }}
          />
        )}
        <Text fz="var(--ds-fs-meta)" fw={500}>{mod.resolved ? mod.name : '未解析'}</Text>
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono">
          {shortModId(mod.id)}
        </Text>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export function ModsList({ mods, mods_count, onViewMods, defaultOpen }: { mods: ModInfo[]; mods_count: number; onViewMods?: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? mods_count <= 5);

  return (
    <Box>
      <Group
        gap={6}
        wrap="nowrap"
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
        w="100%"
        bg="transparent"
        p={0}
        justify="space-between"
      >
        <Group gap={6} wrap="nowrap">
          {open
            ? <IconChevronDown size={14} stroke={1.8} color="var(--ds-text-faint)" />
            : <IconChevronRight size={14} stroke={1.8} color="var(--ds-text-faint)" />}
          <IconPuzzle size={15} stroke={1.8} color="var(--ds-text-dim)" />
          <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
            Mods（{mods_count}）
          </Text>
        </Group>
        <Group gap={6} wrap="nowrap">
          {mods.some((mod) => !mod.resolved) && (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
              已解析 {mods.filter((mod) => mod.resolved).length}
            </Text>
          )}
          {onViewMods && (
            <Button variant="default" size="compact-xs" onClick={onViewMods}>
              在 Mod 管理中查看
            </Button>
          )}
        </Group>
      </Group>
      <Collapse expanded={open}>
        <Stack gap={6} pt="sm">
          {mods.length === 0 ? (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">这个槽位没有启用 mod</Text>
          ) : (
            <>
              {mods.map((mod) => (
                <ModHoverRow key={mod.id} mod={mod} />
              ))}
            </>
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}

