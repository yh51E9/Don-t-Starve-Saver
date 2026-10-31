import { ActionIcon, Box, Button, Collapse, Group, Modal, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileInfo,
  IconFingerprint,
  IconFolderSymlink,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { ModsList } from '../../components/ModsList';
import { WorldAvatar } from '../../components/WorldAvatar';
import { WorldList } from '../../components/WorldList';
import { formatBytes, formatRelative } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';
import { ModeIcon } from '../worlds/ModeIcon';

function when(epoch: number | null): { relative: string; absolute: string } {
  if (!epoch) return { relative: '未知', absolute: '' };
  const date = new Date(epoch * 1000);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const time = date.toTimeString().slice(0, 8);
  return { relative: formatRelative(iso), absolute: `${iso} ${time}` };
}

/** 信息格：标签在上、值在下，与备份详情同构 */
function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mb={4} style={{ letterSpacing: '0.06em' }}>
        {label}
      </Text>
      {children}
    </Box>
  );
}

export function WorldDetailsModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const details = useAppStore((state) => state.details);
  const toggleDetails = useAppStore((state) => state.toggleDetails);
  const openMods = useAppStore((state) => state.openMods);
  const selectedSlot = useAppStore((state) => state.selectedSlot);
  const copyToClipboard = useAppStore((state) => state.copyToClipboard);
  const reveal = useAppStore((state) => state.reveal);
  const owner = useAppStore((state) => state.worlds.find((world) => world.id === state.selectedSlot) ?? null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  const lastPlayed = details ? when(details.last_played_at) : null;
  const isScreecher = details?.kind === 'screecher';
  const avatarKey = isScreecher ? 'screecher' : (details?.character ?? '');
  const displayName = isScreecher ? '尖啸者' : (details?.character_label ?? '');
  const worldLabel = isScreecher ? '尖啸者（独立存档）' : (details?.mode_label ?? '未知');
  const compat = details?.compatibility;

  useEffect(() => {
    if (opened && selectedSlot) void toggleDetails(selectedSlot);
  }, [opened, selectedSlot, toggleDetails]);

  useEffect(() => {
    setFilesOpen(false);
    setTechOpen(false);
  }, [selectedSlot, opened]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group justify="space-between" wrap="nowrap" gap={10} style={{ flex: 1 }}>
          <Text fz="var(--ds-fs-body)" fw={600}>存档详情</Text>
          <Tooltip label="打开存档目录" openDelay={200}>
            <ActionIcon variant="default" size="md" onClick={() => void reveal('save_dir')}>
              <IconFolderSymlink size={16} stroke={1.8} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
      size={640}
      styles={{
        content: {
          background: 'var(--ds-surface)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100dvh - 64px)',
        },
        header: { flexShrink: 0 },
        body: { overflowY: 'auto', minHeight: 0 },
      }}
    >
      {!details ? (
        <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" ta="center" py="lg">
          没有选中的世界
        </Text>
      ) : (
        <Stack gap="md" data-autofocus tabIndex={-1}>
          {/* Hero：谁、哪个世界、多少天 */}
          <Box
            p={14}
            style={{
              borderRadius: 'calc(var(--ds-radius) * 2)',
              border: '0.5px solid var(--ds-hairline)',
              background: 'var(--ds-bg-sunken)',
            }}
          >
            <Group gap={14} wrap="nowrap" align="flex-start">
              <WorldAvatar character={avatarKey} label={displayName} size={56} />
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text fz="var(--ds-fs-title)" fw={600} truncate>{displayName}</Text>
                <Group gap={6} wrap="nowrap" mt={6} align="center">
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                    世界 {worldLabel} · 槽位 {details.id}
                  </Text>
                </Group>
              </Box>
              <Box style={{ textAlign: 'right', flex: 'none' }}>
                <Group gap={4} wrap="nowrap" align="baseline" justify="flex-end">
                  <Text fz={34} fw={700} lh={1} className="ds-mono">{details.day}</Text>
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">天</Text>
                </Group>
                {lastPlayed?.relative && (
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={4}>
                    最后游玩 {lastPlayed.relative}
                  </Text>
                )}
              </Box>
            </Group>
          </Box>

          {/* 信息栅格 */}
          <SimpleGrid cols={2} spacing="md" verticalSpacing="sm">
            <InfoCell label="兼容性">
              <Group gap={6} wrap="nowrap">
                <Box
                  px={8}
                  py={2}
                  style={{
                    borderRadius: 6,
                    border: '0.5px solid var(--ds-accent)',
                    color: 'var(--ds-accent)',
                  }}
                >
                  <Text fz="var(--ds-fs-micro)" fw={600}>{compat?.primary ?? worldLabel}</Text>
                </Box>
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" truncate>
                  {compat
                    ? (compat.primary === '原版' ? '不依赖 DLC' : `需 ${compat.requires.join(' + ') || '无'}`)
                    : '读取中…'}
                </Text>
              </Group>
            </InfoCell>

            <InfoCell label="当前世界">
              <Group gap={6} wrap="nowrap">
                <ModeIcon mode={isScreecher ? 'screecher' : details.mode} dlc={details.dlc} size={16} color="var(--ds-text-dim)" />
                <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" truncate>{worldLabel}</Text>
              </Group>
            </InfoCell>

            <InfoCell label="季节">
              <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" title="季节存在世界文件内部（KLEI 压缩格式），后续版本解析">
                暂未解析
              </Text>
            </InfoCell>

            <InfoCell label="最后游玩">
              <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" className="ds-mono">
                {lastPlayed?.absolute || '未知'}
              </Text>
            </InfoCell>

            <InfoCell label="存档大小">
              <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" className="ds-mono">
                {formatBytes(details.total_bytes)} · {details.files.length} 个文件
              </Text>
            </InfoCell>

            <InfoCell label="Mod 数">
              <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" className="ds-mono">
                {details.mods_count ?? 0} 个
              </Text>
            </InfoCell>

            <InfoCell label="备份">
              <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" className="ds-mono">
                {owner?.backup_count ?? 0} 份
                {owner?.backup_bytes ? ` · ${formatBytes(owner.backup_bytes)}` : ''}
              </Text>
            </InfoCell>
          </SimpleGrid>

          <WorldList
            worlds={details.worlds ?? []}
            ungenerated={details.ungenerated ?? []}
            chain={details.compatibility?.chain ?? []}
          />

          <ModsList
            mods={details.mods}
            mods_count={details.mods_count}
            onViewMods={() => { onClose(); openMods(); }}
          />

          {/* 存档文件：世界文件已在上面；没有零碎文件就不占一行 */}
          {(details.other_files ?? []).length > 0 && (
          <Box>
            <Group
              gap={6}
              wrap="nowrap"
              onClick={() => setFilesOpen(!filesOpen)}
              style={{ cursor: 'pointer' }}
              w="100%"
            >
              {filesOpen
                ? <IconChevronDown size={14} stroke={1.8} color="var(--ds-text-faint)" />
                : <IconChevronRight size={14} stroke={1.8} color="var(--ds-text-faint)" />}
              <IconFileInfo size={15} stroke={1.8} color="var(--ds-text-dim)" />
              <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
                存档文件（{details.other_files?.length ?? 0}）
              </Text>
            </Group>
            <Collapse expanded={filesOpen}>
              <Stack gap={4} pt="sm">
                {(details.other_files ?? []).length === 0 ? (
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">没有额外文件</Text>
                ) : (
                  details.other_files.map((file) => (
                    <Group key={file.name} justify="space-between" wrap="nowrap" gap={6}>
                      <Text fz="var(--ds-fs-micro)" className="ds-mono" c="var(--ds-text-dim)" truncate>
                        {file.name}
                      </Text>
                      <Text fz="var(--ds-fs-micro)" className="ds-mono" c="var(--ds-text-faint)">
                        {formatBytes(file.size_bytes)}
                      </Text>
                    </Group>
                  ))
                )}
              </Stack>
            </Collapse>
          </Box>
          )}

          {/* 存档标识：save_id 收纳 */}
          {details.save_id && (
            <Box>
              <Group gap={6} wrap="nowrap" onClick={() => setTechOpen(!techOpen)} style={{ cursor: 'pointer' }}>
                {techOpen
                  ? <IconChevronDown size={14} stroke={1.8} color="var(--ds-text-faint)" />
                  : <IconChevronRight size={14} stroke={1.8} color="var(--ds-text-faint)" />}
                <IconFingerprint size={15} stroke={1.8} color="var(--ds-text-dim)" />
                <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">存档标识</Text>
              </Group>
              <Collapse expanded={techOpen}>
                <Group gap={8} wrap="nowrap" pt="sm" align="center">
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" truncate style={{ flex: 1 }}>
                    save_id: {details.save_id}
                  </Text>
                  <Button
                    variant="default"
                    size="compact-xs"
                    leftSection={<IconCopy size={13} stroke={1.8} />}
                    onClick={() => void copyToClipboard(details.save_id, 'save_id')}
                  >
                    复制
                  </Button>
                </Group>
              </Collapse>
            </Box>
          )}
        </Stack>
      )}
    </Modal>
  );
}
