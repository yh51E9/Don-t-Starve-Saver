import { ActionIcon, Box, Button, Group, Modal, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconCheck, IconCircleMinus, IconCopy, IconExternalLink, IconFolderOpen, IconSearch, IconStack2 } from '@tabler/icons-react';
import { useMemo, useState } from 'react';

import { shortModId, workshopUrl } from '../../lib/clipboard';
import { getBridge } from '../../lib/bridge/api';
import { useAppStore } from '../../lib/store/useAppStore';
import type { ModInfo } from '../../lib/bridge/types';
import { ModIcon } from '../../components/ModIcon';
import { HoverPreviewImage } from '../../components/HoverPreviewImage';
import { SearchMark } from '../../components/SearchMark';

function ModeButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      px={11}
      h={28}
      style={{
        borderRadius: 999,
        border: `0.5px solid ${active ? 'transparent' : 'var(--ds-hairline)'}`,
        background: active ? 'var(--ds-accent)' : 'transparent',
        color: active ? 'var(--ds-on-accent)' : 'var(--ds-text-dim)',
        transition: 'background-color var(--ds-t-fast) ease, color var(--ds-t-fast) ease',
      }}
    >
      <Group gap={6} wrap="nowrap" align="center">
        {icon}
        <Text fz="var(--ds-fs-micro)">{label}</Text>
        <Text fz="var(--ds-fs-micro)" fw={700} className="ds-mono">{count}</Text>
      </Group>
    </UnstyledButton>
  );
}

function ModRow({ mod, query }: { mod: ModInfo; query: string }) {
  const enabled = mod.enabled !== false;
  const hasWorkshop = /^workshop-\d+$/.test(mod.id);
  return (
    <Group
      wrap="nowrap"
      gap={10}
      px={10}
      py={8}
      style={{ borderRadius: 'var(--ds-radius)' }}
      className="ds-mod-row"
    >
      {mod.icon ? (
        <HoverPreviewImage
          src={mod.icon}
          alt={mod.name}
          size={38}
          radius={9}
          loadFull={async () => (await (await getBridge()).modiconPreview(mod.id)).url}
        />
      ) : (
        <ModIcon icon={mod.icon} name={mod.resolved ? mod.name : shortModId(mod.id)} seed={mod.id} size={38} dim={!enabled} />
      )}
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6} wrap="nowrap">
          <Text fz="var(--ds-fs-body)" truncate c={enabled ? undefined : 'var(--ds-text-dim)'}>
            <SearchMark text={mod.resolved ? mod.name : shortModId(mod.id)} query={query} />
          </Text>
          {!hasWorkshop && (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">本地</Text>
          )}
          {!mod.resolved && (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-danger)">未解析</Text>
          )}
          {mod.version && (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono">
              v{mod.version}
            </Text>
          )}
        </Group>
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" truncate>
          {mod.resolved && mod.author ? <><SearchMark text={mod.author} query={query} /> · </> : ''}
          <SearchMark text={mod.id} query={query} />
        </Text>
      </Box>
      <Group gap={2} wrap="nowrap" style={{ flex: 'none' }} className="ds-mod-actions">
        <Tooltip label={hasWorkshop ? `复制 ID（${shortModId(mod.id)}）` : `复制文件夹名（${mod.id}）`}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            onClick={() => void useAppStore.getState().copyToClipboard(hasWorkshop ? shortModId(mod.id) : mod.id, 'Mod ID')}
          >
            <IconCopy size={18} stroke={1.9} />
          </ActionIcon>
        </Tooltip>
        {hasWorkshop && (
          <Tooltip label="在 Steam 创意工坊中打开">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              onClick={() => void useAppStore.getState().openExternal(workshopUrl(mod.id))}
            >
              <IconExternalLink size={18} stroke={1.9} />
            </ActionIcon>
          </Tooltip>
        )}
        {mod.dir && (
          <Tooltip label="打开 mod 所在文件夹">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              onClick={() => void useAppStore.getState().revealModFolder(mod.id)}
            >
              <IconFolderOpen size={18} stroke={1.9} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Group>
  );
}

