import { ActionIcon, Box, Group, Menu, Switch, Text, Tooltip } from '@mantine/core';
import {
  IconCheck,
  IconChevronDown,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';

import { useAppStore } from '../lib/store/useAppStore';
import { useNow } from '../lib/useNow';

/** 顶栏自动备份控件：开关 + 状态灯 + 下拉（触发方式 / 清理 / 设置）。
 *
 * 右栏移除后，原本分散在「自动备份」「维护」两块的内容都收进这里：
 * 开关本身仍是 auto_backup；下拉里能看巡检状态、切换触发方式、按保留策略清理。
 */
export function AutoBackupControl() {
  const autoOn = useAppStore((state) => state.autoOn);
  const toggleAuto = useAppStore((state) => state.toggleAuto);
  const watcher = useAppStore((state) => state.watcher);
  const config = useAppStore((state) => state.config);
  const cleanup = useAppStore((state) => state.cleanup);
  const activeJobId = useAppStore((state) => state.activeJobId);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const openSettingsWindow = useAppStore((state) => state.openSettingsWindow);
  const now = useNow(5000);

  const seconds = Math.max(0, Math.round(now / 1000 - (watcher.last_tick_at || 0)));
  const statusText = !autoOn
    ? '已关闭'
    : watcher.state === 'watching'
      ? (seconds < 90 ? `巡检中 · ${seconds} 秒前` : `巡检中 · ${Math.round(seconds / 60)} 分钟前`)
      : watcher.state === 'starting'
        ? '正在启动…'
        : watcher.state === 'error'
          ? `巡检异常${watcher.error ? ` · ${watcher.error}` : ''}`
          : watcher.state === 'paused'
            ? '已暂停'
            : '等待存档目录';

  // 状态灯语义：绿=巡检正常 / 黄=启动中·等待目录 / 红=巡检异常 / 灰=未运行
  const dotColor = !autoOn || watcher.state === 'paused'
    ? 'var(--ds-text-faint)'
    : watcher.state === 'error'
      ? 'var(--ds-danger)'
      : watcher.state === 'watching'
        ? 'var(--ds-success)'
        : 'var(--ds-warning)';

  const modes: Array<{ value: 'change' | 'interval' | 'both'; label: string }> = [
    { value: 'change', label: '存档变化时' },
    { value: 'interval', label: '固定间隔' },
    { value: 'both', label: '两者都用' },
  ];

  return (
    <Group gap={2} wrap="nowrap">
      <Tooltip
        multiline
        w={280}
        openDelay={250}
        label={`存档变化时快照：检测到游戏写盘后，自动复制一份完整存档（标记为「自动」）。\n最短间隔 ${config.auto_min_gap_min} 分钟；保留 ${config.keep_auto} 份自动 / ${config.keep} 份手动。`}
        styles={{ tooltip: { whiteSpace: 'pre-line', lineHeight: 1.5 } }}
      >
        <Group gap={7} wrap="nowrap" style={{ cursor: 'default' }}>
          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">自动备份</Text>
          <Switch
            size="sm"
            color="accent"
            checked={autoOn}
            onChange={() => void toggleAuto()}
            aria-label="自动备份开关"
          />
          <Box
            title="绿=巡检正常 · 黄=启动中或等待存档目录 · 红=巡检异常 · 灰=未运行"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: dotColor,
              boxShadow: autoOn ? `0 0 0 3px color-mix(in srgb, ${dotColor} 22%, transparent)` : 'none',
            }}
          />
        </Group>
      </Tooltip>

      <Menu position="bottom-end" width={280} withinPortal shadow="md">
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="自动备份选项">
            <IconChevronDown size={14} stroke={2} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Box px={12} py={8}>
            <Group gap={6} wrap="nowrap" mb={4}>
              <Box style={{ width: 6, height: 6, borderRadius: 999, background: dotColor }} />
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)">{statusText}</Text>
            </Group>
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" lh={1.5}>
              写盘后复制完整存档，最短间隔 {config.auto_min_gap_min} 分钟。
            </Text>
          </Box>

          <Menu.Divider />
          <Menu.Label>触发方式</Menu.Label>
          {modes.map((mode) => (
            <Menu.Item
              key={mode.value}
              leftSection={<IconCheck size={14} stroke={2} style={{ opacity: config.auto_mode === mode.value ? 1 : 0 }} />}
              onClick={() => void saveSettings({ auto_mode: mode.value })}
            >
              {mode.label}
            </Menu.Item>
          ))}

          <Menu.Divider />
          <Menu.Item
            leftSection={<IconTrash size={15} stroke={1.8} />}
            onClick={() => void cleanup()}
            disabled={Boolean(activeJobId)}
          >
            清理超限备份
          </Menu.Item>
          <Box px={12} pb={6}>
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" lh={1.4}>
              保留 {config.keep} 份手动 / {config.keep_auto} 份自动，只删最旧
            </Text>
          </Box>
          <Menu.Item
            leftSection={<IconSettings size={15} stroke={1.8} />}
            onClick={() => void openSettingsWindow()}
          >
            备份策略设置…
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
