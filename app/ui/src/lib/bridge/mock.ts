import { ApiError } from '../errors';
import {
  computeStats,
  createBackups,
  createWorlds,
  DEFAULT_CONFIG,
  MOCK_SAVE_DIR,
  OPTIONS,
  recount,
  SAVE_DIRS,
  SAVE_CANDIDATES,
} from './fixtures';
import type {
  Backup,
  BootstrapData,
  Bridge,
  Config,
  DsEvent,
  PollResult,
  RestorePreview,
  Snapshot,
  World,
} from './types';

interface MockOptions {
  scenario?: 'default' | 'empty' | 'new';
  failOn?: string[];
  latency?: [number, number];
}

function nowStamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function createMock(options: MockOptions = {}): Bridge {
  const scenario = options.scenario ?? 'default';
  const failOn = new Set(options.failOn ?? []);
  const latency = options.latency ?? [30, 90];

  let worlds: World[] = scenario === 'empty' ? [] : createWorlds();
  let backups: Backup[] = scenario === 'default' ? createBackups() : [];
  worlds = recount(worlds, backups);
  let config: Config = { ...DEFAULT_CONFIG };
  let excludedCandidates: string[] = [];
  let selected: string | null = worlds[0]?.id ?? null;

  // 截图 / 联调用：?preset=ledger|nightfall|brass&mode=dark|light
  const params = new URLSearchParams(window.location.search);
  const presetParam = params.get('preset');
  if (presetParam === 'ledger' || presetParam === 'nightfall' || presetParam === 'brass') {
    config = { ...config, theme_preset: presetParam };
  }
  const modeParam = params.get('mode');
  if (modeParam === 'dark' || modeParam === 'light') {
    config = { ...config, theme_mode: modeParam };
  }

  const queue: DsEvent[] = [];
  let seq = 0;
  let jobSeq = 0;

  const wait = () => new Promise<void>((resolve) => {
    const [min, max] = latency;
    window.setTimeout(resolve, min + Math.random() * Math.max(1, max - min));
  });

  const emit = (type: string, payload: Record<string, unknown>) => {
    seq += 1;
    queue.push({ seq, ts: Date.now() / 1000, type, payload });
  };

  const stats = () => computeStats(backups);

  const findWorld = (id: string): World => {
    const world = worlds.find((item) => item.id === id);
    if (!world) throw new ApiError('E_UNKNOWN_SLOT', '这个世界已经不在存档里了', { slot: id });
    return world;
  };

  const findBackup = (id: string): Backup => {
    const backup = backups.find((item) => item.id === id);
    if (!backup) throw new ApiError('E_BACKUP_NOT_FOUND', '这份备份已经不在了', { id });
    return backup;
  };

  const refreshWorlds = () => {
    worlds = recount(worlds, backups);
  };

  const finishJob = (jobId: string, kind: string, extra: Record<string, unknown> = {}) => {
    emit('job.done', { job_id: jobId, kind, stats: stats(), ...extra });
    emit('data.backups_changed', { slot_id: selected ?? '' });
    emit('data.worlds_changed', {});
  };

  const runJob = (
    kind: 'backup' | 'restore' | 'delete_world',
    total: number,
    onFinish: (jobId: string) => void,
  ): string => {
    jobSeq += 1;
    const jobId = `j${jobSeq}`;
    emit('job.started', { job_id: jobId, kind, slot_id: selected });
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      emit('job.progress', {
        job_id: jobId,
        phase: kind === 'backup' ? 'copy' : 'restore',
        done: step,
        total,
        bytes_done: step * 240_000,
        bytes_total: total * 240_000,
        percent: Math.round((step / total) * 100),
      });
      if (step >= total) {
        window.clearInterval(timer);
        onFinish(jobId);
      }
    }, 180);
    return jobId;
  };

  const snapshot = (): Snapshot => ({
    save_dir: config.save_dir,
    save_dirs: SAVE_DIRS,
    worlds,
    selected_slot: selected,
    backups: selected ? backups.filter((item) => item.slot_id === selected) : [],
  });

  return {
    async bootstrap(): Promise<BootstrapData> {
      await wait();
      const scheme = config.theme_mode === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : config.theme_mode;
      return {
        version: '5.0.0-mock',
        event_seq: 0,
        config,
        defaults: { ...DEFAULT_CONFIG },
        options: OPTIONS,
        save_dir: config.save_dir,
        save_dirs: SAVE_DIRS,
        worlds,
        selected_slot: selected,
        backups: selected ? backups.filter((item) => item.slot_id === selected) : [],
        stats: stats(),
        auto_on: config.auto_backup,
        watcher: { state: config.auto_backup ? 'watching' : 'paused', last_tick_at: Date.now() / 1000 },
        warnings: [],
        platform: {
          app_dir: 'D:\\Tools\\ds-saver\\app',
          backup_root: config.backup_root,
          win_build: 26300,
          webview2: '155.0.4283.62',
          titlebar_dark: true,
          log_dir: 'C:\\Users\\admin\\AppData\\Local\\ds-saver\\logs',
          scheme,
        },
      };
    },

    async listWorlds() {
      await wait();
      return { worlds, selected_slot: selected };
    },

    async selectWorld(id: string) {
      await wait();
      const slot = findWorld(id);
      selected = id;
      return { slot, backups: backups.filter((item) => item.slot_id === id) };
    },

    async setSaveDir(path: string) {
      await wait();
      config = { ...config, save_dir: path };
      return snapshot();
    },

    async listSaveCandidates() {
      await wait();
      return {
        candidates: SAVE_CANDIDATES.filter((c) => !excludedCandidates.includes(c.path)),
        save_dir: config.save_dir,
        excluded: [...excludedCandidates],
      };
    },

    async excludeSaveCandidate(path: string) {
      await wait();
      if (!excludedCandidates.includes(path)) excludedCandidates.push(path);
      return {
        excluded: [...excludedCandidates],
        candidates: SAVE_CANDIDATES.filter((c) => !excludedCandidates.includes(c.path)),
      };
    },

    async restoreSaveCandidate(path: string) {
      await wait();
      excludedCandidates = excludedCandidates.filter((p) => p !== path);
      return {
        excluded: [...excludedCandidates],
        candidates: SAVE_CANDIDATES.filter((c) => !excludedCandidates.includes(c.path)),
      };
    },

    async openSettings() {
      await wait();
      return { opened: true };
    },

    async closeSettings() {
      await wait();
      return { closed: true };
    },

    async ackSettingsClose() {
      return { acked: true };
    },

    async revealDir(path: string) {
      await wait();
      return { opened: true, path };
    },

    async openModFolder(modId: string) {
      await wait();
      return { opened: true, path: `mock://mods/${modId}` };
    },

    async openUrl(url: string) {
      await wait();
      return { opened: true, url };
    },

    async avatarPreview() {
      await wait();
      return { items: [], cache_count: 0, cache_bytes: 0 };
    },

    async avatarDelete(name: string) {
      await wait();
      return { deleted: true, name };
    },

    async imageLibrary() {
      await wait();
      return {
        avatars: [{
          key: 'wilson',
          label: '威尔逊',
          url: '',
          active_source: 'auto',
          sources: [{ source: 'official', deletable: false }],
        }],
        modicons: [], fallback: [], cache_count: 1, cache_bytes: 4096,
      };
    },

    async imageDelete(category: string, key: string, _source?: string) {
      await wait();
      return { deleted: true, category, key };
    },

    async imageDeleteMany(_category: string, keys: string[]) {
      return { removed: keys.length, failed: [] as string[] };
    },

    async modiconsScan() {
      return { mods: 0, icons: 0 };
    },

    async modiconPreview() {
      return { url: '' };
    },

    async avatarUpload(char: string, _sourcePath: string, _displayName: string) {
      await wait();
      return { uploaded: true, char };
    },

    async avatarUploadAsset() {
      return { uploaded: false };
    },

    async avatarRenameAsset() {
      return { renamed: false };
    },

    async avatarSetName() {
      return { ok: false };
    },

    async avatarAssignFrom(char: string, sourceChar: string) {
      await wait();
      return { assigned: true, char, from: sourceChar };
    },

    async avatarClearLayer(layer: string) {
      await wait();
      return { removed: 3, layer };
    },

    async avatarPickImage() {
      await wait();
      return { picked: 'C:////mock////wilson.png', name: 'wilson' };
    },

    async getChangelog() {
      await wait();
      return { markdown: '# 更新日志\n\n## 1.0.0 - 2026-10-28\n\n**首个正式版本**\n\n### 新增\n- mock 示例条目' };
    },

    async backupMods(_id: string) {
      await wait();
      return { mods: [], mods_count: 0 };
    },

    async backupFiles(_id: string) {
      await wait();
      return {
        files: [
          { name: 'saveindex', size_bytes: 4096 },
          { name: 'session', size_bytes: 1_048_576 },
        ],
        total_bytes: 1_052_672,
      };
    },


    async backupOverview() {
      return {
        worlds: [], ungenerated: [], other_files: [], total_bytes: 0, file_count: 0,
        compatibility: { primary: '原版', requires: ['无 DLC'], chain: ['原版'] },
      };
    },

    async backupSetNote() {
      return { ok: true };
    },

    async filterOptions() {
      return { compat: [], world: [], character_groups: [] };
    },

    async avatarSetSource(char: string, source: string) {
      await wait();
      return { ok: true, char, source };
    },

    async pickFolder(kind: string) {
      await wait();
      return { path: kind === 'game_dir' ? 'E:////Games////SteamGames////steamapps////common////dont_starve' : SAVE_DIRS[1] };
    },

    async backup(slotId: string) {
      await wait();
      const world = findWorld(slotId);
      if (failOn.has('IO')) throw new ApiError('E_IO', '磁盘写入失败', { path: config.backup_root });
      const jobId = runJob('backup', 5, (id) => {
        const full = nowStamp();
        const [datePart, timePart] = full.split(' ');
        const stamp = `${datePart.replace(/-/g, '')}_${timePart.replace(/:/g, '')}`;
        const bytes = 1_420_000 + Math.floor(Math.random() * 90_000);
        const entry: Backup = {
          id: `${world.id}:${stamp}`,
          slot_id: world.id,
          dir_name: stamp,
          stamp,
          tag: 'manual',
          tag_label: '手动',
          character: world.character,
          character_id: world.character,
          character_label: world.character_label,
          time: `${datePart.slice(5)} ${timePart.slice(0, 5)}`,
          full_time: full,
          file_count: world.file_count + 1,
          size_bytes: bytes,
          total_mb: Math.round((bytes / 1048576) * 100) / 100,
          mode: world.mode_label,
          day: world.day,
          save_id: world.save_id,
          mods_count: 1,
          dlc: [],
          mode_days: { [world.mode]: world.day },
        };
        backups = [entry, ...backups];
        refreshWorlds();
        finishJob(id, 'backup', { slot_id: world.id, backup: entry });
      });
      return { job_id: jobId };
    },

    async pickFile(): Promise<{ paths: string[] }> {
      await wait();
      return { paths: [] };
    },

    async pickSaveFile(): Promise<{ path: string | null }> {
      await wait();
      return { path: null };
    },

    async exportBackups(): Promise<{ path: string; count: number; bytes: number }> {
      await wait();
      return { path: '', count: 0, bytes: 0 };
    },

    async importScan(): Promise<import('../bridge/types').ImportScan> {
      await wait();
      return { kind: 'zip', recognized: false, has_manifest: false, entries: [], unknown: [] };
    },

    async importBackup(): Promise<{ mode: string; slot_id: string }> {
      await wait();
      return { mode: 'backup', slot_id: '1' };
    },

    async previewRestore(id: string): Promise<RestorePreview> {
      await wait();
      const backup = findBackup(id);
      const world = findWorld(backup.slot_id);
      const warnings: string[] = [];
      if (backup.file_count < world.file_count + 1) {
        warnings.push('备份里的文件比当前少，恢复后部分地图进度可能不一致');
      }
      return {
        current_day: world.day,
        backup_day: backup.day,
        delta_days: backup.day === null ? null : backup.day - world.day,
        files: backup.file_count,
        bytes: backup.size_bytes,
        warnings,
        game_running: failOn.has('GAME_RUNNING'),
        slot_id: world.id,
      };
    },

    async restore(id: string) {
      await wait();
      if (failOn.has('GAME_RUNNING')) {
        throw new ApiError('E_GAME_RUNNING', '检测到饥荒正在运行，请先退出游戏再恢复');
      }
      const backup = findBackup(id);
      const world = findWorld(backup.slot_id);
      const jobId = runJob('restore', 4, (job) => {
        world.day = backup.day ?? world.day;
        backups = [{ ...backup, tag: 'pre', tag_label: '恢复前' }, ...backups];
        refreshWorlds();
        finishJob(job, 'restore', { slot_id: world.id, restored: backup.file_count });
      });
      return { job_id: jobId };
    },

    async deleteBackup(id: string) {
      await wait();
      const backup = findBackup(id);
      backups = backups.filter((item) => item.id !== id);
      refreshWorlds();
      emit('data.backups_changed', { slot_id: backup.slot_id });
      return {
        deleted: true,
        freed_bytes: backup.size_bytes,
        backups: backups.filter((item) => item.slot_id === backup.slot_id),
        stats: stats(),
      };
    },

    async cleanup(scope: string, slotId?: string) {
      await wait();
      const before = backups.length;
      const groups = new Map<string, Backup[]>();
      for (const backup of backups) {
        if (scope === 'slot' && slotId && backup.slot_id !== slotId) continue;
        const key = backup.slot_id;
        groups.set(key, [...(groups.get(key) ?? []), backup]);
      }
      const keepIds = new Set<string>();
      for (const [, items] of groups) {
        const manual = items.filter((item) => item.tag !== 'auto');
        const auto = items.filter((item) => item.tag === 'auto');
        manual.slice(0, config.keep).forEach((item) => keepIds.add(item.id));
        auto.slice(0, config.keep_auto).forEach((item) => keepIds.add(item.id));
      }
      backups = backups.filter((item) => keepIds.has(item.id));
      refreshWorlds();
      const removed = before - backups.length;
      emit('job.done', {
        job_id: `j${++jobSeq}`, kind: 'cleanup', removed, freed_bytes: removed * 1_400_000, stats: stats(),
      });
      emit('data.backups_changed', { slot_id: '' });
      return { job_id: null, removed, freed_bytes: removed * 1_400_000, stats: stats() };
    },

    async getSettings() {
      await wait();
      return { config, defaults: { ...DEFAULT_CONFIG }, options: OPTIONS };
    },

    async getStats() {
      await wait();
      return stats();
    },

    async saveSettings(patch: Partial<Config>) {
      await wait();
      if (failOn.has('CONFIG')) throw new ApiError('E_CONFIG', '配置写入失败');
      config = { ...config, ...patch };
      const scheme = config.theme_mode === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : config.theme_mode;
      emit('shell.color_scheme', { scheme, preset: config.theme_preset });
      return { config, applied: { color_scheme: scheme, preset: config.theme_preset } };
    },

    async previewChrome() {
      return { ok: true };
    },

    async systemScheme() {
      return { scheme: 'dark' as const };
    },

    async setAutoBackup(on: boolean) {
      await wait();
      config = { ...config, auto_backup: on };
      emit('watcher.state', {
        state: on ? 'starting' : 'paused',
        last_tick_at: Date.now() / 1000,
        auto_on: on,
      });
      return { auto_on: on };
    },

    async getAvatars(chars: string[]) {
      await wait();
      const known = ['wilson', 'wx78', 'waxwell', 'wolfgang', 'carney', 'walter'];
      const avatars: Record<string, string> = {};
      const missing: string[] = [];
      for (const char of chars) {
        if (known.includes(char)) avatars[char] = `/avatars/${char}.png`;
        else missing.push(char);
      }
      return { avatars, missing, available: true, elapsed_ms: 3 };
    },

    async refreshAvatars(chars?: string[]) {
      return this.getAvatars(chars ?? []);
    },

    async avatarDiagnostics() {
      return { roots: ['mock'], char_count: 6, layers: { base: 6 } };
    },

    async avatarLibrary() {
      await wait();
      return {
        char_count: 9,
        official_count: 8,
        upload_count: 0,
        mod_count: 1,
        missing: ['wanda'],
        cache_count: 9,
        cache_bytes: 421_000,
      };
    },

    async avatarRebuild() {
      await wait();
      const base = await this.avatarLibrary();
      return { ...base, removed: base.cache_count, elapsed_ms: 142 };
    },

    async pollEvents(sinceSeq: number): Promise<PollResult> {
      const events = queue.filter((event) => event.seq > sinceSeq);
      return { events, seq, lost_from: null };
    },

    async gameRunning() {
      await wait();
      return { running: failOn.has('GAME_RUNNING') };
    },

    async listBackups(slotId: string) {
      await wait();
      return { backups: backups.filter((item) => item.slot_id === slotId) };
    },

    async worldDetails(slotId: string) {
      await wait();
      const world = worlds.find((item) => item.id === slotId);
      if (!world) throw new ApiError('E_UNKNOWN_SLOT', '这个世界已经不在存档里了');
      return {
        ...world,
        last_played_at: Math.floor(Date.now() / 1000) - 3600 * 26,
        total_bytes: 1_874_000,
        total_mb: 1.79,
        worlds: [],
        ungenerated: [],
        other_files: [],
        compatibility: { primary: '巨人国', requires: [], chain: ['巨人国'] },
        dlc: ['reign_of_giants'],
        mod_ids: ['workshop-2369560337'],
        mods: [
          {
            id: 'workshop-2369560337',
            name: 'Show Me（.orig）',
            author: 'ski',
            version: '1.9.9',
            description: '鼠标悬停显示信息',
            icon: '',
            dir: '',
            resolved: true,
            enabled: true,
          },
        ],
        installed_mods: [
          {
            id: 'workshop-2369560337',
            name: 'Show Me（.orig）',
            author: 'ski',
            version: '1.9.9',
            description: '鼠标悬停显示信息',
            icon: '',
            dir: '',
            resolved: true,
            enabled: true,
          },
          {
            id: 'workshop-1204388403',
            name: 'Geometric Placement',
            author: 'rezecib',
            version: '2.1.1',
            description: '网格化放置',
            icon: '',
            dir: '',
            resolved: true,
            enabled: false,
          },
        ],
        mods_count: 1,
        mode_days: { [world.mode]: world.day },
        files: world.files.map((name, i) => ({
          name,
          size_bytes: 600_000 - i * 100_000,
          mtime: Math.floor(Date.now() / 1000) - 3600 * (i + 1),
        })),
      };
    },

    async deleteSave(slotId: string, deleteBackups: boolean) {
      await wait();
      if (failOn.has('GAME_RUNNING')) {
        throw new ApiError('E_GAME_RUNNING', '检测到饥荒正在运行，请先退出游戏再删除存档');
      }
      const world = worlds.find((item) => item.id === slotId);
      if (!world) throw new ApiError('E_UNKNOWN_SLOT', '这个世界已经不在存档里了');
      const jobId = runJob('delete_world', 3, (job) => {
        if (deleteBackups) {
          backups = backups.filter((item) => item.slot_id !== slotId);
        }
        worlds = worlds.filter((item) => item.id !== slotId);
        if (selected === slotId) selected = worlds[0]?.id ?? null;
        finishJob(job, 'delete_world', {
          slot_id: slotId,
          moved: 3,
          removed_backups: deleteBackups ? 2 : 0,
          freed_backups: deleteBackups ? 2_800_000 : 0,
        });
        emit('data.worlds_changed', {});
      });
      return { job_id: jobId };
    },

    async cancelJob() {
      return { cancelled: false };
    },

    async revealPath() {
      return { opened: true };
    },

    async windowAction() {
      return { handled: true };
    },

    async quitApp() {
      return { quitting: true };
    },
  };
}

export const MOCK_DEFAULT_SAVE_DIR = MOCK_SAVE_DIR;
