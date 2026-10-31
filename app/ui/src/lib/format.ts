import type { Backup } from './bridge/types';

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function parseWhen(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalised = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelative(value: string | null | undefined): string {
  const date = parseWhen(value);
  if (!date) return '从未备份';
  const diff = Date.now() - date.getTime();
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return '昨天';
  if (diff < 604_800_000) return `${Math.round(diff / 86_400_000)} 天前`;
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatClock(value: string | null | undefined): string {
  const date = parseWhen(value);
  if (!date) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function dayKey(value: string): string {
  const date = parseWhen(value);
  if (!date) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function dayLabel(value: string): string {
  const date = parseWhen(value);
  if (!date) return '未知日期';
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((midnight - target) / 86_400_000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${WEEKDAYS[date.getDay()]}`;
}

export interface BackupGroup {
  key: string;
  label: string;
  items: Backup[];
}

export function groupBackups(backups: Backup[]): BackupGroup[] {
  const groups: BackupGroup[] = [];
  for (const backup of backups) {
    const key = dayKey(backup.full_time);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(backup);
    } else {
      groups.push({ key, label: dayLabel(backup.full_time), items: [backup] });
    }
  }
  return groups;
}

/** save_id 数字 → "YYYY-MM-DD"；不在合理 Unix 区间返回 null */
export function saveIdDate(saveId: string): string | null {
  const n = Number(saveId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const sec = n >= 1e12 && n < 2e12 ? n / 1000 : n >= 1e9 && n < 2e9 ? n : null;
  if (sec === null) return null;
  const date = new Date(sec * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface PlaythroughGroup {
  /** 第几个周目（1 起，最老的排第 1）；0 = save_id 未知的散组 */
  index: number;
  save_id: string;
  created_date: string;
  count: number;
  groups: BackupGroup[];
}

/** 外层按 save_id 分周目（与后端 models.group_playthroughs 同规则），内层保留按天分组 */
export function groupPlaythroughs(backups: Backup[]): PlaythroughGroup[] {
  const byKey = new Map<string, Backup[]>();
  const order: string[] = [];
  for (const backup of backups) {
    const key = backup.save_id || '__unknown__';
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(backup);
  }

  const unknown = order.filter((key) => key === '__unknown__');
  const known = order.filter((key) => key !== '__unknown__');
  known.sort((a, b) => {
    const aOldest = byKey.get(a)![byKey.get(a)!.length - 1].stamp;
    const bOldest = byKey.get(b)![byKey.get(b)!.length - 1].stamp;
    return aOldest < bOldest ? -1 : aOldest > bOldest ? 1 : 0;
  });

  const result: PlaythroughGroup[] = [];
  let index = 1;
  for (const key of [...known, ...unknown]) {
    const items = byKey.get(key)!;
    const oldest = items[items.length - 1]; // 列表新→旧，末尾是组里最旧的
    const isUnknown = key === '__unknown__';
    result.push({
      index: isUnknown ? 0 : index++,
      save_id: isUnknown ? '' : key,
      created_date: saveIdDate(key) ?? dayLabel(oldest.full_time),
      count: items.length,
      groups: groupBackups(items),
    });
  }
  return result;
}

export function tailPath(path: string, segments = 2): string {
  if (!path) return '未选择存档目录';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-segments).join('\\');
}

/** Windows 路径显示规范化：盘符大写（d: → D:）。 */
export function normalizeWinPath(path: string): string {
  if (!path) return '';
  return path.replace(/^([a-z]):/, (_m, drive: string) => `${drive.toUpperCase()}:`);
}

/** 保留首段（盘符/根）+ 末 tail 段，中段压缩为 …；段数不多时原样返回。盘符统一大写。 */
export function compactPath(path: string, tail = 3): string {
  if (!path) return '';
  const parts = normalizeWinPath(path).split(/[\\/]/).filter(Boolean);
  if (parts.length <= tail + 2) return normalizeWinPath(path);
  return `${parts[0]}\\…\\${parts.slice(-tail).join('\\')}`;
}

const DLC_SET = ['巨人国', '海难', '哈姆雷特'] as const;

/** DLC 兼容性集合式命名：主名（mode）+ 启用 DLC 去重拼接。 */
export function dlcComboLabel(modeLabel: string, dlc: string[]): string {
  const enabled = DLC_SET.filter((name) => dlc.includes(name));
  const parts = [modeLabel || '未知', ...enabled.filter((name) => name !== modeLabel)];
  return Array.from(new Set(parts)).join('+');
}

/** 三大 DLC 全启用 → 「全 DLC」徽章。 */
export function isFullDlc(dlc: string[]): boolean {
  return DLC_SET.every((name) => dlc.includes(name));
}

export function modeIconName(mode: string): string {
  switch (mode) {
    case 'shipwrecked':
      return 'sailboat';
    case 'porkland':
      return 'castle';
    case 'cave':
      return 'mountain';
    case 'volcano':
      return 'volcano';
    case 'adventure':
      return 'map';
    case 'screecher':
      return 'ghost';
    default:
      return 'tree';
  }
}

export function initialOf(label: string): string {
  return (label || '?').replace(/^机器人/, '').slice(0, 1);
}


/** 紧凑的“距今”：一个月以上改用 个月/年，避免 "123 天前" 这种长串 */
export function formatAgoCompact(value: string | null | undefined): string {
  const date = parseWhen(value);
  if (!date) return '—';
  const diff = Date.now() - date.getTime();
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月`;
  return `${Math.floor(months / 12)} 年`;
}
