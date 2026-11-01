import { Box, Button, Group, Text, Tooltip } from '@mantine/core';
import { IconDeviceFloppy, IconFileInfo, IconHistory, IconPuzzle } from '@tabler/icons-react';
import { useState } from 'react';

import { WorldAvatar } from '../../components/WorldAvatar';
import type { World } from '../../lib/bridge/types';
import { formatBytes, formatRelative } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';
import { ModeIcon } from '../worlds/ModeIcon';
import { WorldDetailsModal } from '../worlds/WorldDetailsModal';

export function WorldHeader({ world }: { world: World }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isScreecher = world.kind === 'screecher';
  const avatarChar = isScreecher ? 'screecher' : world.character;
  const avatarLabel = isScreecher ? '尖啸者' : world.character_label;
  const openDetails = () => setDetailsOpen(true);
  const openMods = useAppStore((state) => state.openMods);
  const backup = useAppStore((state) => state.backup);
  const pendingBackup = useAppStore((state) => state.pendingBackup);
  const activeJobId = useAppStore((state) => state.activeJobId);

  return (
    <Box px="lg" py="md" style={{ borderBottom: '1px solid var(--ds-hairline)' }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="lg">
        <Group gap={12} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
          <WorldAvatar character={avatarChar} label={avatarLabel} size={96} />
          <Box style={{ minWidth: 0 }}>
          <Group gap={7} mb={2} wrap="nowrap">
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" style={{ letterSpacing: '0.04em' }}>
              {avatarLabel}
            </Text>
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">·</Text>
            <ModeIcon mode={isScreecher ? 'screecher' : world.mode} dlc={world.dlc} size={20} color="var(--ds-accent)" />
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" tt="uppercase" style={{ letterSpacing: '0.12em' }}>
              {isScreecher ? '独立存档' : world.mode_label}
            </Text>
          </Group>

          <Group align="baseline" gap={6} wrap="nowrap">
            <Text className="ds-day" fz={46} c="var(--ds-text)">{world.day}</Text>
            <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">天</Text>
          </Group>

          <Group gap={6} mt={5} wrap="nowrap">
            <IconHistory size={14} stroke={1.8} color="var(--ds-text-faint)" />
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)">
              上次备份 {formatRelative(world.last_backup_at)}
              {' · '}
              {world.backup_count} 份
              {' · '}
              {formatBytes(world.backup_bytes)}
            </Text>
          </Group>
          </Box>
        </Group>

        <Group gap={8} wrap="nowrap" align="center">
          <Button
            variant="default"
            size="sm"
            leftSection={<IconPuzzle size={16} stroke={2} />}
            onClick={() => void openMods()}
          >
            Mods · {world.mods_count ?? 0}
          </Button>
          <Button
            variant="default"
            size="sm"
            leftSection={<IconFileInfo size={16} stroke={2} />}
            onClick={openDetails}
          >
            存档详情
          </Button>
          <Tooltip label="备份当前世界（Ctrl B）" openDelay={250}>
            <Button
              leftSection={<IconDeviceFloppy size={18} stroke={1.8} />}
              onClick={() => void backup()}
              loading={pendingBackup}
              disabled={Boolean(activeJobId)}
              size="sm"
            >
              备份此世界
            </Button>
          </Tooltip>
        </Group>
        <WorldDetailsModal opened={detailsOpen} onClose={() => setDetailsOpen(false)} />
      </Group>
    </Box>
  );
}
