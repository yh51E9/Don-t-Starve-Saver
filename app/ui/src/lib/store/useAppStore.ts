import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import { createElement } from 'react';
import { create } from 'zustand';

import { clearPreview, publishPreview } from '../preview';

import { getBridge, isNativeBridge } from '../bridge/api';
import type {
  Backup,
  BootstrapData,
  ColorScheme,
  Config,
  DsEvent,
  Job,
  Options,
  PlatformInfo,
  RestorePreview,
  Stats,
  WatcherState,
  World,
  WorldDetails,
} from '../bridge/types';
import { errorText } from '../errors';

export type View = 'worlds' | 'settings';

export type DialogState =
  | null
  | { kind: 'restore'; backup: Backup; preview: RestorePreview | null; loading: boolean }
  | { kind: 'delete'; backup: Backup }
  | { kind: 'deleteSave'; slotId: string; running: boolean }
  | { kind: 'deleteBackups'; slotId: string; count: number }
  | { kind: 'settingsClose' }
  | { kind: 'resetSettings'; scope: 'appearance' | 'all' }
  | { kind: 'resetBackupRoot' }
  | { kind: 'mods' }
  | { kind: 'close' };

type ToastKind = 'success' | 'error' | 'info';

function toast(kind: ToastKind, title: string, message?: string): void {
  const color = kind === 'success' ? 'teal' : kind === 'error' ? 'red' : 'blue';
  const icon = createElement(
    kind === 'success' ? IconCircleCheck : kind === 'error' ? IconAlertTriangle : IconInfoCircle,
    { size: 18 },
  );
  notifications.show({
    color,
    title,
    message,
    icon,
    autoClose: kind === 'error' ? 7000 : 3200,
    withCloseButton: false,
  });
}

function avatarCharsOf(worlds: World[]): string[] {
  const chars = worlds.map((world) => world.character).filter(Boolean);
  // 尖啸者存档用官方 screecher 头像（不是可玩角色，需要单独预载）
  if (worlds.some((world) => world.kind === 'screecher') && !chars.includes('screecher')) {
    chars.push('screecher');
  }
  return chars;
}

function applyPreset(preset: string): void {
  document.documentElement.dataset.dsPreset = preset;
}

interface AppState {
  status: 'booting' | 'ready' | 'error';
  bootError: string | null;
  version: string;

  saveDir: string;
  saveDirs: string[];
  worlds: World[];
  selectedSlot: string | null;
  backups: Backup[];
  avatars: Record<string, string>;
  avatarStatus: { available: boolean; missing: string[]; elapsed: number } | null;
  stats: Stats;
  config: Config;
  defaults: Config | null;
  options: Options | null;

  autoOn: boolean;
  watcher: WatcherState;
  platform: PlatformInfo | null;
  scheme: ColorScheme;
  previewScheme: ColorScheme | null;
  previewFontSize: number | null;
  titlebarDark: boolean;

  jobs: Record<string, Job>;
  activeJobId: string | null;
  pendingBackup: boolean;
  lastSeq: number;

  view: View;
  dialog: DialogState;

  windowKind: 'main' | 'settings';
  settingsDraft: Partial<Config>;
  settingsDirty: boolean;

  detailsOpen: boolean;
  details: WorldDetails | null;
  detailsLoading: boolean;

  candidatesOpen: boolean;

  boot: () => Promise<void>;
  refreshData: () => Promise<void>;
  setView: (view: View) => void;
  setSeq: (seq: number) => void;
  applyEvents: (events: DsEvent[]) => void;

  loadAvatars: (chars: string[]) => Promise<void>;
  refreshAvatars: () => Promise<void>;
  uploadPending: { char: string; sourcePath: string; defaultName: string; applyLabel: boolean } | null;
  avatarPickerFor: string | null;
  startAvatarPicker: (char: string) => void;
  closeAvatarPicker: () => void;
  startAvatarUpload: (char: string, applyLabel: boolean) => Promise<void>;
  setUploadPendingName: (name: string) => void;
  confirmAvatarUpload: () => Promise<void>;
  cancelAvatarUpload: () => void;
  selectWorld: (id: string) => Promise<void>;
  /** 重新拉取当前槽位的备份列表（表格刷新、备注保存后用） */
  refreshBackups: () => Promise<void>;
  backup: () => Promise<void>;
  backupSlot: (slotId: string) => Promise<void>;
  toggleAuto: () => Promise<void>;
  setSaveDir: (path: string) => Promise<void>;
  pickFolder: (kind: 'save_dir' | 'backup_root') => Promise<void>;
  chooseFolder: (kind: 'save_dir' | 'backup_root' | 'game_dir') => Promise<string | null>;
  reveal: (kind: 'backup_root' | 'backup' | 'save_dir' | 'log_dir', backupId?: string) => Promise<void>;
  windowAction: (action: 'minimize' | 'hide' | 'close') => Promise<void>;
  saveSettings: (patch: Partial<Config>) => Promise<void>;
  cleanup: () => Promise<void>;

