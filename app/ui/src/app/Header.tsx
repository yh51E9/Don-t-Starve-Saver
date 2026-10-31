import { Button, Group, Menu, Text } from '@mantine/core';
import {
  IconCheck,
  IconChevronDown,
  IconFolderOpen,
  IconListDetails,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react';

import { normalizeWinPath } from '../lib/format';
import { useAppStore } from '../lib/store/useAppStore';
import { AutoBackupControl } from './AutoBackupControl';

function SaveDirMenu() {
  const saveDir = useAppStore((state) => state.saveDir);
  const saveDirs = useAppStore((state) => state.saveDirs);
  const setSaveDir = useAppStore((state) => state.setSaveDir);
  const pickFolder = useAppStore((state) => state.pickFolder);
  const reveal = useAppStore((state) => state.reveal);


  const openCandidates = useAppStore((state) => state.openCandidates);

  // 绝对路径分两段：前缀压暗、末两段（槽位目录）提亮，视线直接落到关键段
  const full = normalizeWinPath(saveDir);
  const parts = full ? full.split('\\') : [];
  const tailSegs = 2;
  const prefix = parts.length > tailSegs ? parts.slice(0, -tailSegs).join('\\') + '\\' : '';
  const tail = parts.length > tailSegs ? parts.slice(-tailSegs).join('\\') : full;

  return (
    <Menu position="bottom-start" width="auto" withinPortal>
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          pl={0}
          pr={10}
          title={full || '未选择存档目录'}
          leftSection={<IconFolderOpen size={20} stroke={1.8} color="var(--ds-text-dim)" />}
          rightSection={<IconChevronDown size={15} stroke={2} color="var(--ds-text-faint)" />}
          styles={{
            label: {
              fontWeight: 400,
              fontSize: 16,
              lineHeight: 1.3,
              maxWidth: '46vw',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
            },
          }}
        >
          <span className="ds-mono" style={{ color: 'var(--ds-text-faint)' }}>{prefix}</span>
          <span className="ds-mono" style={{ color: 'var(--ds-text)' }}>{tail || '未选择存档目录'}</span>
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>存档目录</Menu.Label>
        {saveDirs.map((dir) => (
          <Menu.Item
            key={dir}
            onClick={() => void setSaveDir(dir)}
            rightSection={dir === saveDir ? <IconCheck size={14} /> : null}
          >
            <Text size="xs" className="ds-mono" style={{ whiteSpace: 'nowrap' }}>{normalizeWinPath(dir)}</Text>
          </Menu.Item>
        ))}
        {saveDirs.length === 0 && <Menu.Item disabled>没有自动找到，请手动指定</Menu.Item>}
        <Menu.Divider />
        <Menu.Item leftSection={<IconListDetails size={18} />} onClick={() => void openCandidates()}>
          切换目录…
        </Menu.Item>
        <Menu.Item leftSection={<IconFolderOpen size={18} />} onClick={() => void pickFolder('save_dir')}>
          浏览…
        </Menu.Item>
        <Menu.Item leftSection={<IconFolderOpen size={18} />} onClick={() => void reveal('save_dir')}>
          在资源管理器中打开
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** 顶栏带字按钮：图标 + 文字，hover 提亮 */
function TopButton({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof IconSearch;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <Button
      title={hint}
      variant="subtle"
      color="gray"
      size="compact-sm"
      px={8}
      leftSection={<Icon size={17} stroke={2} />}
      styles={{ label: { color: 'var(--ds-text-dim)' } }}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function Header() {
  const view = useAppStore((state) => state.view);
  const openSettingsWindow = useAppStore((state) => state.openSettingsWindow);

  return (
    <div className="ds-headerbar">
      <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="md">
        <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
          <SaveDirMenu />
          {view === 'settings' && (
            <>
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">/</Text>
              <Group gap={6} wrap="nowrap">
                <IconSettings size={18} stroke={1.8} color="var(--ds-accent)" />
                <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">设置</Text>
              </Group>
            </>
          )}
        </Group>

        <Group gap={4} wrap="nowrap">
          <TopButton
            icon={IconSearch}
            label="搜索"
            hint="搜索世界与命令（Ctrl F）"
            onClick={() => window.dispatchEvent(new CustomEvent('ds:spotlight'))}
          />

          <AutoBackupControl />

          <TopButton
            icon={IconSettings}
            label="设置"
            onClick={() => void openSettingsWindow()}
          />
        </Group>
      </Group>
    </div>
  );
}
