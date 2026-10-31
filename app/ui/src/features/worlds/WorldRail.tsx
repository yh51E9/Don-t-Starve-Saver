import { AppShell, Box, Button, Collapse, Flex, Group, Menu, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconArchive,
  IconArchiveOff,
  IconBoxMultiple,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconDatabase,
  IconFlame,
  IconGhost,
  IconListDetails,
  IconRefresh,
  IconWorld,
} from '@tabler/icons-react';
import { useMemo, useState } from 'react';

import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../lib/store/useAppStore';
import { formatBytes } from '../../lib/format';
import type { World } from '../../lib/bridge/types';
import { WorldCard } from './WorldCard';

type WorldSort = 'slot' | 'day' | 'backup';
type GroupKey = 'slot' | 'screecher' | 'other';

const SORT_KEY = 'ds:world_sort';
const GROUPS_KEY = 'ds:rail_groups';

const SORT_ITEMS: Array<{ value: WorldSort; label: string; icon: typeof IconListDetails }> = [
  { value: 'slot', label: '默认槽位序', icon: IconListDetails },
  { value: 'day', label: '天数最多在前', icon: IconFlame },
  { value: 'backup', label: '最近备份在前', icon: IconClock },
];

const GROUPS: Array<{ key: GroupKey; label: string; icon: typeof IconWorld }> = [
  { key: 'slot', label: '世界', icon: IconWorld },
  { key: 'screecher', label: '尖啸者', icon: IconGhost },
  { key: 'other', label: '其他', icon: IconBoxMultiple },
];

function loadSort(): WorldSort {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return SORT_ITEMS.some((item) => item.value === saved) ? (saved as WorldSort) : 'slot';
  } catch {
    return 'slot';
  }
}

/** 折叠状态：默认只展开「世界」，其余记住上次（localStorage） */
function loadGroups(): Record<GroupKey, boolean> {
  const base: Record<GroupKey, boolean> = { slot: true, screecher: false, other: false };
  try {
    const saved = localStorage.getItem(GROUPS_KEY);
    return saved ? { ...base, ...(JSON.parse(saved) as Partial<Record<GroupKey, boolean>>) } : base;
  } catch {
    return base;
  }
}

