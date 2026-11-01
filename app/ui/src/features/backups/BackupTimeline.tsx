import { Box, Button, Checkbox, Group, HoverCard, Menu, Modal, Pagination, Popover, Select, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import {
  IconArrowBackUp,
  IconDatabase,
  IconFileExport,
  IconFilter,
  IconFolderSymlink,
  IconGripVertical,
  IconNote,
  IconPackageImport,
  IconPhotoUp,
  IconRefresh,
  IconSearch,
  IconSettings2,
  IconSortAscending,
  IconSortDescending,
  IconLicense,
  IconTag,
  IconTrash,
  IconUser,
  IconWorld,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BackupDetailModal } from './BackupDetailModal';
import {
  BatchDeleteModal,
  ColKey,
  COL_ORDER_KEY,
  COLUMN_DEFS,
  COLS_KEY,
  COL_WIDTHS_KEY,
  loadColOrder,
  loadColWidths,
  PAGE_SIZE_KEY,
} from './backupTimelineParts';
import { useAppStore } from '../../lib/store/useAppStore';
import { EmptyState } from '../../components/EmptyState';
import { WorldAvatar } from '../../components/WorldAvatar';
import { Tag, TAG_META } from '../../components/Tag';
import type { Backup, BackupTag, FilterOptions, World } from '../../lib/bridge/types';
import { SearchMark } from '../../components/SearchMark';
import { ImportExportModal } from './ImportExportModal';
import { formatAgoCompact, formatBytes } from '../../lib/format';
import { colScale } from '../../theme/resolver';
import { getBridge } from '../../lib/bridge/api';

function loadCols(): Record<ColKey, boolean> {
  const base: Record<ColKey, boolean> = {
    avatar: true, time: true, ago: true, day: true, delta: true, tag: true, world: true, note: true,
    mods: false, compat: false, character: false, size: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}');
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

const OTHER_CHAR = '__other_chars__';
const OTHER_WORLD = '__other_world__';

const TAG_OPTIONS = (Object.entries(TAG_META) as Array<[BackupTag, { label: string; color: string; hint: string }]>).map(
  ([value, spec]) => ({ value, label: spec.label, color: spec.color, hint: spec.hint }),
);

export function BackupTimeline({ world }: { world: World }) {
  const backups = useAppStore((state) => state.backups);
  const avatars = useAppStore((state) => state.avatars);
  const refreshAvatars = useAppStore((state) => state.refreshAvatars);
  const loadAvatars = useAppStore((state) => state.loadAvatars);
  const refreshBackups = useAppStore((state) => state.refreshBackups);
  const startAvatarPicker = useAppStore((state) => state.startAvatarPicker);
  const startAvatarUpload = useAppStore((state) => state.startAvatarUpload);
  const openRestore = useAppStore((state) => state.openRestore);
  const openDelete = useAppStore((state) => state.openDelete);
  const reveal = useAppStore((state) => state.reveal);
  const [detail, setDetail] = useState<Backup | null>(null);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; char: string; backup: Backup } | null>(null);
  // 坐标与开关分离：关闭时保留最后坐标，避免 Dropdown 关闭动画期间回落 (0,0) 在左上角闪现
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [ioModal, setIoModal] = useState<null | { mode: 'import' } | { mode: 'export'; ids: string[] }>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(PAGE_SIZE_KEY)) || 20;
    } catch {
      return 20;
    }
  });
  const [cols, setCols] = useState<Record<ColKey, boolean>>(loadCols);
  const [widths, setWidths] = useState<Record<string, number>>(loadColWidths);
  // 列宽以 17px 字号为基准存储；渲染时按当前字号缩放（colScale），取值与 CSS 变量同源（含跨窗字号预览）
  const fontSize = useAppStore((state) => state.previewFontSize ?? state.config.font_size);
  const cs = colScale(fontSize ?? 17);
  const csRef = useRef(cs);
  csRef.current = cs;
  /** 基准 px → 渲染 px。头像列内容是固定 46px 图，不随字号变，保持基准宽 */
  const cw = (key: string, fallback: number) => {
    const base = widths[key] ?? fallback;
    return key === 'avatar' ? base : Math.round(base * cs);
  };
  const [order, setOrder] = useState<ColKey[]>(loadColOrder);
  const [dragCol, setDragCol] = useState<ColKey | null>(null);
  const [dropCol, setDropCol] = useState<ColKey | null>(null);
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const [popDrag, setPopDrag] = useState<ColKey | null>(null);
  const [popOver, setPopOver] = useState<ColKey | null>(null);
  const [orderVersion, setOrderVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availWidth, setAvailWidth] = useState(0);
  const [sort, setSort] = useState<{
    key: 'time' | 'ago' | 'day' | 'delta' | 'size' | 'mods' | 'compat' | 'character' | 'world' | 'note';
    dir: 'asc' | 'desc';
  } | null>(null);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [compatFilter, setCompatFilter] = useState<Set<string>>(new Set());
  const [charFilter, setCharFilter] = useState<Set<string>>(new Set());
  const [worldFilter, setWorldFilter] = useState<Set<string>>(new Set());
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [charSearch, setCharSearch] = useState('');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ compat: [], world: [], character_groups: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ id: string; label: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // 筛选项：兼容性 / 当前世界 / 角色（官方 + mod）
  useEffect(() => {
    let alive = true;
    getBridge()
      .then((bridge) => bridge.filterOptions())
      .then((result) => {
        if (alive) setFilterOptions(result);
        // 预拉官方角色头像，悬停预览才不会全是首字母
        void loadAvatars(['unknown', ...result.character_groups.flatMap((group) => group.items.map((item) => item.key))]);
      })
      .catch(() => { /* 筛选项加载失败就退化：只有来源筛选可用 */ });
    return () => {
      alive = false;
    };
  }, []);

  // 表格容器实际可用宽度：只有列真的放不下才启用 minWidth，避免「刚好放得下却能滑一丢丢」
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setAvailWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 受控坐标菜单没有 Target，outside click 检测失效——全局监听兜底关闭
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenu]);

  // 列宽拖动：移动中实时更新，松手持久化（不低于 minWidth）
  const minW = (key: string) => (key === 'avatar' ? 74 : COLUMN_DEFS.find((c) => c.key === key)?.minWidth ?? 64);
  const startDrag = useCallback((event: React.MouseEvent, key: string) => {
    event.preventDefault();
    dragRef.current = { key, startX: event.clientX, startW: widths[key] ?? 220 };
  }, [widths]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // 屏幕 px → 基准 px：列宽渲染时会乘 cs，拖动增量要除回去，手感才 1:1
      const next = Math.max(minW(drag.key), drag.startW + (e.clientX - drag.startX) / (csRef.current || 1));
      setWidths((prev) => ({ ...prev, [drag.key]: next }));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setWidths((prev) => {
        try {
          localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(prev));
        } catch {
          /* 忽略 */
        }
        return prev;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 拖动换位：把 from 移到 to 的位置，落库 */
  const moveCol = (from: ColKey, to: ColKey) => {
    if (from === to) return;
    setOrder((prev) => {
      const fromIdx = prev.indexOf(from);
      const toIdx = prev.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.filter((key) => key !== from);
      const targetIdx = next.indexOf(to);
      // 往下拖：插到目标之后；往上拖：插到目标之前
      const insertIdx = fromIdx < toIdx ? targetIdx + 1 : targetIdx;
      next.splice(insertIdx, 0, from);
      try {
        localStorage.setItem(COL_ORDER_KEY, JSON.stringify(next));
      } catch {
        /* 忽略 */
      }
      return next;
    });
    setOrderVersion((v) => v + 1);
  };

  const headerHints: Record<string, string> = {
    avatar: '备份时使用的角色头像，可拖动调整列宽',
    time: '备份创建时间 · 点击按时间排序',
    day: '备份时的存档天数 · 点击按天数排序',
    delta: '差值 = 备份天数 − 当前存档天数；相同为 0 天 · 点击按差值排序',
    tag: '备份来源（手动 / 自动 / 恢复前）· 在「筛选」面板中按来源筛选',
    size: '备份占用的磁盘体积 · 点击按大小排序',
    ago: '距现在多久（与备份时间同序）· 点击排序，悬停单元格看完整时间',
    compat: '这份备份所属的版本 · 在「筛选」面板中筛选',
    character: '备份时正在游玩的角色 · 在「筛选」面板中筛选',
    world: '角色当时所在的具体世界（原版生存/巨人国/海滩/猪镇/洞穴层/火山）· 在「筛选」面板中筛选',
    mods: '备份时启用的 Mod 数量 · 点击按数量排序',
    note: '备份备注（存在程序数据目录，不改备份内容）· 点击单元格编辑',
  };

  const sortable = (key: string) =>
    key === 'time' || key === 'ago' || key === 'day' || key === 'delta'
    || key === 'size' || key === 'mods' || key === 'note';

  const toggleSort = (key: 'time' | 'ago' | 'day' | 'delta' | 'size' | 'mods' | 'compat' | 'character' | 'world' | 'note') => {
    setSort((prev) => (prev?.key === key
      ? (prev.dir === 'desc' ? { key, dir: 'asc' as const } : null)
      : { key, dir: 'desc' as const }));
  };

  const toggleInSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setPage(1);
  };

  const toggleTag = (tag: string) => toggleInSet(setTagFilter, tag);

  const toggleCol = (key: ColKey) => {
    const next = { ...cols, [key]: !cols[key] };
    setCols(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
  };

  /** 查询 + 多维筛选（来源 / 兼容性 / 角色 / 当前世界 / Mod 数） */
  const officialCharKeys = useMemo(
    () => new Set(filterOptions.character_groups.flatMap((group) => group.items.map((item) => item.key))),
    [filterOptions.character_groups],
  );
  const otherCharKeys = useMemo(
    () => new Set(filterOptions.character_groups
      .filter((group) => group.key === 'other')
      .flatMap((group) => group.items.map((item) => item.key))),
    [filterOptions.character_groups],
  );
  const knownWorlds = useMemo(() => new Set(filterOptions.world), [filterOptions.world]);

  const isOtherChar = (backup: Backup) => {
    const key = backup.character_id || backup.character;
    return otherCharKeys.has(key) || !officialCharKeys.has(key);
  };

  const isOtherWorld = (backup: Backup) => {
    const value = backup.current_world ?? '';
    return value !== '' && !knownWorlds.has(value);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tags = tagFilter.size > 0;
    const compats = compatFilter.size > 0;
    const chars = charFilter.size > 0;
    const worlds = worldFilter.size > 0;
    return backups.filter((backup) => {
      if (tags && !tagFilter.has(backup.tag)) return false;
      if (compats && !compatFilter.has(backup.compatibility?.primary ?? '')) return false;
      if (chars) {
        const key = backup.character_id || backup.character;
        const hit = charFilter.has(key)
          || (charFilter.has(OTHER_CHAR) && isOtherChar(backup));
        if (!hit) return false;
      }
      if (worlds) {
        const hit = worldFilter.has(backup.current_world ?? '')
          || (worldFilter.has(OTHER_WORLD) && isOtherWorld(backup));
        if (!hit) return false;
      }
      if (!q) return true;
      return [backup.full_time, backup.tag_label, backup.tag, backup.character, backup.character_label, backup.note ?? '']
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [backups, query, tagFilter, compatFilter, charFilter, worldFilter, officialCharKeys, otherCharKeys, knownWorlds]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'time' || sort.key === 'ago') return a.stamp.localeCompare(b.stamp) * dir;
      if (sort.key === 'day') return ((a.day ?? 0) - (b.day ?? 0)) * dir;
      if (sort.key === 'delta') return ((a.day ?? 0) - (b.day ?? 0) - (world.day ?? 0)) * dir;
      if (sort.key === 'mods') return ((a.mods_count ?? 0) - (b.mods_count ?? 0)) * dir;
      if (sort.key === 'compat') return (a.compatibility?.primary ?? '').localeCompare(b.compatibility?.primary ?? '') * dir;
      if (sort.key === 'character') return (a.character_label || a.character || '').localeCompare(b.character_label || b.character || '') * dir;
      if (sort.key === 'world') return (a.current_world ?? '').localeCompare(b.current_world ?? '') * dir;
      if (sort.key === 'note') return (a.note ?? '').localeCompare(b.note ?? '') * dir;
      return (a.size_bytes - b.size_bytes) * dir;
    });
  }, [filtered, sort, world.day]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  );

  const tableMinWidth = 56 + order
    .filter((key) => cols[key])
    .reduce((sum, key) => {
      const def = COLUMN_DEFS.find((col) => col.key === key);
      return sum + cw(key, def?.width ?? 80);
    }, 0);
  // 只有列宽总和真的超过容器才启用 minWidth；否则交给 width:100%，避免出现「能滑一丢丢」的假滚动条
  const effectiveMinWidth = availWidth > 0 && tableMinWidth <= availWidth ? undefined : tableMinWidth;

  const visibleCols = order
    .map((key) => COLUMN_DEFS.find((col) => col.key === key))
    .filter((col): col is (typeof COLUMN_DEFS)[number] => Boolean(col && cols[col.key]));

  // 尖啸者存档的备份全部用官方 screecher 头像（存档 meta 里记的是 wilson）
  const avatarKey = (backup: Backup) =>
    world.kind === 'screecher' ? 'screecher' : (backup.character_id || backup.character);
  const allSelected = paged.length > 0 && paged.every((backup) => selected.has(backup.id));
  const selectedInPage = paged.filter((backup) => selected.has(backup.id));
  // 最新一份用于行标记：排序后第一行未必是最新
  const newestId = backups[0]?.id;

  const activeFilterCount =
    tagFilter.size + compatFilter.size + charFilter.size + worldFilter.size;

  const clearAllFilters = () => {
    setTagFilter(new Set());
    setCompatFilter(new Set());
    setCharFilter(new Set());
    setWorldFilter(new Set());
    setPage(1);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshBackups();
    } finally {
      setRefreshing(false);
    }
  };

  const saveNote = async () => {
    if (!noteEdit) return;
    try {
      const bridge = await getBridge();
      await bridge.backupSetNote(noteEdit.id, noteDraft);
      setNoteEdit(null);
      await refreshBackups();
    } catch {
      /* 保存失败保持编辑态，用户可重试 */
    }
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        paged.forEach((backup) => next.delete(backup.id));
      } else {
        paged.forEach((backup) => next.add(backup.id));
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const runBatchDelete = async () => {
    setBatchRunning(true);
    try {
      const bridge = await getBridge();
      for (const backup of selectedInPage) {
        await bridge.deleteBackup(backup.id);
      }
      setSelected(new Set());
      setBatchConfirm(false);
      await refreshBackups();
    } catch {
      /* 批量删除失败：保留选择，交给用户重试 */
    } finally {
      setBatchRunning(false);
    }
  };

  /** 表头单元：排序 + 激活筛选指示（筛选交互统一收到「筛选」面板） */
  const renderHeaderCell = (col: (typeof COLUMN_DEFS)[number]) => {
    const filterActive =
      (col.key === 'tag' && tagFilter.size > 0)
      || (col.key === 'compat' && compatFilter.size > 0)
      || (col.key === 'character' && charFilter.size > 0)
      || (col.key === 'world' && worldFilter.size > 0);

    return (
      <Tooltip withinPortal openDelay={200} label={headerHints[col.key] ?? col.label}>
        <Group gap={4} justify="center" style={{ cursor: sortable(col.key) ? 'pointer' : 'inherit' }}>
          <Text component="span">{col.label}</Text>
          {sort?.key === col.key && (
            sort.dir === 'asc'
              ? <IconSortAscending size={13} stroke={2} color="var(--ds-accent)" />
              : <IconSortDescending size={13} stroke={2} color="var(--ds-accent)" />
          )}
          {filterActive && (
            <span
              title="已有筛选条件，点击查看"
              onClick={(event) => {
                event.stopPropagation();
                setFilterPanelOpen(true);
              }}
              style={{ display: 'inline-flex', cursor: 'pointer' }}
            >
              <IconFilter size={12} stroke={2} color="var(--ds-accent)" />
            </span>
          )}
        </Group>
      </Tooltip>
    );
  };

  if (backups.length === 0) {
    return (
      <EmptyState
        icon={IconDatabase}
        title="这个世界还没有备份"
        hint="点右上角「备份此世界」拍第一份，之后每次自动快照都会出现在这里"
      />
    );
  }

  return (
    <Box px="lg" pb="md" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between" wrap="nowrap" mb={16} mt={14}>
        <TextInput
          placeholder="搜索时间、来源、角色…"
          leftSection={<IconSearch size={15} stroke={2} />}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setPage(1);
          }}
          w={280}
          size="sm"
        />
        <Group gap="xs" wrap="nowrap">
          {selected.size > 0 && (
            <Button
              variant="default"
              size="sm"
              leftSection={<IconFileExport size={16} stroke={2} />}
              onClick={() => setIoModal({ mode: 'export', ids: [...selected] })}
            >
              导出（{selected.size}）
            </Button>
          )}
          {selected.size > 0 && (
            <Button
              color="red"
              size="sm"
              leftSection={<IconTrash size={16} stroke={2.2} />}
              onClick={() => setBatchConfirm(true)}
            >
              删除选中（{selected.size}）
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            leftSection={<IconPackageImport size={15} stroke={2} />}
            onClick={() => setIoModal({ mode: 'import' })}
          >
            导入
          </Button>
          <Button
            variant="default"
            size="sm"
            leftSection={<IconRefresh size={15} stroke={2} />}
            loading={refreshing}
            onClick={() => void onRefresh()}
          >
            刷新
          </Button>
          <Popover position="bottom-end" withinPortal shadow="md" opened={filterPanelOpen} onChange={setFilterPanelOpen}>
            <Popover.Target>
              <Button
                variant="default"
                size="sm"
                leftSection={<IconFilter size={15} stroke={2} />}
                onClick={() => setFilterPanelOpen(!filterPanelOpen)}
              >
                筛选{activeFilterCount > 0 ? `（${activeFilterCount}）` : ''}
              </Button>
            </Popover.Target>
            <Popover.Dropdown p={12} style={{ width: 340 }}>
              <Stack gap={10}>
                <Group justify="space-between" wrap="nowrap">
                  <Text fz="var(--ds-fs-meta)" fw={600}>筛选</Text>
                  <Button
                    size="compact-xs"
                    variant={activeFilterCount > 0 ? 'light' : 'subtle'}
                    color={activeFilterCount > 0 ? 'red' : 'gray'}
                    disabled={activeFilterCount === 0}
                    onClick={clearAllFilters}
                  >
                    清除筛选
                  </Button>
                </Group>

                <Stack gap={10} style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <Box>
                    <Group gap={5} mb={5} wrap="nowrap"><IconTag size={13} stroke={2} color="var(--ds-text-faint)" /><Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">来源</Text></Group>
                    <Group gap={5} wrap="wrap">
                      {TAG_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          size="compact-xs"
                          variant={tagFilter.has(option.value) ? 'filled' : 'default'}
                          title={option.hint}
                          leftSection={
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 999,
                                background: option.color,
                                flex: 'none',
                              }}
                            />
                          }
                          onClick={() => toggleTag(option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </Group>
                  </Box>

                  <Box>
                    <Group gap={5} mb={5} wrap="nowrap"><IconLicense size={13} stroke={2} color="var(--ds-text-faint)" /><Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">兼容性</Text></Group>
                    <Group gap={5} wrap="wrap">
                      {filterOptions.compat.map((value) => (
                        <Button
                          key={value}
                          size="compact-xs"
                          variant={compatFilter.has(value) ? 'filled' : 'default'}
                          onClick={() => toggleInSet(setCompatFilter, value)}
                        >
                          {value}
                        </Button>
                      ))}
                    </Group>
                  </Box>

                  <Box>
                    <Group gap={5} mb={5} wrap="nowrap"><IconUser size={13} stroke={2} color="var(--ds-text-faint)" /><Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">角色</Text></Group>
                    <TextInput
                      size="xs"
                      placeholder="搜索角色…"
                      value={charSearch}
                      onChange={(event) => setCharSearch(event.currentTarget.value)}
                      mb={5}
                    />
                    <Stack gap={4} style={{ maxHeight: 170, overflowY: 'auto' }}>
                      {filterOptions.character_groups.map((group) => {
                        const visible = group.items.filter((item) => !charSearch.trim() || item.label.toLowerCase().includes(charSearch.trim().toLowerCase()));
                        if (visible.length === 0) return null;
                        return (
                          <Box key={group.key}>
                            {group.key !== 'base' && (
                              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mb={2}>{group.label}</Text>
                            )}
                            {visible.map((item) => (
                              <Group
                                key={item.key}
                                gap={7}
                                wrap="nowrap"
                                px={5}
                                py={3}
                                style={{
                                  cursor: 'pointer',
                                  borderRadius: 6,
                                  background: charFilter.has(item.key) ? 'color-mix(in srgb, var(--ds-accent) 18%, transparent)' : 'transparent',
                                }}
                                onClick={() => toggleInSet(setCharFilter, item.key)}
                              >
                                <HoverCard position="right" withinPortal shadow="md" openDelay={120}>
                                  <HoverCard.Target>
                                    <div style={{ display: 'inline-flex' }}>
                                      <WorldAvatar character={item.key} label={item.label} size={24} />
                                    </div>
                                  </HoverCard.Target>
                                  <HoverCard.Dropdown p={8} style={{ background: 'var(--ds-surface)' }}>
                                    <WorldAvatar character={item.key} label={item.label} size={128} />
                                    <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={6} ta="center">
                                      <SearchMark text={item.label} query={charSearch} />
                                    </Text>
                                  </HoverCard.Dropdown>
                                </HoverCard>
                                <Text fz="var(--ds-fs-micro)" truncate>
                                  <SearchMark text={item.label} query={charSearch} />
                                </Text>
                              </Group>
                            ))}
                          </Box>
                        );
                      })}
                      <Group
                        gap={7}
                        wrap="nowrap"
                        px={5}
                        py={3}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 6,
                          background: charFilter.has(OTHER_CHAR) ? 'color-mix(in srgb, var(--ds-accent) 18%, transparent)' : 'transparent',
                        }}
                        onClick={() => toggleInSet(setCharFilter, OTHER_CHAR)}
                      >
                        <HoverCard position="right" withinPortal shadow="md" openDelay={120}>
                          <HoverCard.Target>
                            <div style={{ display: 'inline-flex' }}>
                              <WorldAvatar character="unknown" label="其他" size={24} />
                            </div>
                          </HoverCard.Target>
                          <HoverCard.Dropdown p={8} style={{ background: 'var(--ds-surface)' }}>
                            <WorldAvatar character="unknown" label="其他" size={128} />
                            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={6} ta="center">
                              其他角色
                            </Text>
                          </HoverCard.Dropdown>
                        </HoverCard>
                        <Text fz="var(--ds-fs-micro)" truncate>其他</Text>
                      </Group>
                    </Stack>
                  </Box>

                  <Box>
                    <Group gap={5} mb={5} wrap="nowrap"><IconWorld size={13} stroke={2} color="var(--ds-text-faint)" /><Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">当前世界</Text></Group>
                    <Stack gap={4} style={{ maxHeight: 190, overflowY: 'auto' }}>
                      {[
                        { label: '原版', values: ['原版生存', '原版-洞穴第 1 层', '原版-洞穴第 2 层'] },
                        { label: '巨人国', values: ['巨人国', '巨人国-洞穴第 1 层', '巨人国-洞穴第 2 层'] },
                        { label: '海滩', values: ['海滩', '海滩-火山'] },
                        { label: '猪镇', values: ['猪镇'] },
                        { label: '其他', values: [OTHER_WORLD] },
                      ].map((group) => (
                        <Box key={group.label}>
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mb={3}>{group.label}</Text>
                          <Group gap={5} wrap="wrap">
                            {group.values.map((value) => (
                              <Button
                                key={value}
                                size="compact-xs"
                                variant={worldFilter.has(value) ? 'filled' : 'default'}
                                onClick={() => toggleInSet(setWorldFilter, value)}
                              >
                                {value === OTHER_WORLD ? '其他' : value}
                              </Button>
                            ))}
                          </Group>
                        </Box>
                      ))}
                    </Stack>
                  </Box>

                </Stack>
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <Popover position="bottom-end" withinPortal shadow="md" opened={colsOpen} onChange={setColsOpen}>
            <Popover.Target>
              <Button variant="default" size="sm" leftSection={<IconSettings2 size={16} stroke={2} />}
                onClick={() => setColsOpen(!colsOpen)}>
                表头
              </Button>
            </Popover.Target>
            <Popover.Dropdown p={10}>
              <Stack gap={6}>
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">显示列</Text>
                {order.map((key) => {
                  const col = COLUMN_DEFS.find((item) => item.key === key);
                  if (!col) return null;
                  return (
                    <Group
                      key={key}
                      gap={6}
                      wrap="nowrap"
                      onDragOver={(event) => {
                        if (!popDrag || popDrag === key) return;
                        event.preventDefault();
                        setPopOver(key);
                      }}
                      onDragLeave={() => setPopOver((prev) => (prev === key ? null : prev))}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (popDrag) moveCol(popDrag, key);
                        setPopDrag(null);
                        setPopOver(null);
                      }}
                      onDragEnd={() => {
                        setPopDrag(null);
                        setPopOver(null);
                      }}
                      style={{
                        cursor: 'grab',
                        opacity: popDrag === key ? 0.45 : 1,
                        boxShadow: popOver === key ? 'inset 2px 0 0 var(--ds-accent)' : undefined,
                        paddingLeft: 2,
                      }}
                    >
                      <div
                        draggable
                        onDragStart={() => setPopDrag(key)}
                        style={{ display: 'flex', cursor: 'grab', flex: 'none' }}
                        title="拖动调整列顺序"
                      >
                        <IconGripVertical size={13} stroke={1.8} color="var(--ds-text-faint)" />
                      </div>
                      <Checkbox
                        size="xs"
                        label={col.label}
                        checked={cols[key]}
                        onChange={() => toggleCol(key)}
                      />
                    </Group>
                  );
                })}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Group>

      <div ref={scrollRef} className="ds-scroll-area" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table
          layout="fixed"
          withColumnBorders
          stickyHeader
          stickyHeaderOffset={0}
          horizontalSpacing="sm"
          verticalSpacing={0}
          highlightOnHover={false}
          striped="odd"
          stripedColor="var(--ds-surface-hover)"
          styles={{
            table: {
              fontSize: 'var(--ds-fs-body)',
              width: '100%',
              // 列宽总和超过视口时才撑到真实宽度；border-collapse 让边框不额外占宽
              minWidth: effectiveMinWidth,
              borderCollapse: 'collapse',
            },
            // 表头吸顶：给不透明底色，滚动时下面的行不会透上来
            th: {
              position: 'sticky',
              top: 0,
              zIndex: 3,
              background: 'var(--ds-surface)',
            },
          }}
        >
          <Table.Thead>
            <Table.Tr key={orderVersion} className="ds-th-reorder">
              <Table.Th style={{ width: 56, paddingTop: 10, paddingBottom: 10 }}>
                <Group justify="center" gap={0}>
                  <Checkbox
                    size="sm"
                    aria-label="全选本页"
                    checked={allSelected}
                    indeterminate={!allSelected && paged.some((backup) => selected.has(backup.id))}
                    onChange={toggleAll}
                  />
                </Group>
              </Table.Th>
              {visibleCols.map((col) => (
                <Table.Th
                  key={col.key}
                  draggable
                  onDragStart={(event) => {
                    setDragCol(col.key);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => {
                    if (!dragCol || dragCol === col.key) return;
                    event.preventDefault();
                    setDropCol(col.key);
                  }}
                  onDragLeave={() => setDropCol((prev) => (prev === col.key ? null : prev))}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragCol) moveCol(dragCol, col.key);
                    setDragCol(null);
                    setDropCol(null);
                  }}
                  onDragEnd={() => {
                    setDragCol(null);
                    setDropCol(null);
                  }}
                  onClick={() => {
                    if (sortable(col.key)) toggleSort(col.key as 'time');
                  }}
                  style={{
                    width: cw(col.key, col.width),
                    textAlign: 'center',
                    position: 'relative',
                    userSelect: 'none',
                    cursor: 'grab',
                    paddingTop: 10,
                    paddingBottom: 10,
                    opacity: dragCol === col.key ? 0.4 : 1,
                    boxShadow: dropCol === col.key ? 'inset 2px 0 0 var(--ds-accent)' : undefined,
                    transition: 'opacity var(--ds-t-fast) ease',
                  }}
                >
                  {renderHeaderCell(col)}
                  <div
                    draggable={false}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      startDrag(event, col.key);
                    }}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: -3,
                      bottom: 2,
                      width: 7,
                      cursor: 'col-resize',
                      borderRadius: 3,
                      zIndex: 2,
                      background: 'transparent',
                      transition: 'background-color var(--ds-t-fast) ease',
                    }}
                    onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--ds-hairline)'; }}
                    onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
                  />
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {paged.map((backup) => {
              const latest = backup.id === newestId;
              const delta = (backup.day ?? 0) - (world.day ?? 0);
              const avatarChar = avatarKey(backup);
              return (
                <Table.Tr
                  key={backup.id}
                  className="ds-row"
                  data-latest={latest}
                  data-selected={selected.has(backup.id)}
                  onClick={() => setDetail(backup)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuPos({ x: event.clientX, y: event.clientY });
                    setRowMenu({ x: event.clientX, y: event.clientY, char: backup.character_id || backup.character, backup });
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td onClick={(event) => event.stopPropagation()}>
                    <Group justify="center" gap={0}>
                      <Checkbox
                        size="sm"
                        aria-label={`选择 ${backup.full_time}`}
                        checked={selected.has(backup.id)}
                        onChange={() => toggleOne(backup.id)}
                      />
                    </Group>
                  </Table.Td>
                  {visibleCols.map((col) => {
                    if (col.key === 'avatar') {
                      return (
                        <Table.Td key={col.key} style={{ width: cw('avatar', col.width), textAlign: 'center', verticalAlign: 'middle', paddingInline: 0 }}>
                          <HoverCard position="top" withArrow openDelay={150} closeDelay={150} shadow="md">
                            <HoverCard.Target>
                              <div style={{ display: 'inline-flex', cursor: 'default' }}>
                                <WorldAvatar character={avatarChar} label={backup.character_label} size={46} />
                              </div>
                            </HoverCard.Target>
                            <HoverCard.Dropdown p={8} style={{ background: 'var(--ds-surface)' }}>
                              {avatars[avatarChar] ? (
                                <img
                                  src={avatars[avatarChar]}
                                  alt={backup.character_label}
                                  width={128}
                                  height={128}
                                  style={{ borderRadius: 12, display: 'block' }}
                                />
                              ) : (
                                <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">{backup.character_label}</Text>
                              )}
                              {backup.save_id && world.save_id && backup.save_id !== world.save_id && (
                                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={6} ta="center">
                                  上一个世界的角色（当前世界是{world.character_label}）
                                </Text>
                              )}
                            </HoverCard.Dropdown>
                          </HoverCard>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'time') {
                      return (
                        <Table.Td
                          key={col.key}
                          style={{ width: cw(col.key, col.width), textAlign: 'center', paddingInline: 1 }}
                        >
                          <Text className="ds-mono" fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" style={{ whiteSpace: 'nowrap' }}>
                            <SearchMark text={backup.full_time} query={query} />
                          </Text>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'day') {
                      return (
                        <Table.Td key={col.key} style={{ width: cw(col.key, col.width), textAlign: 'center' }}>
                          <Text className="ds-mono" fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" style={{ whiteSpace: 'nowrap' }}>
                            {backup.day ?? '—'}
                            <Text span fz="var(--ds-fs-micro)" c="var(--ds-text-faint)"> 天</Text>
                          </Text>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'delta') {
                      return (
                        <Table.Td key={col.key} style={{ textAlign: 'center' }}>
                          {delta !== 0 ? (
                            <Tooltip withinPortal openDelay={200} label={`这份备份比当前存档${delta > 0 ? '多' : '少'} ${Math.abs(delta)} 天`}>
                              <Text
                                className="ds-mono"
                                fz="var(--ds-fs-micro)"
                                c={delta < 0 ? 'var(--ds-text-faint)' : 'var(--ds-danger)'}
                                style={{ whiteSpace: 'nowrap' }}
                              >
                                {delta > 0 ? '+' : '−'}{Math.abs(delta)}
                              </Text>
                            </Tooltip>
                          ) : (
                            <Tooltip withinPortal openDelay={200} label="与当前存档天数相同">
                              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">0 天</Text>
                            </Tooltip>
                          )}
                        </Table.Td>
                      );
                    }
                    if (col.key === 'tag') {
                      return (
                        <Table.Td key={col.key} style={{ verticalAlign: 'middle' }}>
                          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Tag
                              tag={backup.tag}
                              label={backup.tag_label}
                              matched={
                                Boolean(query.trim()) &&
                                [backup.tag_label, backup.tag].some((value) =>
                                  String(value).toLowerCase().includes(query.trim().toLowerCase()))
                              }
                            />
                          </div>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'ago') {
                      return (
                        <Table.Td key={col.key} style={{ textAlign: 'center' }}>
                          <Text
                            className="ds-mono"
                            fz="var(--ds-fs-micro)"
                            c="var(--ds-text-dim)"
                            style={{ whiteSpace: 'nowrap' }}
                            title={backup.full_time}
                          >
                            {formatAgoCompact(backup.full_time)}
                          </Text>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'mods') {
                      return (
                        <Table.Td key={col.key} style={{ textAlign: 'center' }}>
                          <Text className="ds-mono" fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" style={{ whiteSpace: 'nowrap' }}>
                            {backup.mods_count ?? 0}
                          </Text>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'compat') {
                      return (
                        <Table.Td key={col.key} style={{ textAlign: 'center' }}>
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" style={{ whiteSpace: 'nowrap' }}>
                            {backup.compatibility?.primary ?? '—'}
                          </Text>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'character') {
                      return (
                        <Table.Td key={col.key} style={{ textAlign: 'center' }}>
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" truncate>
                            {backup.character_label || backup.character || '—'}
                          </Text>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'world') {
                      return (
                        <Table.Td key={col.key} style={{ textAlign: 'center' }}>
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" truncate title={backup.current_world}>
                            {backup.current_world || '—'}
                          </Text>
                        </Table.Td>
                      );
                    }
                    if (col.key === 'note') {
                      return (
                        <Table.Td
                          key={col.key}
                          style={{ textAlign: 'center' }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setNoteDraft(backup.note ?? '');
                            setNoteEdit({ id: backup.id, label: backup.full_time });
                          }}
                        >
                          {backup.note ? (
                            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" truncate title={backup.note}>
                              <SearchMark text={backup.note} query={query} />
                            </Text>
                          ) : (
                            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">—</Text>
                          )}
                        </Table.Td>
                      );
                    }
                    return (
                      <Table.Td key={col.key} style={{ textAlign: 'center' }}>
                        <Text className="ds-mono" fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" style={{ whiteSpace: 'nowrap' }}>
                          {formatBytes(backup.size_bytes)}
                        </Text>
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </div>

      <Group justify="space-between" wrap="nowrap" pt="sm">
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
          共 {sorted.length} 份 · 第 {safePage}/{totalPages} 页
        </Text>
        <Group gap="sm" wrap="nowrap">
          <Select
            size="xs"
            w={104}
            value={String(pageSize)}
            onChange={(next) => {
              const size = Number(next) || 20;
              setPageSize(size);
              setPage(1);
              try {
                localStorage.setItem(PAGE_SIZE_KEY, String(size));
              } catch {
                /* 忽略 */
              }
            }}
            data={['5', '7', '10', '20', '50', '100'].map((value) => ({ value, label: `${value} 条/页` }))}
            allowDeselect={false}
          />
          <Pagination size="sm" color="accent" total={totalPages} value={safePage} onChange={setPage} siblings={1} />
        </Group>
      </Group>

      <BackupDetailModal backup={detail} onClose={() => setDetail(null)} />

      <BatchDeleteModal
        opened={batchConfirm}
        count={selected.size}
        running={batchRunning}
        onCancel={() => setBatchConfirm(false)}
        onConfirm={() => void runBatchDelete()}
      />

      {ioModal && (
        <ImportExportModal
          mode={ioModal.mode}
          ids={'ids' in ioModal ? ioModal.ids : []}
          onClose={() => setIoModal(null)}
        />
      )}

      <Menu
        opened={rowMenu !== null}
        onClose={() => setRowMenu(null)}
        position="bottom-start"
        withinPortal
        shadow="md"
      >
        <Menu.Dropdown style={{ position: 'fixed', left: menuPos.x, top: menuPos.y }}>
          <Menu.Label>头像</Menu.Label>
          <Menu.Item leftSection={<IconPhotoUp size={16} stroke={1.8} />} onClick={() => {
            if (rowMenu) startAvatarPicker(rowMenu.char);
            setRowMenu(null);
          }}>
            更新存档头像…
          </Menu.Item>
          <Menu.Item leftSection={<IconPhotoUp size={16} stroke={1.8} />} onClick={() => {
            if (rowMenu) void startAvatarUpload(rowMenu.char, false);
            setRowMenu(null);
          }}>
            上传本地图片…
          </Menu.Item>
          <Menu.Item leftSection={<IconArrowBackUp size={16} stroke={1.8} />} onClick={() => {
            if (!rowMenu) return;
            void getBridge()
              .then((bridge) => bridge.imageDelete('avatars', rowMenu.char))
              .then(() => refreshAvatars());
            setRowMenu(null);
          }}>
            恢复官方头像
          </Menu.Item>
          <Menu.Divider />
          <Menu.Label>操作</Menu.Label>
          <Menu.Item leftSection={<IconFolderSymlink size={16} stroke={1.8} />} onClick={() => {
            if (rowMenu) openRestore(rowMenu.backup);
            setRowMenu(null);
          }}>
            恢复到这份备份
          </Menu.Item>
          <Menu.Item leftSection={<IconFolderSymlink size={16} stroke={1.8} />} onClick={() => {
            if (rowMenu) void reveal('backup', rowMenu.backup.id);
            setRowMenu(null);
          }}>
            在资源管理器中定位
          </Menu.Item>
          <Menu.Item leftSection={<IconFileExport size={16} stroke={1.8} />} onClick={() => {
            if (rowMenu) setIoModal({ mode: 'export', ids: [rowMenu.backup.id] });
            setRowMenu(null);
          }}>
            导出这份备份…
          </Menu.Item>
          <Menu.Item color="red" leftSection={<IconTrash size={16} stroke={1.8} />} onClick={() => {
            if (rowMenu) openDelete(rowMenu.backup);
            setRowMenu(null);
          }}>
            删除这份备份
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Modal
        opened={noteEdit !== null}
        onClose={() => setNoteEdit(null)}
        title="备份备注"
        size={420}
        centered
        styles={{ content: { background: 'var(--ds-surface)' } }}
      >
        <Stack gap="sm">
          <Group gap={6} wrap="nowrap">
            <IconNote size={14} stroke={1.8} color="var(--ds-text-faint)" />
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" truncate>
              {noteEdit?.label}
            </Text>
          </Group>
          <Textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.currentTarget.value)}
            placeholder="例如：回档前 · 满背包 · 准备打巨鹿"
            autosize
            minRows={2}
            maxRows={6}
            maxLength={200}
            data-autofocus
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="sm" onClick={() => setNoteEdit(null)}>取消</Button>
            <Button size="sm" onClick={() => void saveNote()}>保存</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
