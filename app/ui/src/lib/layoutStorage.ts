/** 三栏宽度的持久化。localStorage 单一键，坏了就当没有。 */

const KEY = 'ds:layout';

export interface LayoutSizes {
  navbar?: number;
  aside?: number;
}

export function loadLayoutSizes(): LayoutSizes {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLayoutSizes(sizes: LayoutSizes): void {
  try {
    const filtered = Object.fromEntries(
      Object.entries(sizes).filter(([, value]) => typeof value === 'number' && value > 0),
    );
    localStorage.setItem(KEY, JSON.stringify(filtered));
  } catch {
    /* 隐私模式等场景写不进去就随缘 */
  }
}

export function clearLayoutSizes(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}
