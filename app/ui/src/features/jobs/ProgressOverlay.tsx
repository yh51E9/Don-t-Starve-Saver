import { Box, Group, Progress, Text } from '@mantine/core';

import { formatBytes } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';

export function ProgressOverlay() {
  const activeJobId = useAppStore((state) => state.activeJobId);
  const job = useAppStore((state) => (state.activeJobId ? state.jobs[state.activeJobId] : null));

  if (!activeJobId || !job) return null;

  const label = job.kind === 'backup'
    ? '正在备份'
    : job.kind === 'restore'
      ? '正在恢复'
      : '正在清理';
  const phase = job.kind === 'restore' ? '写回' : '复制';

  return (
    <Box px="lg" pb="sm" pt={6} style={{ borderTop: '1px solid var(--ds-hairline)' }}>
      <Group justify="space-between" mb={5} wrap="nowrap">
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)">
          {label} · {phase} {job.done}/{job.total || '?'}
        </Text>
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono">
          {formatBytes(job.bytes_done)} / {formatBytes(job.bytes_total)}
        </Text>
      </Group>
      <Progress value={job.percent} size={4} color="accent" animated />
    </Box>
  );
}
