import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import {
  IconArrowBackUp,
  IconFolderSymlink,
  IconTrash,
} from '@tabler/icons-react';
import type { CSSProperties } from 'react';

import { IconButton } from '../../components/IconButton';
import type { Backup } from '../../lib/bridge/types';
import { useAppStore } from '../../lib/store/useAppStore';

/** 可开关的列（头像/操作列固定显示）；width=默认宽，minWidth=拖动下限 */
export const COLUMN_DEFS = [
  { key: 'avatar', label: '头像', width: 80, minWidth: 74 },
  { key: 'time', label: '备份时间', width: 150, minWidth: 140 },
  { key: 'ago', label: '距今', width: 92, minWidth: 82 },
  { key: 'day', label: '天数', width: 80, minWidth: 72 },
  { key: 'delta', label: '差值', width: 64, minWidth: 56 },
  { key: 'tag', label: '来源', width: 96, minWidth: 88 },
  { key: 'world', label: '当前世界', width: 92, minWidth: 80 },
  { key: 'note', label: '备注', width: 160, minWidth: 120 },
  { key: 'mods', label: 'Mod 数', width: 68, minWidth: 60 },
  { key: 'compat', label: '兼容性', width: 104, minWidth: 92 },
  { key: 'character', label: '角色', width: 92, minWidth: 80 },
  { key: 'size', label: '体积', width: 84, minWidth: 76 },
] as const;

export type ColKey = (typeof COLUMN_DEFS)[number]['key'];

export const PAGE_SIZE_KEY = 'ds:backup_page_size';
export const COLS_KEY = 'ds:backup_cols_v4';
export const COL_WIDTHS_KEY = 'ds:backup_col_widths';
export const COL_ORDER_KEY = 'ds:backup_col_order_v4';

export function loadColWidths(): Record<string, number> {
  const base: Record<string, number> = {};
  for (const col of COLUMN_DEFS) base[col.key] = col.width;
  try {
    const saved = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY) ?? '{}') as Record<string, number>;
    // 载入时 clamp 到下限：默认值/历史存储值都不会低于 minWidth（头像列 ≥80）
    // 历史默认宽度视为"没自定义过"：220 → 172 → 156 都是旧默认，统一迁到当前默认
    const legacy: Record<string, number[]> = { time: [220, 172, 156, 144] };
    const merged: Record<string, number> = { ...base };
    for (const col of COLUMN_DEFS) {
      const raw = saved[col.key];
      const stale = raw !== undefined && (legacy[col.key] ?? []).includes(raw);
      merged[col.key] = Math.max(col.minWidth, stale ? col.width : (raw ?? col.width));
    }
    return merged;
  } catch {
    return base;
  }
}

/** 图标 22px 不变，按钮框宽度压窄（40 → 34）让操作列更紧凑 */
const compactStyle: CSSProperties = { width: 34, padding: 0 };

export function RowActions({ backup }: { backup: Backup }) {
  const openRestore = useAppStore((state) => state.openRestore);
  const openDelete = useAppStore((state) => state.openDelete);
  const reveal = useAppStore((state) => state.reveal);

  return (
    <Group gap={2} justify="center" wrap="nowrap" className="ds-row-actions">
      <IconButton
        size="lg"
        style={compactStyle}
        icon={IconArrowBackUp}
        label="恢复到这份备份"
        onClick={() => void openRestore(backup)}
      />
      <IconButton
        size="lg"
        style={compactStyle}
        icon={IconFolderSymlink}
        label="在资源管理器中定位"
        onClick={() => void reveal('backup', backup.id)}
      />
      <IconButton
        size="lg"
        style={compactStyle}
        icon={IconTrash}
        label="删除这份备份"
        tone="danger"
        onClick={() => openDelete(backup)}
      />
    </Group>
  );
}

/** 批量删除确认弹窗 */
export function BatchDeleteModal({
  opened,
  count,
  running,
  onCancel,
  onConfirm,
}: {
  opened: boolean;
  count: number;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="批量删除备份"
      size={400}
      centered
      styles={{ content: { background: 'var(--ds-surface)' } }}
    >
      <Stack gap="sm">
        <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
          将永久删除选中的 {count} 份备份（含其中的全部文件），此操作不可撤销。
        </Text>
        <Group justify="flex-end">
          <Button variant="default" size="sm" onClick={onCancel}>取消</Button>
          <Button color="red" size="sm" loading={running} onClick={onConfirm}>
            确认删除
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}


/** 列顺序：缺省按 COLUMN_DEFS，历史值做一次合法性过滤（列名改过也不会崩） */
export function loadColOrder(): ColKey[] {
  const fallback = COLUMN_DEFS.map((col) => col.key);
  try {
    const saved = JSON.parse(localStorage.getItem(COL_ORDER_KEY) ?? 'null') as string[] | null;
    if (!Array.isArray(saved)) return fallback;
    const valid = saved.filter((key): key is ColKey => fallback.includes(key as ColKey));
    const merged = [...valid];
    // 旧存储里没有的新列：按 COLUMN_DEFS 的语义位插回去，而不是一律追加到末尾
    for (const key of fallback) {
      if (merged.includes(key)) continue;
      const canonIndex = fallback.indexOf(key);
      const anchor = merged.find((item) => fallback.indexOf(item) > canonIndex);
      if (anchor) merged.splice(merged.indexOf(anchor), 0, key);
      else merged.push(key);
    }
    return merged;
  } catch {
    return fallback;
  }
}
