import { ApiError } from '../errors';
import { createMock } from './mock';
import type { Bridge } from './types';

type RawApi = Record<string, (...args: unknown[]) => Promise<any>>;

declare global {
  interface Window {
    pywebview?: { api: RawApi };
  }
}

function hasNative(): boolean {
  // pywebview 会先挂一个空的 api 对象，等桥接完成才填方法。
  // 只判断对象存在会在头几帧拿到 undefined，调用时报 "n[e] is not a function"。
  const api = window.pywebview?.api as Record<string, unknown> | undefined;
  return typeof api?.bootstrap === 'function';
}

function waitForNative(timeout = 3000): Promise<boolean> {
  if (hasNative()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    window.addEventListener('pywebviewready', () => finish(true), { once: true });
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (hasNative()) {
        window.clearInterval(timer);
        finish(true);
      } else if (Date.now() - started > timeout) {
        window.clearInterval(timer);
        finish(false);
      }
    }, 50);
  });
}

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const api = window.pywebview?.api;
  if (!api) throw new ApiError('E_NOT_SUPPORTED', '原生桥接不可用');
  const raw = await api[name](...args);
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('E_INTERNAL', '后端返回了意外的数据');
  }
  if (!raw.ok) {
    throw new ApiError(
      raw.error?.code ?? 'E_INTERNAL',
      raw.error?.message ?? '未知错误',
      raw.error?.detail ?? {},
    );
  }
  return raw.data as T;
}

function nativeBridge(): Bridge {
  return {
    bootstrap: () => call('bootstrap'),
    listWorlds: () => call('list_worlds'),
    selectWorld: (id) => call('select_world', id),
    setSaveDir: (path) => call('set_save_dir', path),
    pickFolder: (kind) => call('pick_folder', kind),
    backup: (slotId, tag = 'manual') => call('backup', slotId, tag),
    previewRestore: (id) => call('preview_restore', id),
    pickFile: (allowMultiple, fileTypes) => call('pick_file', allowMultiple, fileTypes),
    pickSaveFile: (defaultName) => call('pick_save_file', defaultName),
    exportBackups: (backupIds, destPath) => call('export_backups', backupIds, destPath),
    importScan: (path) => call('import_scan', path),
    importBackup: (path, mode, entryKey) => call('import_backup', path, mode, entryKey),
    restore: (id) => call('restore', id),
    deleteBackup: (id) => call('delete_backup', id),
    cleanup: (scope, slotId) => call('cleanup', scope, slotId ?? null),
    getSettings: () => call('get_settings'),
    getStats: () => call('get_stats'),
    saveSettings: (patch) => call('save_settings', patch),
    setAutoBackup: (on) => call('set_auto_backup', on),
    previewChrome: (preset, scheme) => call('preview_chrome', preset, scheme),
    systemScheme: () => call('system_scheme'),
    getAvatars: (chars) => call('get_avatars', chars),
    refreshAvatars: (chars) => call('refresh_avatars', chars ?? null),
    avatarDiagnostics: () => call('avatar_diagnostics'),
    avatarLibrary: () => call('avatar_library'),
    avatarRebuild: () => call('avatar_rebuild'),
    pollEvents: (since) => call('poll_events', since),
    cancelJob: (id) => call('cancel_job', id),
    gameRunning: () => call('game_running'),
    listBackups: (slotId) => call('list_backups', slotId),
    worldDetails: (slotId) => call('world_details', slotId),
    listSaveCandidates: () => call('list_save_candidates'),
    excludeSaveCandidate: (path) => call('exclude_save_candidate', path),
    restoreSaveCandidate: (path) => call('restore_save_candidate', path),
    openSettings: () => call('open_settings'),
    closeSettings: () => call('close_settings'),
    ackSettingsClose: () => call('ack_settings_close'),
    openModFolder: (modId) => call('open_mod_folder', modId),
    openUrl: (url) => call('open_url', url),
    revealDir: (path) => call('reveal_dir', path),
    avatarPreview: () => call('avatar_preview'),
    avatarDelete: (name) => call('avatar_delete', name),
    imageLibrary: () => call('image_library'),
    imageDelete: (category, key, source) => call('image_delete', category, key, source ?? ''),
    imageDeleteMany: (category, keys) => call('image_delete_many', category, keys),
    modiconsScan: () => call('modicons_scan'),
    modiconPreview: (modId) => call('modicon_preview', modId),
    avatarUpload: (char, sourcePath, displayName) => call('avatar_upload', char, sourcePath, displayName),
    avatarUploadAsset: (sourcePath, name) => call('avatar_upload_asset', sourcePath, name),
    avatarRenameAsset: (key, name) => call('avatar_rename_asset', key, name),
    avatarSetName: (char, name) => call('avatar_set_name', char, name),
    avatarPickImage: () => call('avatar_pick_image'),
    avatarClearLayer: (layer) => call('avatar_clear_layer', layer),
    avatarAssignFrom: (char, sourceChar) => call('avatar_assign_from', char, sourceChar),
    getChangelog: () => call('get_changelog'),
    backupFiles: (id) => call('backup_files', id),
    backupOverview: (id) => call('backup_overview', id),
    backupSetNote: (id, note) => call('backup_set_note', id, note),
    filterOptions: () => call('filter_options'),
    backupMods: (id) => call('backup_mods', id),
    avatarSetSource: (char, source) => call('avatar_set_source', char, source),
    deleteSave: (slotId, deleteBackups) => call('delete_save', slotId, deleteBackups),
    revealPath: (kind, backupId) => call('reveal_path', kind, backupId ?? null),
    windowAction: (action) => call('window_action', action),
    quitApp: () => call('quit_app'),
  };
}

let cached: Bridge | null = null;

export function isNativeBridge(): boolean {
  return hasNative();
}

export async function getBridge(): Promise<Bridge> {
  if (cached) return cached;

  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('mock');
  const fail = params.get('fail');
  const makeMock = () => createMock({
    scenario: scenario === 'empty' || scenario === 'new' ? scenario : 'default',
    failOn: fail ? fail.split(',') : [],
  });

  // 显式 ?mock 立刻返回，不浪费 3 秒等原生桥（截图与浏览器调试走这条）
  if (params.has('mock')) {
    cached = makeMock();
    return cached;
  }

  if (await waitForNative(import.meta.env.DEV ? 1200 : 3000)) {
    cached = nativeBridge();
    return cached;
  }
  if (import.meta.env.DEV) {
    cached = makeMock();
    return cached;
  }
  throw new ApiError('E_NOT_SUPPORTED', '原生桥接没有就绪，无法连接后端');
}
