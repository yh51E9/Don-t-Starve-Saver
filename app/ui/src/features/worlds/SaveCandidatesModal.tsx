import { Box, Button, Collapse, Group, HoverCard, Modal, Radio, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconBrandSteam,
  IconChevronDown,
  IconCopy,
  IconEyeOff,
  IconFolder,
  IconFolderOpen,
  IconRefresh,
  IconRotate2,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import type { SaveCandidate } from '../../lib/bridge/types';
import { getBridge } from '../../lib/bridge/api';
import { compactPath, normalizeWinPath } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';

function CandidateMeta({ candidate }: { candidate: SaveCandidate }) {
  const parts: string[] = [];
  if (candidate.has_saveindex) {
    parts.push(candidate.world_count ? `${candidate.world_count} 个世界` : '有 saveindex（无世界）');
  } else {
    parts.push('还没有存档');
  }
  if (candidate.last_modified) {
    const date = new Date(candidate.last_modified * 1000);
    parts.push(
      `修改于 ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    );
  }
  return <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">{parts.join(' · ')}</Text>;
}

/** 路径文本：compactPath 展示，悬停看完整路径+复制，单击打开目录（双通道之一） */
function PathText({ path }: { path: string }) {
  const revealSaveDir = useAppStore((state) => state.revealSaveDir);
  const copyToClipboard = useAppStore((state) => state.copyToClipboard);
  return (
    <HoverCard position="left" withArrow openDelay={250} shadow="md">
      <HoverCard.Target>
        <Text
          fz="var(--ds-fs-micro)"
          className="ds-mono"
          c="var(--ds-text-faint)"
          truncate
          onClick={(event) => {
            event.stopPropagation();
            void revealSaveDir(path);
          }}
          style={{ cursor: 'pointer' }}
        >
          {compactPath(path)}
        </Text>
      </HoverCard.Target>
      <HoverCard.Dropdown p={10} style={{ maxWidth: 420 }}>
        <Text fz="var(--ds-fs-micro)" className="ds-mono" style={{ wordBreak: 'break-all' }}>
          {normalizeWinPath(path)}
        </Text>
        <Button
          variant="subtle"
          size="compact-xs"
          mt={6}
          leftSection={<IconCopy size={14} stroke={1.8} />}
          onClick={() => void copyToClipboard(path, '完整路径')}
        >
          复制完整路径
        </Button>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export function SaveCandidatesModal() {
  const opened = useAppStore((state) => state.candidatesOpen);
  const close = useAppStore((state) => state.closeCandidates);
  const setSaveDir = useAppStore((state) => state.setSaveDir);
  const currentDir = useAppStore((state) => state.saveDir);
  const excludeCandidate = useAppStore((state) => state.excludeCandidate);
  const restoreCandidate = useAppStore((state) => state.restoreCandidate);
  const revealSaveDir = useAppStore((state) => state.revealSaveDir);
  const [candidates, setCandidates] = useState<SaveCandidate[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [excludedOpen, setExcludedOpen] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setLoading(true);
    getBridge()
      .then((bridge) => bridge.listSaveCandidates())
      .then((result) => {
        setCandidates(result.candidates);
        setExcluded(result.excluded);
        setChosen(currentDir || (result.candidates.find((item) => item.has_saveindex)?.path ?? null));
      })
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [opened, currentDir]);

  const rescan = () => {
    setLoading(true);
    getBridge()
      .then((bridge) => bridge.listSaveCandidates())
      .then((result) => {
        setCandidates(result.candidates);
        setExcluded(result.excluded);
      })
      .finally(() => setLoading(false));
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="选择存档目录"
      centered
      size="lg"
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
      <Stack gap="sm" data-autofocus tabIndex={-1}>
        <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">
          扫描到的候选目录，选一个作为当前使用的存档。
        </Text>

        {loading && <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)">正在扫描…</Text>}
        {!loading && candidates.length === 0 && (
          <Box ta="center" py="md">
            <IconFolder size={28} stroke={1.5} color="var(--ds-text-faint)" />
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" mt={6}>
              没有找到候选目录
              {excluded.length > 0 ? '——部分候选可能已被隐藏，可在下方恢复' : '，可以用下方按钮手动指定'}
            </Text>
          </Box>
        )}

        <Radio.Group value={chosen} onChange={setChosen}>
          <Stack gap={6}>
            {candidates.map((candidate) => (
              <Box
                key={candidate.path}
                className="ds-candidate"
                data-active={chosen === candidate.path}
                p={10}
                onClick={() => setChosen(candidate.path)}
              >
                <Group justify="space-between" wrap="nowrap" gap={8}>
                  <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    <Radio value={candidate.path} tabIndex={-1} />
                    {candidate.source === 'steam'
                      ? <IconBrandSteam size={18} stroke={1.6} color="var(--ds-text-dim)" />
                      : <IconFolder size={18} stroke={1.6} color="var(--ds-text-dim)" />}
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap">
                        <Text fz="var(--ds-fs-body)" truncate>
                          {candidate.source === 'steam' ? candidate.account : '本机文档目录'}
                        </Text>
                        {candidate.source === 'steam' && (
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">Steam</Text>
                        )}
                      </Group>
                      <PathText path={candidate.path} />
                      <CandidateMeta candidate={candidate} />
                    </Box>
                  </Group>
                  <Group gap={4} wrap="nowrap" className="ds-row-actions">
                    {candidate.path === currentDir && (
                      <Text fz="var(--ds-fs-micro)" c="var(--ds-accent)">当前</Text>
                    )}
                    <Button
                      variant="default"
                      size="compact-sm"
                      px={8}
                      leftSection={<IconFolderOpen size={14} stroke={1.8} />}
                      onClick={(event) => {
                        event.stopPropagation();
                        void revealSaveDir(candidate.path);
                      }}
                    >
                      打开
                    </Button>
                    <Button
                      variant="default"
                      size="compact-sm"
                      px={8}
                      leftSection={<IconEyeOff size={14} stroke={1.8} />}
                      disabled={candidate.path === currentDir}
                      title={candidate.path === currentDir ? '当前目录不能隐藏' : '不再显示这个候选'}
                      onClick={(event) => {
                        event.stopPropagation();
                        void excludeCandidate(candidate.path);
                      }}
                    >
                      隐藏
                    </Button>
                  </Group>
                </Group>
              </Box>
            ))}
          </Stack>
        </Radio.Group>

        {excluded.length > 0 && (
          <Box
            className="ds-panel"
            p="sm"
            style={{ borderRadius: 'calc(var(--ds-radius) * 2)' }}
          >
            <UnstyledButton
              onClick={() => setExcludedOpen(!excludedOpen)}
              w="100%"
              c="var(--ds-text-dim)"
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap={6} wrap="nowrap">
                  <IconEyeOff size={14} stroke={1.8} />
                  <Text fz="var(--ds-fs-meta)">已隐藏 {excluded.length} 个候选目录</Text>
                </Group>
                <IconChevronDown
                  size={14}
                  stroke={1.8}
                  style={{
                    transform: excludedOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform var(--ds-t-fast) ease',
                  }}
                />
              </Group>
            </UnstyledButton>
            <Collapse expanded={excludedOpen}>
              <Stack gap={4} pt="sm">
                {excluded.map((path) => (
                  <Group key={path} justify="space-between" wrap="nowrap" gap={8}>
                    <Text fz="var(--ds-fs-micro)" className="ds-mono" c="var(--ds-text-faint)" truncate>
                      {compactPath(path)}
                    </Text>
                    <Button
                      variant="default"
                      size="compact-xs"
                      leftSection={<IconRotate2 size={14} stroke={1.8} />}
                      onClick={() => void restoreCandidate(path)}
                    >
                      恢复显示
                    </Button>
                  </Group>
                ))}
              </Stack>
            </Collapse>
          </Box>
        )}

        <Group justify="space-between" mt="xs">
          <Button
            variant="default"
            size="sm"
            leftSection={<IconRefresh size={16} stroke={1.8} />}
            onClick={rescan}
          >
            重新扫描
          </Button>
          <Group gap="sm">
            <Button variant="default" size="sm" onClick={close}>取消</Button>
            <Button
              size="sm"
              disabled={!chosen || chosen === currentDir}
              onClick={() => chosen && void setSaveDir(chosen)}
            >
              使用此目录
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