  openRestore: (backup: Backup) => Promise<void>;
  confirmRestore: () => Promise<void>;
  openDelete: (backup: Backup) => void;
  confirmDelete: () => Promise<void>;
  restoreLatest: (slotId: string) => Promise<void>;
  openDeleteSave: (slotId: string) => Promise<void>;
  confirmDeleteSave: (deleteBackups: boolean) => Promise<void>;
  openDeleteBackups: (slotId: string) => void;
  confirmDeleteBackups: (keepLatest: boolean) => Promise<void>;
  toggleDetails: (slotId?: string) => Promise<void>;
  openCandidates: () => Promise<void>;
  closeCandidates: () => void;
  excludeCandidate: (path: string) => Promise<void>;
  restoreCandidate: (path: string) => Promise<void>;
  revealSaveDir: (path: string) => Promise<void>;
  settingsPreview: (patch: Partial<Config>) => void;
  discardSettings: () => void;
  openSettingsWindow: () => Promise<void>;
  closeSettingsNow: () => Promise<void>;
  ackSettingsClose: () => Promise<void>;
  resolveSettingsClose: (discard: boolean) => Promise<void>;
  openResetSettings: (scope: 'appearance' | 'all') => void;
  resetSettings: (scope: 'appearance' | 'all') => Promise<void>;
  openResetBackupRoot: () => void;
  restoreBackupRoot: () => Promise<void>;
  copyToClipboard: (text: string, label?: string) => Promise<void>;
  openMods: () => Promise<void>;
  revealModFolder: (modId: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openCloseDialog: () => void;
  closeDialog: () => void;
  resolveClose: (action: 'tray' | 'exit', remember: boolean) => Promise<void>;
}

const EMPTY_STATS: Stats = { total_bytes: 0, count: 0, per_slot: {} };

let bootStarted = false;
let pollStarted = false;
let refreshTimer: number | null = null;

function scheduleRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void useAppStore.getState().refreshData();
  }, 60);
}

// 后端建设置窗时把当前主题带在 URL 上；主窗没有参数，走默认值
const bootParams = new URLSearchParams(window.location.search);
const bootPreset = bootParams.get('preset');
const bootScheme = bootParams.get('scheme');

