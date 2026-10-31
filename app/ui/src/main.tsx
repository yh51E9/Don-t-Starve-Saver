import React from 'react';
import { createRoot } from 'react-dom/client';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import './theme/base.css';
import './theme/signature.css';

import App from './App';
import { getPreset } from './theme/presets';

// 设置窗由后端在 URL 带 preset/scheme：首帧之前先落地底色与属性，杜绝暗→亮闪一下
const entryParams = new URLSearchParams(window.location.search);
const entryScheme = entryParams.get('scheme');
if (entryScheme === 'light' || entryScheme === 'dark') {
  const presetKey = entryParams.get('preset') ?? 'nightfall';
  const tokens = getPreset(presetKey)[entryScheme];
  document.documentElement.dataset.mantineColorScheme = entryScheme;
  document.documentElement.dataset.dsPreset = presetKey;
  document.documentElement.style.background = tokens.bg;
  document.body.style.background = tokens.bg;
}

// 全局 JS 错误上报：白屏不再无声无息，栈直接进 app.log
function reportJsError(kind: string, message: string, detail = '') {
  // eslint-disable-next-line no-console
  console.error(`[${kind}] ${message}`, detail);
  try {
    const api = (window as unknown as { pywebview?: { api?: Record<string, (m: string, d: string) => void> } }).pywebview?.api;
    api?.log_js_error?.(`[${kind}] ${message}`, detail);
  } catch {
    /* 上报失败就只留 console */
  }
}

window.addEventListener('error', (event) => {
  reportJsError('error', event.message, `${event.filename}:${event.lineno}:${event.colno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  reportJsError('promise', String(event.reason));
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportJsError('react', error.message, info.componentStack ?? '');
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#eee', fontFamily: 'monospace', fontSize: 13 }}>
          <div style={{ color: '#ff8787', marginBottom: 12 }}>
            界面渲染出错了（已记录日志）
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 一次性迁移：dst:* → ds:*（命名空间前缀纠正）。新键已存在则不覆盖（新值优先），
// 成功后删旧键；隐私模式/配额异常静默跳过，不影响启动。幂等。
(function migrateLocalStorageNamespace() {
  try {
    const olds: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('dst:')) olds.push(key);
    }
    for (const old of olds) {
      const next = 'ds:' + old.slice('dst:'.length);
      if (localStorage.getItem(next) === null) {
        const val = localStorage.getItem(old);
        if (val !== null) localStorage.setItem(next, val);
      }
      localStorage.removeItem(old);
    }
  } catch {
    /* 隐私模式/配额异常：跳过迁移 */
  }
})();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
