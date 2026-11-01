export type ThemePreset = 'ledger' | 'nightfall' | 'brass';
export type ThemeMode = 'auto' | 'dark' | 'light';
export type ColorScheme = 'light' | 'dark';
export type BackupTag = 'manual' | 'auto' | 'pre' | 'autosave' | 'autoexit' | 'tick' | 'import';

export interface World {
  id: string;
  /** slot=普通数字槽 / screecher=尖啸者总转换 mod / other=其他非数字槽 */
  kind?: 'slot' | 'screecher' | 'other';
  mods_count?: number;
  dlc?: string[];
  character: string;
  character_label: string;
  mode: string;
  mode_label: string;
  day: number;
  files: string[];
  file_count: number;
  display: string;
  backup_count: number;
  backup_bytes: number;
  last_backup_at: string | null;
  save_id: string;
  created_at: number | null;
}

export interface ModInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  icon: string;
  dir: string;
  resolved: boolean;
  /** 当前存档是否启用（详情页由后端标记） */
  enabled?: boolean;
}

export interface WorldFileInfo {
  name: string;
  size_bytes: number;
  mtime: number;
}

export interface WorldDetails extends Omit<World, 'files'> {
  last_played_at: number | null;
  total_bytes: number;
  total_mb: number;
  dlc: string[];
  mod_ids: string[];
  mods: ModInfo[];
  /** 全部已安装（含未启用） */
  installed_mods: ModInfo[];
  mods_count: number;
  mode_days: Record<string, number>;
  files: WorldFileInfo[];
  /** 世界列表 / 未生成世界 / 其他文件（后端 classify_worlds） */
  worlds: BackupWorld[];
  ungenerated: string[];
  other_files: Array<{ name: string; size_bytes: number }>;
  compatibility: { primary: string; requires: string[]; chain: string[] };
}

export interface ImportScanEntry {
  key: string;
  label: string;
  slot_id: string | null;
  files: string[];
  file_count: number;
  bytes: number;
  has_saveindex: boolean;
}

export interface ImportScan {
  kind: string;
  recognized: boolean;
  has_manifest: boolean;
  entries: ImportScanEntry[];
  unknown: string[];
}

export interface FilterOptions {
  compat: string[];
  world: string[];
  character_groups: Array<{ key: string; label: string; items: Array<{ key: string; label: string }> }>;
}

export interface Backup {
  id: string;
  slot_id: string;
  dir_name: string;
  stamp: string;
  tag: BackupTag;
  tag_label: string;
  time: string;
  full_time: string;
  file_count: number;
  size_bytes: number;
  total_mb: number;
  character: string;
  character_id: string;
  character_label: string;
  mode: string;
  day: number | null;
  save_id: string;
  mods_count: number;
  dlc: string[];
  mode_days: Record<string, number>;
  compatibility?: { primary: string; requires: string[]; chain: string[] };
  /** 角色当时所在的具体世界 */
  current_world?: string;
  /** 用户备注（存在程序数据目录） */
  note?: string;
}

export interface SaveCandidate {
  path: string;
  source: 'steam' | 'documents';
  account: string;
  has_saveindex: boolean;
  world_count: number | null;
  last_modified: number | null;
}

/** 按 save_id 分出来的周目组，index=0 表示 save_id 未知的散组 */
export interface Playthrough {
  index: number;
  save_id: string;
  created_date: string;
  backups: Backup[];
}

export interface Stats {
  total_bytes: number;
  count: number;
  per_slot: Record<string, { bytes: number; count: number }>;
}

export interface ImageItem {
  key: string;
  url: string;
  path: string;
  size: number;
}

/** 角色头像的多来源视图：official/upload/mod 层 + per 角色切换 */
export interface AvatarItem {
  key: string;
  label: string;
  url: string;
  active_source: string; // 'auto' 或 'upload'/'official'/'mod'
  sources: Array<{ source: string; deletable: boolean }>;
}

export interface ImageLibraryResult {
  avatars: AvatarItem[];
  modicons: ImageItem[];
  fallback: ImageItem[];
  cache_count: number;
  cache_bytes: number;
}

export interface Config {
  config_version: number;
  theme_mode: ThemeMode;
  theme_preset: ThemePreset;
  font_size: number; // 15-19 预设档 + 14-22 自定义（后端 normalize 钳制）
  backup_root: string;
  excluded_candidates: string[];
  keep: number;
  keep_auto: number;
  keep_mode: 'count' | 'days';
  keep_days_manual: number;
  keep_days_auto: number;
  auto_backup: boolean;
  auto_mode: 'change' | 'interval' | 'both';
  auto_interval_min: number;
  auto_min_gap_min: number;
  auto_only_when_running: boolean;
  close_action: 'ask' | 'tray' | 'exit';
  save_dir: string;
  game_dir: string;
}

export interface Option<T = string> {
  value: T;
  label: string;
  hint?: string;
}

