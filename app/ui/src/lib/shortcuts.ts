/** 快捷键注册表：默认键位 + localStorage 自定义 + 组合键解析。
 *
 *  存储：localStorage `ds:shortcuts` = { actionId: "ctrl+z" }，缺省项即用默认。
 *  主窗每次按键现读存储，设置窗改完立即生效（双窗共享 localStorage）。
 */

export type ShortcutAction = 'undo' | 'search' | 'backup' | 'refresh';

export interface ShortcutDef {
  id: ShortcutAction;
  label: string;
  hint: string;
  combo: string;
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: 'undo', label: '撤销上一步', hint: '删除存档 / 恢复 / 删备份后反悔', combo: 'ctrl+z' },
  { id: 'search', label: '搜索', hint: '搜索世界与命令', combo: 'ctrl+f' },
  { id: 'backup', label: '备份此世界', hint: '给当前选中的世界拍一份快照', combo: 'ctrl+b' },
  { id: 'refresh', label: '刷新', hint: '重新读取存档目录与备份列表', combo: 'f5' },
];

const KEY = 'ds:shortcuts';

function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 当前生效的键位（默认 + 自定义覆盖）。 */
export function activeShortcuts(): ShortcutDef[] {
  const overrides = loadOverrides();
  return DEFAULT_SHORTCUTS.map((def) => ({ ...def, combo: overrides[def.id] ?? def.combo }));
}

export function saveShortcut(id: ShortcutAction, combo: string): void {
  const overrides = loadOverrides();
  overrides[id] = combo;
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    /* 忽略 */
  }
}

export function resetShortcuts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/** 键盘事件 → 规范化组合键，如 "ctrl+shift+z" / "f5" / "escape"。 */
export function comboFromEvent(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  // 修饰键本身不构成组合
  if (['control', 'meta', 'alt', 'shift'].includes(key)) return '';
  parts.push(key);
  return parts.join('+');
}

/** "ctrl+z" → "Ctrl + Z"（展示用）。 */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      if (part === 'ctrl') return 'Ctrl';
      if (part === 'alt') return 'Alt';
      if (part === 'shift') return 'Shift';
      return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' + ');
}

/** 输入框 / 文本域 / 可编辑区内不触发全局快捷键。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
