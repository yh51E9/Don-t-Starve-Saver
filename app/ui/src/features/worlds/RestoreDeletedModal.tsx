import { Alert, Box, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconInfoCircle, IconRestore } from '@tabler/icons-react';

import { Tag } from '../../components/Tag';
import { WorldAvatar } from '../../components/WorldAvatar';
import type { Backup } from '../../lib/bridge/types';
import { formatBytes } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';

/** 恢复已删除的存档槽位：列出「save_id 已不属于任何当前世界」的残留快照。
 *  这些多半是删除/替换世界前的保护快照——选中后走标准恢复流程（恢复前再拍后悔药）。
 */
export function RestoreDeletedModal() {
  const open = useAppStore((state) => state.restoreDeletedOpen);
  const orphans = useAppStore((state) => state.orphans);
  const close = useAppStore((state) => state.closeRestoreDeleted);
  const openRestore = useAppStore((state) => state.openRestore);

  const pick = (backup: Backup) => {
    close();
    void openRestore(backup);
  };

  return (
    <Modal
      opened={open}
      onClose={close}
      title="恢复已删除的存档"
      size={560}
      centered
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
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" lh={1.6}>
          这里列出的是「世界已不存在」的残留快照——删除存档或恢复覆盖前自动拍的保护快照。
          选一份恢复，就能把那个世界找回来。
        </Text>

        {orphans.length === 0 && (
          <Box ta="center" py="lg">
            <IconRestore size={28} stroke={1.5} color="var(--ds-text-faint)" />
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" mt={6}>
              没有找到已删除世界的残留快照
            </Text>
          </Box>
        )}

        {orphans.map((backup) => (
          <Group
            key={backup.id}
            gap={12}
            wrap="nowrap"
            p={10}
            style={{
              borderRadius: 'var(--ds-radius)',
              border: '1px solid var(--ds-hairline)',
            }}
          >
            <WorldAvatar
              character={backup.character_id || backup.character || ''}
              label={backup.character_label || backup.character}
              size={44}
            />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group gap={8} wrap="nowrap">
                <Text fz="var(--ds-fs-meta)" fw={600} truncate>
                  {backup.character_label || backup.character || '未知角色'}
                </Text>
                <Tag tag={backup.tag} label={backup.tag_label} />
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                  原槽位 {backup.slot_id}
                </Text>
              </Group>
              <Group gap={8} wrap="nowrap">
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" className="ds-mono">
                  {backup.full_time}
                </Text>
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                  {backup.day ?? '—'} 天 · {formatBytes(backup.size_bytes)}
                </Text>
              </Group>
            </Box>
            <Button size="compact-sm" variant="default" onClick={() => pick(backup)}>
              恢复到这份
            </Button>
          </Group>
        ))}

        {orphans.length > 0 && (
          <Alert color="blue" icon={<IconInfoCircle size={16} />} p="sm">
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)">
              恢复会覆盖原槽位的当前存档，但开始前会自动拍「恢复前」保护快照——随时可以再反悔。
            </Text>
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