export interface Options {
  auto_mode: Option<Config['auto_mode']>[];
  keep_mode: Option<Config['keep_mode']>[];
  theme_mode: Option<ThemeMode>[];
  theme_preset: Option<ThemePreset>[];
  font_size: Option<number>[];
  close_action: Option<Config['close_action']>[];
}

export interface PlatformInfo {
  app_dir: string;
  backup_root: string;
  win_build: number;
  webview2: string;
  titlebar_dark: boolean;
  log_dir: string;
  /** 自动检测到的游戏目录（配置留空时实际用的那个） */
  game_dir_auto?: string;
  chrome?: { dark: boolean; caption: boolean; text: boolean; border: boolean };
  scheme: ColorScheme;
}

export interface WatcherState {
  /** idle=等待存档目录 / paused=已关闭 / starting=启动中（黄）/ watching=巡检正常（绿）/ error=巡检异常（红） */
  state: 'idle' | 'watching' | 'paused' | 'starting' | 'error';
  last_tick_at: number;
  /** state=error 时的异常摘要 */
  error?: string | null;
  auto_on?: boolean;
  next_due_at?: number | null;
}

export interface BootstrapData {
  version: string;
  event_seq: number;
  config: Config;
  defaults: Config;
  options: Options;
  save_dir: string;
  save_dirs: string[];
  worlds: World[];
  selected_slot: string | null;
  backups: Backup[];
  stats: Stats;
  auto_on: boolean;
  watcher: WatcherState;
  warnings: string[];
  platform: PlatformInfo;
}

export interface Snapshot {
  save_dir: string;
  save_dirs: string[];
  worlds: World[];
  selected_slot: string | null;
  backups: Backup[];
}

export interface RestorePreview {
  current_day: number;
  backup_day: number | null;
  delta_days: number | null;
  files: number;
  bytes: number;
  warnings: string[];
  game_running: boolean;
  slot_id: string;
}

export interface AvatarResult {
  avatars: Record<string, string>;
  missing: string[];
  available: boolean;
  elapsed_ms: number;
  removed?: number;
}

export interface AvatarLibrary {
  char_count: number;
  official_count: number;
  upload_count: number;
  mod_count: number;
  missing: string[];
  cache_count: number;
  cache_bytes: number;
}

export interface DsEvent {
  seq: number;
  ts: number;
  type: string;
  payload: Record<string, any>;
}

export interface PollResult {
  events: DsEvent[];
  seq: number;
  lost_from: number | null;
}

export interface Job {
  id: string;
  kind: 'backup' | 'restore' | 'cleanup' | 'delete_world';
  phase?: string;
  percent: number;
  done: number;
  total: number;
  bytes_done: number;
  bytes_total: number;
}

