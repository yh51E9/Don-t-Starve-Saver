import { Box, Collapse, Group, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconWorld } from '@tabler/icons-react';
import { useState } from 'react';

import type { BackupWorld } from '../lib/bridge/types';
import { formatBytes } from '../lib/format';
import { ModeIcon } from '../features/worlds/ModeIcon';

/** 世界序号：实心小方块（不用带圈数字，小字号会糊） */
function NumChip({ value }: { value: number }) {
  return (
    <Box
      style={{
        minWidth: 20,
        height: 18,
        padding: '0 5px',
        borderRadius: 5,
        border: '0.5px solid var(--ds-hairline-strong)',
        background: 'var(--ds-surface-hover)',
        display: 'inline-grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      <Text fz="var(--ds-fs-micro)" fw={700} className="ds-mono" c="var(--ds-text-dim)" lh={1}>
        {value}
      </Text>
    </Box>
  );
}

function WorldRow({
  world,
  chain,
  showIndex,
}: {
  world: BackupWorld;
  chain: string[];
  showIndex: boolean;
}) {
  return (
    <Group
      gap={8}
      wrap="nowrap"
      py={5}
      px={4}
      style={{ borderTop: '0.5px solid var(--ds-hairline)' }}
    >
      <Box
        style={{
          width: 24,
          height: 24,
          flex: 'none',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 7,
          background: 'var(--ds-surface-hover)',
        }}
      >
        <ModeIcon mode={world.type} dlc={chain} size={15} color="var(--ds-text-dim)" />
      </Box>

      <Group gap={6} wrap="nowrap" style={{ flex: 'none' }}>
        <Text fz="var(--ds-fs-meta)" fw={500}>{world.label}</Text>
        {showIndex && <NumChip value={world.index} />}
      </Group>

      <Text
        fz="var(--ds-fs-micro)"
        c="var(--ds-text-faint)"
        className="ds-mono"
        truncate
        title={world.file}
        style={{ flex: 1, minWidth: 0 }}
      >
        {world.file}
      </Text>

      <Text
        fz="var(--ds-fs-micro)"
        c="var(--ds-text-dim)"
        className="ds-mono"
        style={{ flex: 'none', textAlign: 'right' }}
      >
        {world.day != null ? `${world.day} 天` : '—'}
        <Text span c="var(--ds-text-faint)"> · </Text>
        {formatBytes(world.size_bytes)}
      </Text>
    </Group>
  );
}

/** 世界列表（备份详情 / 存档详情共用）：默认折叠，标题与其它折叠区同构。 */
export function WorldList({
  worlds,
  ungenerated,
  chain,
  defaultOpen = false,
  loading = false,
}: {
  worlds: BackupWorld[];
  ungenerated: string[];
  chain: string[];
  defaultOpen?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box>
      <Group
        gap={6}
        wrap="nowrap"
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {open
          ? <IconChevronDown size={14} stroke={1.8} color="var(--ds-text-faint)" />
          : <IconChevronRight size={14} stroke={1.8} color="var(--ds-text-faint)" />}
        <IconWorld size={15} stroke={1.8} color="var(--ds-text-dim)" />
        <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
          世界{worlds.length > 0 ? `（${worlds.length}）` : ''}
        </Text>
      </Group>
      <Collapse expanded={open}>
        <Box pt="sm">
          {loading ? (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" px={4}>正在读取…</Text>
          ) : worlds.length === 0 ? (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" px={4}>
              没有世界文件
            </Text>
          ) : (
            worlds.map((world) => (
              <WorldRow
                key={world.file}
                world={world}
                chain={chain}
                showIndex={worlds.filter((item) => item.type === world.type).length > 1}
              />
            ))
          )}
          {!loading && ungenerated.length > 0 && (
            <Group gap={6} wrap="nowrap" px={4} py={6} style={{ borderTop: '0.5px solid var(--ds-hairline)' }}>
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                未生成：{ungenerated.join('、')}
              </Text>
            </Group>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