export const useAppStore = create<AppState>((set, get) => ({
  status: 'booting',
  bootError: null,
  version: '',

  saveDir: '',
  saveDirs: [],
  worlds: [],
  selectedSlot: null,
  backups: [],
  avatars: {},
  avatarStatus: null,
  stats: EMPTY_STATS,
  config: {
    config_version: 3,
    theme_mode: 'auto',
    theme_preset: (bootPreset as AppState['config']['theme_preset']) ?? 'nightfall',
    font_size: 17,
    backup_root: '',
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
    save_dir: '',
    game_dir: '',
  },
  defaults: null,
  options: null,

  autoOn: true,
  watcher: { state: 'idle', last_tick_at: 0 },
  platform: null,
  scheme: bootScheme === 'light' ? 'light' : 'dark',
  previewScheme: null,
  previewFontSize: null,
  uploadPending: null,
  avatarPickerFor: null,
  titlebarDark: false,

  jobs: {},
  activeJobId: null,
  pendingBackup: false,
  lastSeq: 0,

  view: 'worlds',
  dialog: null,

  windowKind:
    new URLSearchParams(window.location.search).get('window') === 'settings'
      ? 'settings'
      : 'main',
  settingsDraft: {},
  settingsDirty: false,

  detailsOpen: false,
  details: null,
  detailsLoading: false,

  candidatesOpen: false,

  async boot() {
    if (bootStarted) return;
    bootStarted = true;
    set({ status: 'booting', bootError: null });
    try {
      const bridge = await getBridge();
      const data: BootstrapData = await bridge.bootstrap();
      applyPreset(data.config.theme_preset);
      set({
        status: 'ready',
        version: data.version,
        lastSeq: data.event_seq ?? 0, // 从当前序号起读，绝不重放历史事件
        saveDir: data.save_dir,
        saveDirs: data.save_dirs,
        worlds: data.worlds,
        selectedSlot: data.selected_slot,
        backups: data.backups,
        stats: data.stats,
        config: data.config,
        defaults: data.defaults,
        options: data.options,
        autoOn: data.auto_on,
        watcher: data.watcher,
        platform: data.platform,
        scheme: data.platform?.scheme ?? 'dark',
        titlebarDark: Boolean(data.platform?.titlebar_dark),
      });
      if (data.warnings?.includes('E_CONFIG')) {
        toast('error', '配置已重置', '原配置文件损坏，已备份为 .bak 并用默认值启动');
      }
      if (new URLSearchParams(window.location.search).get('view') === 'settings') {
        set({ view: 'settings' });
      }
      if (!data.save_dir) {
        // 首次启动没有可用存档目录 → 弹候选确认（取消则进空状态）
        void get().openCandidates();
      }
      void get().loadAvatars(avatarCharsOf(data.worlds));
      startPoller();
    } catch (error) {
      set({ status: 'error', bootError: errorText(error) });
    }
  },

  async refreshData() {
    const selected = get().selectedSlot;
    const bridge = await getBridge();
    const [worldsResult, stats, selectedResult] = await Promise.all([
      bridge.listWorlds(),
      bridge.getStats(),
      selected ? bridge.selectWorld(selected) : Promise.resolve(null),
    ]);
    set({
      worlds: worldsResult.worlds,
      selectedSlot: worldsResult.selected_slot ?? selected,
      backups: selectedResult?.backups ?? [],
      stats,
    });
    void get().loadAvatars(avatarCharsOf(worldsResult.worlds));
  },

  setView(view) {
    set({ view });
  },

  setSeq(seq) {
    set({ lastSeq: seq });
  },

  applyEvents(events) {
    if (!events.length) return;
    const state = get();
    // 设置窗也在轮询事件：业务提示只让主窗弹，否则同一个「没有需要清理的备份」会出现两条
    const canToast = state.windowKind === 'main';
    const jobs = { ...state.jobs };
    let activeJobId = state.activeJobId;
    let autoOn = state.autoOn;
    let watcher = state.watcher;
    let scheme = state.scheme;
    let config = state.config;
    let dialog = state.dialog;

    for (const event of events) {
      const payload = event.payload;
      switch (event.type) {
        case 'job.started': {
          const id = payload.job_id as string;
          jobs[id] = {
            id,
            kind: payload.kind as Job['kind'],
            percent: 0,
            done: 0,
            total: 0,
            bytes_done: 0,
            bytes_total: 0,
          };
          activeJobId = id;
          break;
        }
        case 'job.progress': {
          const id = payload.job_id as string;
          if (jobs[id]) {
            jobs[id] = {
              ...jobs[id],
              phase: payload.phase,
              percent: payload.percent ?? 0,
              done: payload.done ?? 0,
              total: payload.total ?? 0,
              bytes_done: payload.bytes_done ?? 0,
              bytes_total: payload.bytes_total ?? 0,
            };
          }
          break;
        }
        case 'job.done': {
          const id = payload.job_id as string;
          delete jobs[id];
          if (activeJobId === id) activeJobId = null;
          if (payload.kind === 'backup') {
            const backup = payload.backup as Backup | undefined;
            if (canToast) toast('success', '备份完成',
              backup ? `${backup.day ?? '?'} 天 · ${backup.file_count} 个文件 · ${backup.total_mb.toFixed(1)} MB` : undefined);
            set({ pendingBackup: false });
          } else if (payload.kind === 'restore') {
            if (canToast) toast('success', '恢复完成', `已写回 ${payload.restored ?? 0} 个文件，恢复前快照已保留`);
          } else if (payload.kind === 'delete_world') {
            const removed = Number(payload.removed_backups ?? 0);
            if (canToast) toast('success', '存档已删除',
              `存档文件已移入回收站${removed ? `，同时删除了 ${removed} 份备份` : ''}；删除前快照已保留`);
          } else if (payload.kind === 'cleanup') {
            const removed = Number(payload.removed ?? 0);
            if (canToast) toast(removed ? 'success' : 'info', removed ? '清理完成' : '没有需要清理的备份',
              removed ? `删除了 ${removed} 份超限备份` : undefined);
          }
          scheduleRefresh();
          break;
        }
        case 'job.failed': {
          const id = payload.job_id as string;
          delete jobs[id];
          if (activeJobId === id) activeJobId = null;
          set({ pendingBackup: false });
          if (canToast) toast('error', '操作失败', String(payload.message ?? '未知错误'));
          break;
        }
        case 'data.backups_changed':
        case 'data.worlds_changed':
          scheduleRefresh();
          break;
        case 'auto.triggered':
          if (canToast) toast('info', '检测到存档变化', '正在自动备份');
          break;
        case 'watcher.state':
          watcher = {
            state: payload.state,
            last_tick_at: payload.last_tick_at ?? Date.now() / 1000,
            error: payload.error ?? null,
            next_due_at: payload.next_due_at ?? null,
          };
          if (typeof payload.auto_on === 'boolean') autoOn = payload.auto_on;
          break;
        case 'shell.color_scheme':
          scheme = payload.scheme as ColorScheme;
          // 保存后后端会带上 preset：同步换调色板，否则主窗只变明暗、配色不动
          if (typeof payload.preset === 'string') {
            config = { ...config, theme_preset: payload.preset as Config['theme_preset'] };
          }
          break;
        case 'config.changed':
          if (payload.config && typeof payload.config === 'object') {
            config = payload.config as Config;
          }
          break;
        case 'shell.close_requested':
          dialog = { kind: 'close' };
          break;
        case 'shell.settings_close_requested':
          // 只有设置窗自己处理关闭闸门；主窗收到（历史重放/广播）必须无视
          if (get().windowKind !== 'settings') break;
          if (get().settingsDirty) {
            dialog = { kind: 'settingsClose' };
            void get().ackSettingsClose(); // 已弹框等用户决定，取消后端兜底
          } else {
            void get().closeSettingsNow();
          }
          break;
        default:
          break;
      }
    }

    set({
      jobs,
      activeJobId,
      autoOn,
      watcher,
      scheme,
      config,
      dialog,
      lastSeq: events[events.length - 1]?.seq ?? state.lastSeq,
    });
  },

  async loadAvatars(chars) {
    const state = get();
    const known = new Set([
      ...Object.keys(state.avatars),
      ...(state.avatarStatus?.missing ?? []),
    ]);
    const pending = [...new Set(chars.filter(Boolean))].filter((char) => !known.has(char));
    if (!pending.length) return;
    try {
      const bridge = await getBridge();
      const result = await bridge.getAvatars(pending);
      set((current) => ({
        avatars: { ...current.avatars, ...result.avatars },
        avatarStatus: {
          available: result.available,
          missing: [...new Set([...(current.avatarStatus?.missing ?? []), ...result.missing])],
          elapsed: result.elapsed_ms,
        },
      }));
    } catch {
      // 头像失败不影响主流程，保持字母回退
    }
  },

  async refreshAvatars() {
    // 必须带上 screecher：否则上传任意角色后刷新头像，尖啸者会掉回首字母占位
    const chars = avatarCharsOf(get().worlds);
    try {
      const bridge = await getBridge();
      const result = await bridge.refreshAvatars(chars);
      set({
        avatars: result.avatars,
        avatarStatus: {
          available: result.available,
          missing: result.missing,
          elapsed: result.elapsed_ms,
        },
      });
      toast('success', '头像已重建', `${Object.keys(result.avatars).length} 个角色命中`);
    } catch (error) {
      toast('error', '重建头像失败', errorText(error));
    }
  },

  async refreshBackups() {
    const slotId = get().selectedSlot;
    if (!slotId) return;
    try {
      const bridge = await getBridge();
      const { backups: items } = await bridge.listBackups(slotId);
      set({ backups: items });
    } catch {
      /* 刷新失败保持原列表，按钮本身有 loading 态由调用方管 */
    }
  },

  async selectWorld(id) {
    const bridge = await getBridge();
    const previousSlot = get().selectedSlot;
    set({ selectedSlot: id });
    if (previousSlot !== id) set({ detailsOpen: false, details: null });
    try {
      const result = await bridge.selectWorld(id);
      set({ backups: result.backups });
    } catch (error) {
      toast('error', '无法切换世界', errorText(error));
      void get().refreshData();
    }
  },

  async backup() {
    const slot = get().selectedSlot;
    if (!slot || get().pendingBackup) return;
    set({ pendingBackup: true });
    try {
      const bridge = await getBridge();
      await bridge.backup(slot, 'manual');
    } catch (error) {
      set({ pendingBackup: false });
      toast('error', '无法开始备份', errorText(error));
    }
  },

  async toggleAuto() {
    const next = !get().autoOn;
    try {
      const bridge = await getBridge();
      const result = await bridge.setAutoBackup(next);
      set({ autoOn: result.auto_on });
      toast('info', result.auto_on ? '自动备份已开启' : '自动备份已关闭');
    } catch (error) {
      toast('error', '切换失败', errorText(error));
    }
  },

  async setSaveDir(path) {
    try {
      const bridge = await getBridge();
      const snapshot = await bridge.setSaveDir(path);
      set({
        saveDir: snapshot.save_dir,
        saveDirs: snapshot.save_dirs,
        worlds: snapshot.worlds,
        selectedSlot: snapshot.selected_slot,
        backups: snapshot.backups,
        candidatesOpen: false,
      });
      toast('success', '已切换存档目录');
      scheduleRefresh();
    } catch (error) {
      toast('error', '目录无效', errorText(error));
    }
  },

  async pickFolder(kind) {
    try {
      const bridge = await getBridge();
      const result = await bridge.pickFolder(kind);
      if (!result.path) return;
      if (kind === 'save_dir') {
        await get().setSaveDir(result.path);
      } else {
        await get().saveSettings({ backup_root: result.path });
      }
    } catch (error) {
      toast('error', '选择目录失败', errorText(error));
    }
  },

  async chooseFolder(kind) {
    try {
      const bridge = await getBridge();
      const result = await bridge.pickFolder(kind);
      return result.path;
    } catch (error) {
      toast('error', '选择目录失败', errorText(error));
      return null;
    }
  },

  async reveal(kind, backupId) {
    try {
      const bridge = await getBridge();
      await bridge.revealPath(kind, backupId);
    } catch (error) {
      toast('error', '打开失败', errorText(error));
    }
  },

  async windowAction(action) {
    try {
      const bridge = await getBridge();
      await bridge.windowAction(action);
    } catch (error) {
      toast('error', '窗口操作失败', errorText(error));
    }
  },

  async saveSettings(patch) {
    try {
      const bridge = await getBridge();
      const result = await bridge.saveSettings(patch);
      applyPreset(result.config.theme_preset);
      clearPreview();
      set({
        config: result.config,
        autoOn: result.config.auto_backup,
        scheme: (result.applied?.color_scheme as ColorScheme) ?? get().scheme,
        previewScheme: null,
        previewFontSize: null,
        uploadPending: null,
  avatarPickerFor: null,
        settingsDraft: {},
        settingsDirty: false,
      });
      if ('game_dir' in patch) void get().refreshAvatars();
      toast('success', '设置已保存');
      scheduleRefresh();
      // 保存后保持窗口打开：用户可以接着调，不必反复开关设置窗
    } catch (error) {
      toast('error', '保存失败', errorText(error));
    }
  },

  async cleanup() {
    try {
      const bridge = await getBridge();
      const result = await bridge.cleanup('all');
      if (result.job_id === null) {
        set({ stats: result.stats });
        const removed = Number(result.removed ?? 0);
        toast(removed ? 'success' : 'info', removed ? '清理完成' : '没有需要清理的备份',
          removed ? `删除了 ${removed} 份超限备份` : undefined);
        scheduleRefresh();
      }
    } catch (error) {
      toast('error', '清理失败', errorText(error));
    }
  },

  async openRestore(backup) {
    set({ dialog: { kind: 'restore', backup, preview: null, loading: true } });
    try {
      const bridge = await getBridge();
      const preview = await bridge.previewRestore(backup.id);
      if (preview.game_running) {
        set({ dialog: null });
        toast('error', '饥荒正在运行', '请先完全退出游戏再恢复，否则存档会被内存里的进度盖回去');
        return;
      }
      set({ dialog: { kind: 'restore', backup, preview, loading: false } });
    } catch (error) {
      set({ dialog: null });
      toast('error', '读取备份失败', errorText(error));
    }
  },

  async confirmRestore() {
    const dialog = get().dialog;
    if (!dialog || dialog.kind !== 'restore') return;
    set({ dialog: null });
    try {
      const bridge = await getBridge();
      await bridge.restore(dialog.backup.id);
    } catch (error) {
      toast('error', '无法恢复', errorText(error));
    }
  },

  async backupSlot(slotId) {
    if (get().pendingBackup) return;
    set({ pendingBackup: true });
    try {
      const bridge = await getBridge();
      await bridge.backup(slotId, 'manual');
    } catch (error) {
      set({ pendingBackup: false });
      toast('error', '无法开始备份', errorText(error));
    }
  },

  openDelete(backup) {
    set({ dialog: { kind: 'delete', backup } });
  },

  async confirmDelete() {
    const dialog = get().dialog;
    if (!dialog || dialog.kind !== 'delete') return;
    set({ dialog: null });
    try {
      const bridge = await getBridge();
      const result = await bridge.deleteBackup(dialog.backup.id);
      set({ backups: result.backups, stats: result.stats });
      toast('success', '已删除', `释放 ${(result.freed_bytes / 1048576).toFixed(1)} MB`);
      scheduleRefresh();
    } catch (error) {
      toast('error', '删除失败', errorText(error));
    }
  },

  async restoreLatest(slotId) {
    try {
      const bridge = await getBridge();
      const { backups: items } = await bridge.listBackups(slotId);
      if (!items.length) {
        toast('info', '这个存档还没有备份', '先点「备份此世界」拍第一份');
        return;
      }
      await get().openRestore(items[0]);
    } catch (error) {
      toast('error', '读取备份失败', errorText(error));
    }
  },

  async openDeleteSave(slotId) {
    try {
      const bridge = await getBridge();
      const { running } = await bridge.gameRunning();
      set({ dialog: { kind: 'deleteSave', slotId, running } });
    } catch (error) {
      toast('error', '无法检查游戏状态', errorText(error));
    }
  },

  async confirmDeleteSave(deleteBackups) {
    const dialog = get().dialog;
    if (!dialog || dialog.kind !== 'deleteSave') return;
    set({ dialog: null });
    try {
      const bridge = await getBridge();
      await bridge.deleteSave(dialog.slotId, deleteBackups);
    } catch (error) {
      toast('error', '删除存档失败', errorText(error));
    }
  },

  openDeleteBackups(slotId) {
    const count = get().backups.find((item) => item.slot_id === slotId)
      ? get().backups.filter((item) => item.slot_id === slotId).length
      : get().worlds.find((item) => item.id === slotId)?.backup_count ?? 0;
    set({ dialog: { kind: 'deleteBackups', slotId, count } });
  },

  async confirmDeleteBackups(keepLatest) {
    const dialog = get().dialog;
    if (!dialog || dialog.kind !== 'deleteBackups') return;
    set({ dialog: null });
    try {
      const bridge = await getBridge();
      const { backups: items } = await bridge.listBackups(dialog.slotId);
      const targets = keepLatest ? items.slice(1) : items;
      let freed = 0;
      for (const item of targets) {
        const result = await bridge.deleteBackup(item.id);
        freed += result.freed_bytes;
      }
      const stats = await bridge.getStats();
      set({ stats });
      toast(targets.length ? 'success' : 'info',
        targets.length ? `已删除 ${targets.length} 份备份` : '没有可删除的备份',
        targets.length ? `释放 ${(freed / 1048576).toFixed(1)} MB` : undefined);
      scheduleRefresh();
    } catch (error) {
      toast('error', '删除备份失败', errorText(error));
    }
  },

  async toggleDetails(slotId) {
    const target = slotId ?? get().selectedSlot;
    if (!target) return;
    if (get().detailsOpen && get().details?.id === target) {
      set({ detailsOpen: false });
      return;
    }
    set({ detailsOpen: true, detailsLoading: true, details: null });
    try {
      const bridge = await getBridge();
      const details = await bridge.worldDetails(target);
      set({ details, detailsLoading: false });
    } catch (error) {
      set({ detailsOpen: false, detailsLoading: false });
      toast('error', '读取存档详情失败', errorText(error));
    }
  },

  async openCandidates() {
    set({ candidatesOpen: true });
  },

  closeCandidates() {
    set({ candidatesOpen: false });
  },

  async excludeCandidate(path) {
    try {
      const bridge = await getBridge();
      const result = await bridge.excludeSaveCandidate(path);
      useAppStore.setState({
        config: { ...get().config, excluded_candidates: result.excluded },
      });
    } catch (error) {
      toast('error', '排除失败', errorText(error));
    }
  },

  async restoreCandidate(path) {
    try {
      const bridge = await getBridge();
      const result = await bridge.restoreSaveCandidate(path);
      useAppStore.setState({
        config: { ...get().config, excluded_candidates: result.excluded },
      });
    } catch (error) {
      toast('error', '恢复失败', errorText(error));
    }
  },

  async revealSaveDir(path) {
    try {
      const bridge = await getBridge();
      await bridge.revealDir(path);
    } catch (error) {
      toast('error', '打开目录失败', errorText(error));
    }
  },


  startAvatarPicker(char) {
    set({ avatarPickerFor: char });
  },

  closeAvatarPicker() {
    set({ avatarPickerFor: null });
  },

  async startAvatarUpload(char, applyLabel) {
    try {
      const bridge = await getBridge();
      const picked = await bridge.avatarPickImage();
      if (!picked.picked) return;
      set({
        uploadPending: {
          char,
          sourcePath: picked.picked,
          defaultName: picked.name,
          applyLabel,
        },
      });
    } catch {
      toast('error', '无法打开文件选择框');
    }
  },

  setUploadPendingName(name) {
    set((current) => ({
      uploadPending: current.uploadPending
        ? { ...current.uploadPending, defaultName: name }
        : null,
    }));
  },

  async confirmAvatarUpload() {
    const pending = get().uploadPending;
    if (!pending) return;
    try {
      const bridge = await getBridge();
      await bridge.avatarUpload(pending.char, pending.sourcePath, pending.defaultName.trim());
      set({ uploadPending: null });
      await get().refreshAvatars();
      toast('success', `${pending.char} 已使用自定义头像`);
    } catch {
      toast('error', '上传失败', '请确认选择的是 PNG 图片');
    }
  },

  cancelAvatarUpload() {
    set({ uploadPending: null });
  },

  settingsPreview(patch) {
    const draft = { ...get().settingsDraft, ...patch };
    // 改回原值不算「有修改」：与已保存配置相同的键从草稿剔除，保存按钮随之复位
    const saved = get().config as unknown as Record<string, unknown>;
    for (const key of Object.keys(draft)) {
      const value = (draft as Record<string, unknown>)[key];
      if (value === saved[key]) delete (draft as Record<string, unknown>)[key];
    }
    if (typeof patch.theme_preset === 'string') {
      // 点击即预览：本窗立刻换肤
      applyPreset(patch.theme_preset);
    }
    if (patch.theme_mode === 'light' || patch.theme_mode === 'dark') {
      // 明暗同款即时预览：本地换皮，保存才落盘
      set({ previewScheme: patch.theme_mode });
    }
    if (typeof patch.font_size === 'number') {
      // 字号同款即时预览
      set({ previewFontSize: patch.font_size });
    }
    set({ settingsDraft: draft, settingsDirty: Object.keys(draft).length > 0 });

    const preset = typeof draft.theme_preset === 'string' ? draft.theme_preset : get().config.theme_preset;
    const font = typeof draft.font_size === 'number' ? draft.font_size : null;
    // 只点主题卡时草稿里没有 theme_mode：必须回退到已保存配置。
    // 否则 undefined 会被当成「跟随系统」去问系统明暗，把亮色覆盖成暗色
    const mode = draft.theme_mode ?? get().config.theme_mode;

    void (async () => {
      let scheme: 'light' | 'dark';
      if (mode === 'light' || mode === 'dark') {
        scheme = mode;
      } else {
        // auto：必须问系统当前明暗；建窗时按已保存配置算出的 scheme 在这里是旧值
        try {
          scheme = (await (await getBridge()).systemScheme()).scheme;
        } catch {
          scheme = get().scheme;
        }
      }
      // 预览态跟随最终值：修掉只点主题卡时 previewScheme 残留旧明暗的问题
      set({ previewScheme: scheme });
      // 配色 / 明暗 / 字号一起广播给主窗
      publishPreview({
        preset: typeof draft.theme_preset === 'string' ? draft.theme_preset : null,
        scheme,
        font,
      });
      // 标题栏（DWM 颜色只能后端刷）：只预览不落盘
      try {
        await (await getBridge()).previewChrome(preset, scheme);
      } catch {
        /* 标题栏刷不上不影响预览 */
      }
    })();
  },

  discardSettings() {
    applyPreset(get().config.theme_preset);
    clearPreview();
    // 放弃预览：标题栏回到已保存配置（auto 时用系统实际明暗）
    void (async () => {
      try {
        const bridge = await getBridge();
        const cfg = get().config;
        const scheme = cfg.theme_mode === 'auto'
          ? (await bridge.systemScheme()).scheme
          : get().scheme;
        await bridge.previewChrome(cfg.theme_preset, scheme);
      } catch {
        /* 忽略 */
      }
    })();
    set({ settingsDraft: {}, settingsDirty: false, previewScheme: null, previewFontSize: null });
  },

  async openSettingsWindow() {
    if (isNativeBridge()) {
      try {
        await (await getBridge()).openSettings();
        return;
      } catch (error) {
        toast('error', '无法打开设置窗口', errorText(error));
        return;
      }
    }
    // 浏览器 / 截图模式退化为页内设置
    set({ view: 'settings' });
  },

  async closeSettingsNow() {
    if (isNativeBridge()) {
      try {
        await (await getBridge()).closeSettings();
      } catch {
        /* 窗口已被系统关闭等情况 */
      }
    } else {
      set({ view: 'worlds' });
    }
  },

  async ackSettingsClose() {
    if (isNativeBridge()) {
      try {
        await (await getBridge()).ackSettingsClose();
      } catch {
        /* 忽略 */
      }
    }
  },

  openResetSettings(scope) {
    set({ dialog: { kind: 'resetSettings', scope } });
  },

  async resetSettings(scope) {
    const defaults = get().defaults;
    if (!defaults) return;
    // 全部还原不动三个目录：那是用户的安装环境，不是"设置"
    const skip = new Set(['save_dir', 'backup_root', 'game_dir']);
    const patch = scope === 'appearance'
      ? {
          theme_mode: defaults.theme_mode,
          theme_preset: defaults.theme_preset,
          font_size: defaults.font_size,
        }
      : Object.fromEntries(
          Object.entries(defaults).filter(([key]) => !skip.has(key)),
        ) as Partial<Config>;
    set({ dialog: null });
    await get().saveSettings(patch);
  },

  openResetBackupRoot() {
    set({ dialog: { kind: 'resetBackupRoot' } });
  },

  async restoreBackupRoot() {
    const defaults = get().defaults;
    if (!defaults) return;
    set({ dialog: null });
    await get().saveSettings({ backup_root: defaults.backup_root });
  },

  async copyToClipboard(text, label = '内容') {    const { copyText } = await import('../clipboard');
    const ok = await copyText(text);
    if (ok) toast('success', `已复制${label}`);
    else toast('error', '复制失败', '剪贴板被拒绝访问，请手动选择文本复制');
  },

  async openMods() {
    // 弹窗数据来自世界详情：没拉过（或换了存档）就先取一次，否则列表会是空的
    const target = get().selectedSlot;
    if (target && get().details?.id !== target) {
      try {
        const bridge = await getBridge();
        const details = await bridge.worldDetails(target);
        set({ details });
      } catch {
        /* 取不到就展示空态，不阻塞弹窗 */
      }
    }
    set({ dialog: { kind: 'mods' } });
  },

  async revealModFolder(modId) {
    try {
      const bridge = await getBridge();
      await bridge.openModFolder(modId);
    } catch (error) {
      toast('error', '打开文件夹失败', errorText(error));
    }
  },

  async openExternal(url) {
    try {
      const bridge = await getBridge();
      await bridge.openUrl(url);
    } catch (error) {
      toast('error', '打开链接失败', errorText(error));
    }
  },

  async resolveSettingsClose(discard) {
    set({ dialog: null });
    if (discard) {
      get().discardSettings();
      await get().closeSettingsNow();
    }
  },

  openCloseDialog() {
    set({ dialog: { kind: 'close' } });
  },

  closeDialog() {
    set({ dialog: null });
  },

  async resolveClose(action, remember) {
    set({ dialog: null });
    try {
      const bridge = await getBridge();
      if (remember) await bridge.saveSettings({ close_action: action });
      if (action === 'exit') {
        await bridge.quitApp();
      } else {
        await bridge.windowAction('hide');
      }
    } catch (error) {
      toast('error', '操作失败', errorText(error));
    }
  },
}));

function startPoller(): void {
  if (pollStarted) return;
  pollStarted = true;

  const tick = async () => {
    const state = useAppStore.getState();
    try {
      const bridge = await getBridge();
      const result = await bridge.pollEvents(state.lastSeq);
      if (result.events.length) {
        useAppStore.getState().applyEvents(result.events);
      }
      useAppStore.setState({ lastSeq: result.seq });
      if (result.lost_from !== null && state.lastSeq < result.lost_from) {
        await useAppStore.getState().refreshData();
      }
    } catch {
      // 轮询失败不弹窗，下一轮继续；真正的错误会以事件形式到达
    }
    const active = useAppStore.getState().activeJobId;
    window.setTimeout(tick, active ? 150 : 600);
  };

  window.setTimeout(tick, 250);
}