/** 前端这一层只看到"数据或异常"，信封由 api.ts 统一拆掉 */
export interface Bridge {
  bootstrap(): Promise<BootstrapData>;
  listWorlds(): Promise<{ worlds: World[]; selected_slot: string | null }>;
  selectWorld(id: string): Promise<{ slot: World; backups: Backup[] }>;
  setSaveDir(path: string): Promise<Snapshot>;
  pickFolder(kind: 'save_dir' | 'backup_root' | 'game_dir'): Promise<{ path: string | null }>;
  backup(slotId: string, tag?: 'manual' | 'auto'): Promise<{ job_id: string }>;
  previewRestore(id: string): Promise<RestorePreview>;
  pickFile(allowMultiple?: boolean, fileTypes?: string[]): Promise<{ paths: string[] }>;
  pickSaveFile(defaultName?: string): Promise<{ path: string | null }>;
  exportBackups(backupIds: string[], destPath: string): Promise<{ path: string; count: number; bytes: number }>;
  importScan(path: string): Promise<ImportScan>;
  importBackup(path: string, mode: 'backup' | 'save', entryKey?: string): Promise<{ mode: string; slot_id: string }>;
  restore(id: string, confirmedIdle?: boolean): Promise<{ job_id: string }>;
  deleteBackup(id: string): Promise<{ deleted: boolean; freed_bytes: number; backups: Backup[]; stats: Stats }>;
  cleanup(scope: 'all' | 'slot', slotId?: string): Promise<{
    job_id: string | null;
    removed?: number;
    freed_bytes?: number;
    stats: Stats;
  }>;
  getSettings(): Promise<{ config: Config; defaults: Config; options: Options }>;
  getStats(): Promise<Stats>;
  saveSettings(patch: Partial<Config>): Promise<{ config: Config; applied: Record<string, any> }>;
  setAutoBackup(on: boolean): Promise<{ auto_on: boolean }>;
  /** 设置页即时预览：只染标题栏，不落盘 */
  previewChrome(preset: string, scheme: 'light' | 'dark'): Promise<{ ok: boolean }>;
  /** 系统当前明暗（"跟随系统"预览用，与配置无关） */
  systemScheme(): Promise<{ scheme: 'light' | 'dark' }>;
  getAvatars(chars: string[]): Promise<AvatarResult>;
  refreshAvatars(chars?: string[]): Promise<AvatarResult>;
  avatarDiagnostics(): Promise<Record<string, unknown>>;
  avatarLibrary(): Promise<AvatarLibrary>;
  avatarRebuild(): Promise<AvatarLibrary & { removed: number; elapsed_ms: number }>;
  pollEvents(sinceSeq: number): Promise<PollResult>;
  cancelJob(id: string): Promise<{ cancelled: boolean }>;
  gameRunning(): Promise<{ running: boolean }>;
  listBackups(slotId: string): Promise<{ backups: Backup[] }>;
  worldDetails(slotId: string): Promise<WorldDetails>;
  listSaveCandidates(): Promise<{ candidates: SaveCandidate[]; save_dir: string; excluded: string[] }>;
  excludeSaveCandidate(path: string): Promise<{ excluded: string[]; candidates: SaveCandidate[] }>;
  restoreSaveCandidate(path: string): Promise<{ excluded: string[]; candidates: SaveCandidate[] }>;
  openSettings(): Promise<{ opened: boolean }>;
  closeSettings(): Promise<{ closed: boolean }>;
  ackSettingsClose(): Promise<{ acked: boolean }>;
  openModFolder(modId: string): Promise<{ opened: boolean }>;
  openUrl(url: string): Promise<{ opened: boolean }>;
  revealDir(path: string): Promise<{ opened: boolean }>;
  avatarPreview(): Promise<{ items: Array<{ char: string; url: string; missing: boolean; group: string }>; cache_count: number; cache_bytes: number }>;
  avatarDelete(name: string): Promise<{ deleted: boolean }>;
  imageLibrary(): Promise<ImageLibraryResult>;
  imageDelete(category: string, key: string, source?: string): Promise<{ deleted: boolean }>;
  imageDeleteMany(category: string, keys: string[]): Promise<{ removed: number; failed: string[] }>;
  /** 重扫 Mod 图标缓存 */
  modiconsScan(): Promise<{ mods: number; icons: number }>;
  /** 悬停预览：按需返回最多 256px 的图标大图 dataURL（原图太小时为空串） */
  modiconPreview(modId: string): Promise<{ url: string }>;
  backupFiles(id: string): Promise<{ files: Array<{ name: string; size_bytes: number }>; total_bytes: number }>;
  /** 备份详情概览：世界列表 / 兼容性 / 未生成世界 / 其他文件 */
  backupOverview(id: string): Promise<BackupOverview>;
  /** 写/清备份备注（存在程序数据目录） */
  backupSetNote(id: string, note: string): Promise<{ ok: boolean; id?: string; note?: string }>;
  /** 表格筛选项 */
  filterOptions(): Promise<FilterOptions>;
  backupMods(id: string): Promise<{ mods: ModInfo[]; mods_count: number }>;
  avatarUpload(char: string, sourcePath: string, displayName: string): Promise<{ uploaded: boolean; char?: string }>;
  /** 上传一张头像素材到图片库（不绑定角色） */
  avatarUploadAsset(sourcePath: string, name: string): Promise<{ uploaded: boolean; key?: string; name?: string }>;
  /** 重命名上传版素材 */
  avatarRenameAsset(key: string, name: string): Promise<{ renamed: boolean; key?: string; name?: string }>;
  /** 重命名角色（含它的上传层）显示名 */
  avatarSetName(char: string, name: string): Promise<{ ok: boolean; char?: string; label?: string }>;
  avatarSetSource(char: string, source: string): Promise<{ ok: boolean }>;
  avatarPickImage(): Promise<{ picked: string; name: string }>;
  avatarClearLayer(layer: string): Promise<{ removed: number }>;
  avatarAssignFrom(char: string, sourceChar: string): Promise<{ assigned: boolean; char?: string; from?: string }>;
  getChangelog(): Promise<{ markdown: string }>;
  deleteSave(slotId: string, deleteBackups: boolean): Promise<{ job_id: string | null }>;
  undoLast(): Promise<{ kind: string; label: string; slot_id?: string; stats?: unknown }>;
  orphanBackups(): Promise<{ items: Backup[] }>;
  revealPath(kind: 'backup_root' | 'backup' | 'save_dir' | 'log_dir', backupId?: string): Promise<{ opened: boolean }>;
  windowAction(action: 'minimize' | 'hide' | 'close'): Promise<{ handled: boolean }>;
  quitApp(): Promise<{ quitting: boolean }>;
}


export interface BackupWorld {
  type: 'survival' | 'cave' | 'shipwrecked' | 'volcano' | 'porkland' | 'adventure' | 'screecher' | string;
  label: string;
  index: number;
  level: number;
  day: number | null;
  file: string;
  size_bytes: number;
}

export interface BackupOverview {
  worlds: BackupWorld[];
  ungenerated: string[];
  other_files: Array<{ name: string; size_bytes: number }>;
  total_bytes: number;
  file_count: number;
  compatibility: { primary: string; requires: string[]; chain: string[] };
}