export function ModsModal() {
  const opened = useAppStore((state) => state.dialog?.kind === 'mods');
  const closeDialog = useAppStore((state) => state.closeDialog);
  const details = useAppStore((state) => state.details);
  const copyToClipboard = useAppStore((state) => state.copyToClipboard);
  const [query, setQuery] = useState('');
  // 已启用 / 全部 两种视角（顶部按钮切换）
  const [mode, setMode] = useState<'enabled' | 'disabled' | 'all'>('enabled');

  // 后端没给 installed_mods（旧版）时退回 mods，全部按已启用处理
  const all = useMemo(() => {
    if (!details) return [] as ModInfo[];
    if (details.installed_mods?.length) return details.installed_mods;
    return details.mods.map((mod) => ({ ...mod, enabled: true }));
  }, [details]);

  const enabledMods = useMemo(
    () => all.filter((mod) => mod.enabled !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [all],
  );
  const disabledMods = useMemo(
    () => all.filter((mod) => mod.enabled === false).sort((a, b) => a.name.localeCompare(b.name)),
    [all],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (mod: ModInfo) => `${mod.name} ${mod.author} ${mod.id}`.toLowerCase().includes(q);
    const match = (list: ModInfo[]) => (q ? list.filter(hit) : list);
    return {
      enabled: mode === 'disabled' ? [] : match(enabledMods),
      disabled: mode === 'enabled' ? [] : match(disabledMods),
      showEnabledGroup: mode !== 'disabled',
      showDisabledGroup: mode !== 'enabled' && disabledMods.length > 0,
    };
  }, [enabledMods, disabledMods, query, mode]);

  const enabledIds = enabledMods.map((mod) => shortModId(mod.id)).join('\n');
  const empty = !details || all.length === 0;
  const noMatch = !empty && filtered.enabled.length === 0 && filtered.disabled.length === 0;
  const showEnabledGroup = filtered.showEnabledGroup;
  const showDisabledGroup = filtered.showDisabledGroup;

  return (
    <Modal
      opened={opened}
      onClose={closeDialog}
      title={
        <Group gap={10} wrap="nowrap">
          <Text fz="var(--ds-fs-body)" fw={600}>Mods</Text>
          <Group gap={6} wrap="nowrap">
            <ModeButton
              active={mode === 'enabled'}
              icon={<IconCheck size={15} stroke={2.8} />}
              label="已启用"
              count={enabledMods.length}
              onClick={() => setMode('enabled')}
            />
            <ModeButton
              active={mode === 'disabled'}
              icon={<IconCircleMinus size={15} stroke={2.4} />}
              label="未启用"
              count={disabledMods.length}
              onClick={() => setMode('disabled')}
            />
            <ModeButton
              active={mode === 'all'}
              icon={<IconStack2 size={15} stroke={2.4} />}
              label="全部"
              count={all.length}
              onClick={() => setMode('all')}
            />
          </Group>
        </Group>
      }
      size={780}
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
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <TextInput
            size="sm"
            style={{ flex: 1 }}
            leftSection={<IconSearch size={16} stroke={1.8} />}
            placeholder="搜索名称 / 作者 / ID …"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            data-autofocus
          />
          <Tooltip label="只复制已启用 Mod 的数字 ID，一行一个">
            <Button
              variant="default"
              size="sm"
              leftSection={<IconCopy size={16} stroke={1.8} />}
              disabled={enabledMods.length === 0}
              onClick={() => void copyToClipboard(enabledIds, '已启用 Mod ID')}
            >
              复制已启用 ID
            </Button>
          </Tooltip>
        </Group>

        <Box style={{ maxHeight: 460, overflowY: 'auto', margin: '0 -6px', padding: '0 6px' }}>
          {empty && (
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" ta="center" py={28}>
              这个存档还没装 Mod，或者没检测到游戏目录
            </Text>
          )}
          {noMatch && (
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" ta="center" py={28}>
              {query.trim()
                ? `没有匹配「${query}」的 Mod`
                : mode === 'disabled'
                  ? '这个存档的 Mod 全部处于启用状态'
                  : mode === 'enabled'
                    ? '这个存档没有启用任何 Mod'
                    : '没有找到 Mod'}
            </Text>
          )}

          {showEnabledGroup && filtered.enabled.length > 0 && (
            <Box mb={showDisabledGroup ? 10 : 0}>
              <Text
                fz="var(--ds-fs-micro)"
                c="var(--ds-text-faint)"
                px={10}
                pt={6}
                pb={4}
                style={{ letterSpacing: '0.04em' }}
              >
                已启用 · {filtered.enabled.length}
              </Text>
              {filtered.enabled.map((mod) => <ModRow key={mod.id} mod={mod} query={query} />)}
            </Box>
          )}

          {filtered.disabled.length > 0 && (
            <Box>
              <Text
                fz="var(--ds-fs-micro)"
                c="var(--ds-text-faint)"
                px={10}
                pt={6}
                pb={4}
                style={{
                  letterSpacing: '0.04em',
                  borderTop: mode === 'all' ? '0.5px solid var(--ds-hairline)' : undefined,
                }}
              >
                未启用 · {filtered.disabled.length}
              </Text>
              {filtered.disabled.map((mod) => <ModRow key={mod.id} mod={mod} query={query} />)}
            </Box>
          )}
        </Box>
      </Stack>
    </Modal>
  );
}
