import type { Backup, BackupTag, Config, Options, Stats, World } from './types';

export const MOCK_SAVE_DIR = 'D:\\Software\\Steam\\userdata\\1222722443\\219740\\remote';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function makeTime(daysAgo: number, hour: number, minute: number, second = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, second, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function makeBackup(
  slotId: string,
  daysAgo: number,
  hour: number,
  minute: number,
  second: number,
  tag: BackupTag,
  day: number,
  character: string,
  mode: string,
  saveId = '1700000000',
): Backup {
  const full = makeTime(daysAgo, hour, minute, second);
  const [datePart, timePart] = full.split(' ');
  const stamp = `${datePart.replace(/-/g, '')}_${timePart.replace(/:/g, '')}`;
  const suffix = tag === 'auto' ? '_auto' : tag === 'pre' ? '_pre' : '';
  const dirName = `${stamp}${suffix}`;
  const bytes = 1_350_000 + ((second * 7919) % 320_000);
  return {
    id: `${slotId}:${dirName}`,
    slot_id: slotId,
    dir_name: dirName,
    stamp,
    tag,
    tag_label: tag === 'auto' ? '自动' : tag === 'pre' ? '恢复前' : '手动',
    time: `${datePart.slice(5)} ${timePart.slice(0, 5)}`,
    full_time: full,
    file_count: 5,
    size_bytes: bytes,
    total_mb: Math.round((bytes / 1048576) * 100) / 100,
    character,
    character_id: character,
    character_label: character === 'wilson' ? '威尔逊' : character === 'wx78' ? '机器人WX-78' : character,
    mode,
    day,
    save_id: saveId,
    mods_count: 2,
    dlc: ['reign_of_giants'],
    mode_days: { [mode]: day },
  };
}

export function createWorlds(): World[] {
  return [
    {
      id: '1', character: 'wilson', character_label: '威尔逊', mode: 'survival', mode_label: '巨人国',
      day: 274, files: ['cave_1_1_1', 'survival_1'], file_count: 2,
      display: '槽位1 - 威尔逊 - 巨人国 - 274天',
      backup_count: 0, backup_bytes: 0, last_backup_at: null,
      save_id: '1700000000', created_at: 1700000000,
    },
    {
      id: '2', character: 'wx78', character_label: '机器人WX-78', mode: 'shipwrecked', mode_label: '海难',
      day: 555, files: ['shipwrecked_2', 'volcano_2'], file_count: 2,
      display: '槽位2 - 机器人WX-78 - 海难 - 555天',
      backup_count: 0, backup_bytes: 0, last_backup_at: null,
      save_id: '1695000000', created_at: 1695000000,
    },
    {
      id: '3', character: 'wilson', character_label: '威尔逊', mode: 'porkland', mode_label: '哈姆雷特',
      day: 8, files: ['porkland_3'], file_count: 1,
      display: '槽位3 - 威尔逊 - 哈姆雷特 - 8天',
      backup_count: 0, backup_bytes: 0, last_backup_at: null,
      save_id: '1720000000', created_at: 1720000000,
    },
    {
      id: 'screecher', character: 'wilson', character_label: '威尔逊', mode: 'survival', mode_label: '惊魂夜',
      day: 1, files: ['survival_screecher'], file_count: 1,
      display: 'screecher - 威尔逊 - 惊魂夜 - 1天',
      backup_count: 0, backup_bytes: 0, last_backup_at: null,
      save_id: '', created_at: null,
    },
  ];
}

export function createBackups(): Backup[] {
  const list: Backup[] = [
    makeBackup('1', 0, 11, 42, 9, 'manual', 274, '威尔逊', '巨人国'),
    makeBackup('1', 0, 10, 18, 31, 'auto', 274, '威尔逊', '巨人国'),
    makeBackup('1', 0, 9, 55, 12, 'auto', 273, '威尔逊', '巨人国'),
    makeBackup('1', 1, 22, 10, 5, 'pre', 271, '威尔逊', '巨人国'),
    makeBackup('1', 1, 21, 48, 44, 'manual', 271, '威尔逊', '巨人国'),
    makeBackup('1', 1, 20, 12, 18, 'auto', 270, '威尔逊', '巨人国'),
    makeBackup('1', 2, 19, 5, 2, 'manual', 266, '威尔逊', '巨人国'),
    // 更早的两份属于上一个周目（同槽位重开世界，save_id 变了）
    makeBackup('1', 2, 18, 40, 27, 'auto', 31, '威尔逊', '巨人国', '1690000000'),
    makeBackup('1', 3, 15, 22, 51, 'manual', 12, '威尔逊', '巨人国', '1690000000'),
    makeBackup('2', 0, 9, 2, 33, 'auto', 555, '机器人WX-78', '海难', '1695000000'),
    makeBackup('2', 1, 23, 31, 7, 'manual', 553, '机器人WX-78', '海难', '1695000000'),
    makeBackup('2', 2, 17, 9, 45, 'manual', 550, '机器人WX-78', '海难', '1695000000'),
    makeBackup('2', 4, 12, 3, 16, 'auto', 549, '机器人WX-78', '海难', '1695000000'),
    makeBackup('3', 1, 14, 27, 39, 'manual', 8, '威尔逊', '哈姆雷特', '1720000000'),
  ];
  return list.sort((a, b) => (a.full_time < b.full_time ? 1 : -1));
}

export function recount(worlds: World[], backups: Backup[]): World[] {
  return worlds.map((world) => {
    const own = backups.filter((backup) => backup.slot_id === world.id);
    return {
      ...world,
      backup_count: own.length,
      backup_bytes: own.reduce((sum, item) => sum + item.size_bytes, 0),
      last_backup_at: own[0]?.full_time?.replace(' ', 'T') ?? null,
    };
  });
}

export function computeStats(backups: Backup[]): Stats {
  const perSlot: Stats['per_slot'] = {};
  for (const backup of backups) {
    const entry = perSlot[backup.slot_id] ?? { bytes: 0, count: 0 };
    entry.bytes += backup.size_bytes;
    entry.count += 1;
    perSlot[backup.slot_id] = entry;
  }
  return {
    total_bytes: backups.reduce((sum, item) => sum + item.size_bytes, 0),
    count: backups.length,
    per_slot: perSlot,
  };
}

export const DEFAULT_CONFIG: Config = {
  config_version: 2,
  theme_mode: 'auto',
  theme_preset: 'nightfall',
  font_size: 17,
  backup_root: 'data/backups',
  excluded_candidates: [],
  keep: 10,
  keep_auto: 5,
  keep_mode: 'count',
  keep_days_manual: 0,
  keep_days_auto: 0,
  auto_backup: true,
  auto_mode: 'change',
  auto_interval_min: 30,
  auto_min_gap_min: 5,
  auto_only_when_running: false,
  close_action: 'tray',
  save_dir: MOCK_SAVE_DIR,
  game_dir: '',
};

export const OPTIONS: Options = {
  auto_mode: [
    { value: 'change', label: '变化时', hint: '存档写完就快照' },
    { value: 'interval', label: '固定间隔', hint: '每隔 N 分钟一份' },
    { value: 'both', label: '两者', hint: '变化时 + 固定间隔' },
  ],
  keep_mode: [
    { value: 'count', label: '按份数', hint: '只看保留几份' },
    { value: 'days', label: '按天数', hint: '超龄且超份数才删' },
  ],
  theme_mode: [
    { value: 'auto', label: '跟随系统' },
    { value: 'dark', label: '暗色' },
    { value: 'light', label: '亮色' },
  ],
  theme_preset: [
    { value: 'nightfall', label: '夜航', hint: '冷灰石墨 · 月光青' },
    { value: 'ledger', label: '野外手账', hint: '暖炭纸白 · 发丝线' },
    { value: 'brass', label: '暗铜机械', hint: '墨绿黑 · 黄铜' },
  ],
  font_size: [
    { value: 15, label: '小' },
    { value: 17, label: '标准' },
    { value: 19, label: '大' },
  ],
  close_action: [
    { value: 'ask', label: '每次询问' },
    { value: 'tray', label: '隐藏到托盘' },
    { value: 'exit', label: '直接退出' },
  ],
};

export const SAVE_DIRS = [
  MOCK_SAVE_DIR,
  'C:\\Users\\admin\\Documents\\Klei\\DoNotStarve\\save',
];

export const SAVE_CANDIDATES = [
  {
    path: MOCK_SAVE_DIR,
    source: 'steam' as const,
    account: '玩家甲',
    has_saveindex: true,
    world_count: 4,
    last_modified: Math.floor(Date.now() / 1000) - 3600,
  },
  {
    path: 'D:\\Steam\\userdata\\5599112\\219740\\remote',
    source: 'steam' as const,
    account: '备用小号',
    has_saveindex: false,
    world_count: null,
    last_modified: null,
  },
  {
    path: 'C:\\Users\\admin\\Documents\\Klei\\DoNotStarve\\save',
    source: 'documents' as const,
    account: '本机文档目录',
    has_saveindex: false,
    world_count: null,
    last_modified: null,
  },
  {
    path: 'D:\\Software\\Steam\\userdata\\1222722443\\219740\\remote',
    source: 'steam' as const,
    account: '超长路径玩家',
    has_saveindex: true,
    world_count: 2,
    last_modified: Math.floor(Date.now() / 1000) - 86400,
  },
];

/** 超长路径样本：验证 compactPath 中段省略与 HoverCard 完整路径 */
export const SAVE_CANDIDATES_LONG = [
  {
    path: 'D:\\Software\\Steam\\userdata\\1222722443\\219740\\remote',
    source: 'steam' as const,
    account: '超长路径玩家',
    has_saveindex: true,
    world_count: 2,
    last_modified: Math.floor(Date.now() / 1000) - 86400,
  },
];

export function fixtureTitle(): string {
  return '饥荒存档备份工具';
}
