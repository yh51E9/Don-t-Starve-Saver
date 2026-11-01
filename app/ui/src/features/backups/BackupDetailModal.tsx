import { ActionIcon, Alert, Box, Button, Collapse, Group, Modal, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileInfo,
  IconFingerprint,
  IconFolderSymlink,
  IconHistory,
  IconPuzzle,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { ModsList } from '../../components/ModsList';
import { WorldList } from '../../components/WorldList';
import { Tag } from '../../components/Tag';
import { WorldAvatar } from '../../components/WorldAvatar';
import { getBridge } from '../../lib/bridge/api';
import type { Backup, BackupOverview, ModInfo } from '../../lib/bridge/types';
import { formatAgoCompact, formatBytes } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';
import { ModeIcon } from '../worlds/ModeIcon';

/** 世界序号：实心小方块，不用带圈数字（圈字在小字号下糊） */
/** 信息格：标签在上、值在下 */
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

/** 备份详情：版本归属 + 世界列表 + 当时的 Mods + 技术信息。 */
export function BackupDetailModal({
  backup,
  onClose,
}: {
  backup: Backup | null;
  onClose: () => void;
}) {
  const copyToClipboard = useAppStore((state) => state.copyToClipboard);
  const loadAvatars = useAppStore((state) => state.loadAvatars);
  const worlds = useAppStore((state) => state.worlds);
  const openRestore = useAppStore((state) => state.openRestore);
  const openDelete = useAppStore((state) => state.openDelete);
  const reveal = useAppStore((state) => state.reveal);
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [techOpen, setTechOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [mods, setMods] = useState<ModInfo[] | null>(null);
  const [modsOpen, setModsOpen] = useState(false);

  const backupId = backup?.id ?? null;

  useEffect(() => {
    setTechOpen(false);
    setFilesOpen(false);
    setModsOpen(false);
    setMods(null);
    setOverview(null);
  }, [backupId]);

  // 世界列表 / 兼容性：一次读全（本地文件，几毫秒）
  useEffect(() => {
    if (!backupId) return;
    let alive = true;
    getBridge()
      .then((bridge) => bridge.backupOverview(backupId))
      .then((result) => {
        if (alive) setOverview(result);
      })
      .catch(() => {
        if (alive) setOverview(null);
      });
    return () => {
      alive = false;
    };
  }, [backupId]);

  const isScreecher = backup?.slot_id === 'screecher';
  const avatarKey = isScreecher ? 'screecher' : (backup?.character_id || backup?.character || '');
  const displayName = isScreecher
    ? '尖啸者'
    : (backup?.character_label || backup?.character || '');
  useEffect(() => {
    if (avatarKey) void loadAvatars([avatarKey]);
  }, [avatarKey, loadAvatars]);

  useEffect(() => {
    if (!modsOpen || !backupId) return;
    setMods(null);
    getBridge()
      .then((bridge) => bridge.backupMods(backupId))
      .then((result) => setMods(result.mods))
      .catch(() => setMods([]));
  }, [modsOpen, backupId]);

  if (!backup) return null;

  const owner = worlds.find((world) => world.id === backup.slot_id);
  const delta = backup.day != null && owner ? backup.day - owner.day : null;
  const compat = overview?.compatibility;
  const worldLabel = owner?.kind === 'screecher' ? '尖啸者（独立存档）' : (owner?.mode_label ?? backup.mode ?? '未知');
  // 这份备份是否属于槽位的“上一个世界”（删除/恢复前的保护快照，与当前世界不同源）
  const staleWorld = Boolean(backup.save_id && owner?.save_id && backup.save_id !== owner.save_id);

  return (
    <Modal
      opened={backup !== null}
      onClose={onClose}
      title={
        <Group justify="space-between" wrap="nowrap" gap={10} style={{ flex: 1 }}>
          <Text fz="var(--ds-fs-body)" fw={600}>备份详情</Text>
          <Group gap={6} wrap="nowrap">
            <Tooltip label="打开备份目录" openDelay={200}>
              <ActionIcon
                variant="default"
                size="md"
                onClick={() => void reveal('backup', backup.id)}
              >
                <IconFolderSymlink size={16} stroke={1.8} />
              </ActionIcon>
            </Tooltip>
            <Button
              size="compact-sm"
              leftSection={<IconHistory size={14} stroke={1.9} />}
              onClick={() => {
                onClose();
                void openRestore(backup);
              }}
            >
              恢复到这份
            </Button>
            <Tooltip label="删除这份备份（不可撤销）" openDelay={200}>
              <Button
                size="compact-sm"
                color="red"
                variant="light"
                leftSection={<IconTrash size={14} stroke={1.9} />}
                onClick={() => {
                  onClose();
                  openDelete(backup);
                }}
              >
                删除
              </Button>
            </Tooltip>
          </Group>
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
      <Stack gap="md" data-autofocus tabIndex={-1}>
        {/* Hero：这局是谁、什么时候、多少天 */}
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
              <Group gap={8} wrap="nowrap" align="center">
                <Text fz="var(--ds-fs-title)" fw={600} className="ds-mono">{backup.full_time}</Text>
                <Tag tag={backup.tag} />
              </Group>
              <Group gap={6} wrap="nowrap" mt={6} align="center">
                <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">{displayName}</Text>
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">·</Text>
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                  世界 {worldLabel} · 槽位 {backup.slot_id}
                </Text>
              </Group>
            </Box>
            <Box style={{ textAlign: 'right', flex: 'none' }}>
              <Group gap={4} wrap="nowrap" align="baseline" justify="flex-end">
                <Text fz={34} fw={700} lh={1} className="ds-mono">{backup.day ?? '—'}</Text>
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">天</Text>
              </Group>
              {delta !== null && delta !== 0 && (
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={4}>
                  比当前{delta > 0 ? '多' : '少'} {Math.abs(delta)} 天
                </Text>
              )}
            </Box>
          </Group>
        </Box>

        {/* 上一个世界的快照：跟当前世界不同源，先说清楚免得误以为数据错乱 */}
        {staleWorld && (
          <Alert color="yellow" icon={<IconHistory size={16} stroke={1.8} />} p="sm">
            <Text fz="var(--ds-fs-micro)" lh={1.6}>
              这份备份是槽位 {backup.slot_id} <strong>上一个世界</strong>（{displayName}）的快照，
              不是当前世界（{owner?.character_label}）的——属于删除/恢复前自动拍的保护快照。
              「恢复到这份」会把存档换回{displayName}那个世界。
            </Text>
          </Alert>
        )}

        {/* 信息栅格：把表格的字段全部收进来，两列分区 */}
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
                <Text fz="var(--ds-fs-micro)" fw={600}>
                  {compat?.primary ?? worldLabel}
                </Text>
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
              <ModeIcon mode={owner?.kind === 'screecher' ? 'screecher' : (owner?.mode ?? backup.mode)} dlc={owner?.dlc} size={16} color="var(--ds-text-dim)" />
              <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" truncate>{worldLabel}</Text>
            </Group>
          </InfoCell>

          <InfoCell label="距今">
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" className="ds-mono" title={backup.full_time}>
              {formatAgoCompact(backup.full_time)}
            </Text>
          </InfoCell>

          <InfoCell label="Mod 数">
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" className="ds-mono">
              {backup.mods_count ?? 0} 个
            </Text>
          </InfoCell>

          <InfoCell label="存档大小">
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" className="ds-mono">
              {overview ? `${formatBytes(overview.total_bytes)} · ${overview.file_count} 个文件` : '读取中…'}
            </Text>
          </InfoCell>

          <InfoCell label="季节">
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" title="季节存在世界文件内部（KLEI 压缩格式），后续版本解析">
              暂未解析
            </Text>
          </InfoCell>

          <InfoCell label="备注">
            <Text fz="var(--ds-fs-meta)" c={backup.note ? 'var(--ds-text-dim)' : 'var(--ds-text-faint)'}>
              {backup.note || '—'}
            </Text>
          </InfoCell>
        </SimpleGrid>

        <WorldList
          worlds={overview?.worlds ?? []}
          ungenerated={overview?.ungenerated ?? []}
          chain={overview?.compatibility.chain ?? []}
          loading={!overview}
        />

        {/* Mods：折叠，头部带数量 */}
        {modsOpen ? (
          !mods ? (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">正在读取…</Text>
          ) : mods.length === 0 ? (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">这份备份没有启用 mod</Text>
          ) : (
            <ModsList mods={mods} mods_count={backup.mods_count} defaultOpen />
          )
        ) : (
          <Group gap={6} wrap="nowrap" onClick={() => setModsOpen(true)} style={{ cursor: 'pointer' }}>
            <IconChevronRight size={14} stroke={1.8} color="var(--ds-text-faint)" />
            <IconPuzzle size={15} stroke={1.8} color="var(--ds-text-dim)" />
            <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">Mods（{backup.mods_count}）</Text>
          </Group>
        )}

        {/* 存档文件：世界文件已在上面，这里只放索引等零碎 */}
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
              存档文件（{overview?.other_files.length ?? 0}）
            </Text>
          </Group>
          <Collapse expanded={filesOpen}>
            <Stack gap={4} pt="sm">
              {!overview ? (
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">正在读取…</Text>
              ) : overview.other_files.length === 0 ? (
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">没有额外文件</Text>
              ) : (
                overview.other_files.map((file) => (
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

        {/* 技术信息：save_id 收纳在这里，不再抢主视线 */}
        {backup.save_id && (
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
                  save_id: {backup.save_id}
                </Text>
                <Button
                  variant="default"
                  size="compact-xs"
                  leftSection={<IconCopy size={13} stroke={1.8} />}
                  onClick={() => void copyToClipboard(backup.save_id, 'save_id')}
                >
                  复制
                </Button>
              </Group>
            </Collapse>
          </Box>
        )}

      </Stack>
    </Modal>
  );
}
