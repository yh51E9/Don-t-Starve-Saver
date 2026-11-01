import { Spotlight, spotlight } from '@mantine/spotlight';
import type { SpotlightActionData } from '@mantine/spotlight';
import {
  IconBolt,
  IconBoltOff,
  IconDeviceFloppy,
  IconFolderOpen,
  IconSearch,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';

import { useAppStore } from '../../lib/store/useAppStore';
import { WorldAvatar } from '../../components/WorldAvatar';

export function AppSpotlight() {
  const worlds = useAppStore((state) => state.worlds);
  const autoOn = useAppStore((state) => state.autoOn);
  const setView = useAppStore((state) => state.setView);
  const selectWorld = useAppStore((state) => state.selectWorld);
  const backup = useAppStore((state) => state.backup);
  const cleanup = useAppStore((state) => state.cleanup);
  const toggleAuto = useAppStore((state) => state.toggleAuto);
  const reveal = useAppStore((state) => state.reveal);

  const actions = useMemo<SpotlightActionData[]>(() => [
    ...worlds.map((world) => ({
      id: `world-${world.id}`,
      label: `${world.character_label} · ${world.mode_label}`,
      description: `${world.day} 天 · ${world.backup_count} 份备份`,
      leftSection: <WorldAvatar character={world.character} label={world.character_label} size={28} />,
      onClick: () => {
        setView('worlds');
        void selectWorld(world.id);
      },
    })),
    {
      id: 'backup-current',
      group: '操作',
      label: '备份当前世界',
      description: '给选中的世界拍一份快照',
      leftSection: <IconDeviceFloppy size={18} />,
      onClick: () => {
        setView('worlds');
        void backup();
      },
    },
    {
      id: 'cleanup',
      group: '操作',
      label: '清理超限备份',
      description: '按保留份数裁掉最旧的',
      leftSection: <IconTrash size={18} />,
      onClick: () => void cleanup(),
    },
    {
      id: 'toggle-auto',
      group: '操作',
      label: autoOn ? '关闭自动备份' : '开启自动备份',
      leftSection: autoOn ? <IconBoltOff size={18} /> : <IconBolt size={18} />,
      onClick: () => void toggleAuto(),
    },
    {
      id: 'open-backup-root',
      group: '操作',
      label: '打开备份目录',
      leftSection: <IconFolderOpen size={18} />,
      onClick: () => void reveal('backup_root'),
    },
    {
      id: 'settings',
      group: '导航',
      label: '打开设置',
      leftSection: <IconSettings size={18} />,
      onClick: () => setView('settings'),
    },
  ], [worlds, autoOn, setView, selectWorld, backup, cleanup, toggleAuto, reveal]);

  useEffect(() => {
    // 按键统一走 lib/shortcuts 的全局分发（键位可改），这里只保留命令面板入口
    const open = () => spotlight.open();
    window.addEventListener('ds:spotlight', open);
    return () => {
      window.removeEventListener('ds:spotlight', open);
    };
  }, []);

  return (
    <Spotlight
      actions={actions}
      nothingFound="没有匹配的世界或命令"
      highlightQuery
      searchProps={{
        leftSection: <IconSearch size={18} stroke={1.8} />,
        placeholder: '搜索世界，或输入命令…  Ctrl F',
        size: 'md',
      }}
      limit={8}
    />
  );
}