export function WorldRail() {
  const worlds = useAppStore((state) => state.worlds);
  const stats = useAppStore((state) => state.stats);
  const selectedSlot = useAppStore((state) => state.selectedSlot);
  const selectWorld = useAppStore((state) => state.selectWorld);
  const refreshData = useAppStore((state) => state.refreshData);
  const setView = useAppStore((state) => state.setView);
  const [sort, setSort] = useState<WorldSort>(loadSort);
  const [open, setOpen] = useState<Record<GroupKey, boolean>>(loadGroups);

  const grouped = useMemo(() => {
    const bySort = (list: World[]) => {
      if (sort === 'day') return [...list].sort((a, b) => (b.day ?? 0) - (a.day ?? 0));
      if (sort === 'backup') {
        const stamp = (world: World) => (world.last_backup_at ? Date.parse(world.last_backup_at) : 0);
        return [...list].sort((a, b) => stamp(b) - stamp(a));
      }
      return list;
    };
    const pick = (kind: GroupKey) => bySort(worlds.filter((world) => (world.kind ?? 'slot') === kind));
    return { slot: pick('slot'), screecher: pick('screecher'), other: pick('other') };
  }, [worlds, sort]);

  const pickSort = (value: WorldSort) => {
    setSort(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {
      /* 忽略 */
    }
  };

  const toggleGroup = (key: GroupKey) => {
    const next = { ...open, [key]: !open[key] };
    setOpen(next);
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
  };

  const SortIcon = SORT_ITEMS.find((item) => item.value === sort)?.icon ?? IconListDetails;

  const renderCard = (world: World) => (
    <WorldCard
      key={world.id}
      world={world}
      active={world.id === selectedSlot}
      onClick={() => { setView('worlds'); void selectWorld(world.id); }}
    />
  );

  return (
    <AppShell.Navbar className="ds-rail" p={0}>
      <Flex direction="column" h="100%">
        <Group justify="space-between" px="md" pt="md" pb={6} wrap="nowrap">
          <Group gap={7} wrap="nowrap">
            <IconArchive size={22} stroke={2.2} color="var(--ds-text-faint)" />
            <Text className="ds-section" fz="var(--ds-fs-body)" fw={600}>
              存档 · {worlds.length}
            </Text>
          </Group>
          <Group gap={2} wrap="nowrap">
            <Menu position="bottom-end" withinPortal shadow="md">
              <Menu.Target>
                <Button
                  variant="default"
                  size="xs"
                  px={8}
                  leftSection={<SortIcon size={14} stroke={2} />}
                  rightSection={<IconChevronDown size={12} stroke={2} />}
                >
                  排序
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>排序方式</Menu.Label>
                {SORT_ITEMS.map((item) => (
                  <Menu.Item
                    key={item.value}
                    leftSection={<item.icon size={14} stroke={1.8} />}
                    rightSection={sort === item.value ? <IconCheck size={14} stroke={2} /> : null}
                    onClick={() => pickSort(item.value)}
                  >
                    {item.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <Button
              variant="default"
              size="xs"
              px={8}
              leftSection={<IconRefresh size={14} stroke={2} />}
              onClick={() => void refreshData()}
            >
              刷新
            </Button>
          </Group>
        </Group>

        <ScrollArea
          style={{ flex: 1 }}
          px={8}
          pb={8}
          offsetScrollbars
          scrollbarSize={8}
          styles={{ thumb: { background: 'var(--ds-hairline)' } }}
        >
          {GROUPS.map(({ key, label, icon: GroupIcon }) => {
            const list = grouped[key];
            if (list.length === 0) return null; // 空组不渲染（"其他"平时就不出现）
            const isOpen = open[key];
            return (
              <Box key={key} mb={6}>
                <UnstyledButton
                  onClick={() => toggleGroup(key)}
                  w="100%"
                  px={8}
                  py={6}
                  style={{ borderRadius: 'var(--ds-radius)', color: 'var(--ds-text-dim)' }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap={7} wrap="nowrap">
                      <GroupIcon size={20} stroke={2} color="var(--ds-text-faint)" />
                      <Text fz="var(--ds-fs-meta)" fw={600}>{label}</Text>
                      <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono">
                        {list.length}
                      </Text>
                    </Group>
                    <IconChevronDown
                      size={14}
                      stroke={2}
                      style={{
                        transform: isOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform var(--ds-t-fast) ease',
                      }}
                    />
                  </Group>
                </UnstyledButton>
                <Collapse expanded={isOpen}>
                  <Stack gap={2} pt={2}>
                    {list.map(renderCard)}
                  </Stack>
                </Collapse>
              </Box>
            );
          })}

          {worlds.length === 0 && (
            <EmptyState
              compact
              icon={IconArchiveOff}
              title="没有找到世界"
              hint="检查顶部的存档目录是否正确"
            />
          )}
        </ScrollArea>

        <Box px="md" py={9} style={{ borderTop: '1px solid var(--ds-hairline)' }}>
          <Group gap={12} wrap="nowrap">
            <Group gap={5} wrap="nowrap" title={`共 ${stats.count} 份备份`}>
              <IconArchive size={13} stroke={1.8} color="var(--ds-text-faint)" />
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" style={{ whiteSpace: 'nowrap' }}>
                {stats.count} 份
              </Text>
            </Group>
            <Group gap={5} wrap="nowrap" title={`共 ${formatBytes(stats.total_bytes)}`}>
              <IconDatabase size={13} stroke={1.8} color="var(--ds-text-faint)" />
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" style={{ whiteSpace: 'nowrap' }}>
                {formatBytes(stats.total_bytes)}
              </Text>
            </Group>
          </Group>
        </Box>

      </Flex>
    </AppShell.Navbar>
  );
}
