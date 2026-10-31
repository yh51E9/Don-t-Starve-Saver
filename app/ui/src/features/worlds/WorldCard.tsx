import { Box, Group, Menu, Text } from '@mantine/core';
import {
  IconArrowBackUp,
  IconFolderSymlink,
  IconHistory,
  IconPhotoUp,
  IconPhotoShield,
  IconTrash,
  IconTrashX,
} from '@tabler/icons-react';

import { WorldAvatar } from '../../components/WorldAvatar';
import type { World } from '../../lib/bridge/types';
import { formatRelative } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';
import { ModeIcon } from './ModeIcon';
import { getBridge } from '../../lib/bridge/api';

interface Props {
  world: World;
  active: boolean;
  onClick: () => void;
}

export function WorldCard({ world, active, onClick }: Props) {
  const backupSlot = useAppStore((state) => state.backupSlot);
  const restoreLatest = useAppStore((state) => state.restoreLatest);
  const reveal = useAppStore((state) => state.reveal);
  const openDeleteBackups = useAppStore((state) => state.openDeleteBackups);
  const openDeleteSave = useAppStore((state) => state.openDeleteSave);
  const startAvatarUpload = useAppStore((state) => state.startAvatarUpload);
  const startAvatarPicker = useAppStore((state) => state.startAvatarPicker);
  const hasBackups = world.backup_count > 0;
  const isScreecher = world.kind === 'screecher';
  // 尖啸者是 Klei 官方总转换 mod：用官方 screencher 怪物图当头像
  const title = isScreecher ? '尖啸者' : world.character_label;

  return (
    <Menu withinPortal>
      <Menu.Divider />
      {/* 右键目标：Mantine 会自己挡掉浏览器原生菜单 */}
      <Menu.ContextMenu>
        <button
          type="button"
          className="ds-rail-card"
          data-active={active}
          onClick={onClick}
          title={world.last_backup_at ? `上次备份：${formatRelative(world.last_backup_at)}` : '还没有备份'}
        >
          <Group gap={12} wrap="nowrap" align="center">
            <WorldAvatar
              character={isScreecher ? 'screecher' : world.character}
              label={title}
              size={56}
            />

            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group justify="space-between" gap={6} wrap="nowrap" align="baseline">
                <Text fz="var(--ds-fs-body)" fw={600} truncate>{title}</Text>
                <Group gap={3} wrap="nowrap" align="baseline">
                  <Text className="ds-mono" fz="var(--ds-fs-title)" fw={700} c="var(--ds-text)" lh={1}>
                    {world.day}
                  </Text>
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">天</Text>
                </Group>
              </Group>

              {/* 第二行只说三件事：哪类存档 / 什么模式 / 备份几份 */}
              <Group justify="space-between" gap={8} wrap="nowrap" mt={6}>
                <Group gap={5} wrap="nowrap" style={{ minWidth: 0 }}>
                  <ModeIcon mode={isScreecher ? 'screecher' : world.mode} dlc={world.dlc} size={18} color="var(--ds-text-faint)" />
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" truncate>
                    {isScreecher ? '独立存档' : `槽位 ${world.id} · ${world.mode_label}`}
                  </Text>
                </Group>
                <Text
                  fz="var(--ds-fs-micro)"
                  c={hasBackups ? 'var(--ds-text-dim)' : 'var(--ds-text-faint)'}
                  className="ds-mono"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {hasBackups ? `${world.backup_count} 份` : '无备份'}
                </Text>
              </Group>
            </Box>
          </Group>
        </button>
      </Menu.ContextMenu>

      <Menu.Dropdown>
      <Menu.Label>头像</Menu.Label>
      <Menu.Item
        leftSection={<IconPhotoShield size={16} stroke={1.8} />}
        onClick={() => startAvatarPicker(world.character)}
      >
        更新存档头像…
      </Menu.Item>
      <Menu.Item
        leftSection={<IconPhotoUp size={16} stroke={1.8} />}
        onClick={() => void startAvatarUpload(world.character, false)}
      >
        上传本地图片…
      </Menu.Item>
      <Menu.Item
        leftSection={<IconPhotoShield size={16} stroke={1.8} />}
        onClick={() => {
          void getBridge()
            .then((bridge) => bridge.imageDelete('avatars', world.character))
            .then(() => useAppStore.getState().refreshAvatars());
        }}
      >
        恢复官方头像
      </Menu.Item>
        <Menu.Item
          leftSection={<IconArrowBackUp size={18} stroke={1.8} />}
          onClick={() => void backupSlot(world.id)}
        >
          备份此世界
        </Menu.Item>
        <Menu.Item
          leftSection={<IconHistory size={18} stroke={1.8} />}
          disabled={!hasBackups}
          onClick={() => void restoreLatest(world.id)}
        >
          恢复最近备份
        </Menu.Item>
        <Menu.Item
          leftSection={<IconFolderSymlink size={18} stroke={1.8} />}
          onClick={() => void reveal('save_dir')}
        >
          打开存档目录
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconTrash size={18} stroke={1.8} />}
          disabled={!hasBackups}
          onClick={() => openDeleteBackups(world.id)}
        >
          删除所有备份…
        </Menu.Item>
        <Menu.Item
          leftSection={<IconTrashX size={18} stroke={1.8} />}
          c="var(--ds-danger)"
          onClick={() => void openDeleteSave(world.id)}
        >
          删除存档…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
