/** 设置窗 → 主窗的即时预览通道。
 *
 * localStorage 的 storage 事件只在「另一个窗口」触发，正好当跨窗广播；
 * BroadcastChannel 作为同源双通道兜底（WebView2 下更可靠）。
 * 载荷统一为 JSON：preset / scheme / font 各自可空。
 */
export interface PreviewPayload {
  preset: string | null;
  scheme: 'light' | 'dark' | null;
  font: number | null;
}

const KEY = 'ds:preview_ui';
const CHANNEL = 'ds:ui-preview';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch {
    channel = null;
  }
  return channel;
}

export function publishPreview(payload: PreviewPayload): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* 忽略 */
  }
  try {
    getChannel()?.postMessage(payload);
  } catch {
    /* 忽略 */
  }
}

export function clearPreview(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  try {
    getChannel()?.postMessage({ preset: null, scheme: null, font: null });
  } catch {
    /* 忽略 */
  }
}

export function subscribePreview(onPayload: (payload: PreviewPayload | null) => void): () => void {
  const normalize = (raw: unknown): PreviewPayload | null => {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Partial<PreviewPayload>;
    return {
      preset: typeof value.preset === 'string' ? value.preset : null,
      scheme: value.scheme === 'light' || value.scheme === 'dark' ? value.scheme : null,
      font: typeof value.font === 'number' ? value.font : null,
    };
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    if (!event.newValue) {
      onPayload(null);
      return;
    }
    try {
      onPayload(normalize(JSON.parse(event.newValue)));
    } catch {
      /* 忽略坏载荷 */
    }
  };

  const bc = getChannel();
  const onMessage = (event: MessageEvent) => onPayload(normalize(event.data));

  window.addEventListener('storage', onStorage);
  bc?.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener('storage', onStorage);
    bc?.removeEventListener('message', onMessage);
  };
}
