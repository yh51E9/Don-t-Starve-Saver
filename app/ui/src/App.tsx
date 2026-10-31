import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';

import { AppShellLayout } from './app/AppShellLayout';
import { BootError } from './app/BootError';
import { Dialogs } from './features/backups/Dialogs';
import { SaveCandidatesModal } from './features/worlds/SaveCandidatesModal';
import { ModsModal } from './features/worlds/ModsModal';
import { AvatarUploadModal } from './components/AvatarUploadModal';
import { AvatarPickerModal } from './components/AvatarPickerModal';
import { AppSpotlight } from './features/spotlight/AppSpotlight';
import { SettingsPage } from './pages/SettingsPage';
import { useAppStore } from './lib/store/useAppStore';
import { buildTheme } from './theme/mantine';
import { getPreset } from './theme/presets';
import { buildResolver } from './theme/resolver';
import { subscribePreview, type PreviewPayload } from './lib/preview';
import type { ThemePreset } from './lib/bridge/types';

/** 设置窗即时关闭信号：后端点叉时 evaluate_js 直推，比轮询快且不会被另一窗口分食 */
function useSettingsCloseSignal() {
  const handler = () => {
    const state = useAppStore.getState();
    if (state.settingsDirty) {
      useAppStore.setState({ dialog: { kind: 'settingsClose' } });
      void state.ackSettingsClose();
    } else {
      void state.closeSettingsNow();
    }
  };
  useEffect(() => {
    window.addEventListener('ds:settings_close_requested', handler);
    return () => window.removeEventListener('ds:settings_close_requested', handler);
  }, [handler]);
}

export default function App() {
  const config = useAppStore((state) => state.config);
  const scheme = useAppStore((state) => state.scheme);
  const previewScheme = useAppStore((state) => state.previewScheme);
  const previewFontSize = useAppStore((state) => state.previewFontSize);
  const status = useAppStore((state) => state.status);
  const bootError = useAppStore((state) => state.bootError);
  const boot = useAppStore((state) => state.boot);
  const windowKind = useAppStore((state) => state.windowKind);
  const draftPreset = useAppStore((state) => state.settingsDraft.theme_preset);
  const [externalPreview, setExternalPreview] = useState<PreviewPayload | null>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  // 设置窗的预览（配色 / 明暗 / 字号）一起跟随，主窗和设置窗始终同一套皮
  useEffect(() => subscribePreview((payload) => {
    setExternalPreview(payload);
    // 字号同步进 store：表格列宽缩放（BackupTimeline）在主窗也要吃到预览字号，
    // 否则文字变大、列宽不变，又会溢出
    useAppStore.setState({ previewFontSize: payload?.font ?? null });
  }), []);
  useSettingsCloseSignal();

  // 预览优先级：本窗草稿（设置窗）> 预览广播（主窗）> 已保存配置
  const isSettingsWindow = windowKind === 'settings';
  const activePreset = isSettingsWindow
    ? (draftPreset ?? config.theme_preset)
    : (externalPreview?.preset ?? config.theme_preset);
  const activeScheme = isSettingsWindow
    ? (previewScheme ?? scheme)
    : (externalPreview?.scheme ?? scheme);
  const activeFontSize = isSettingsWindow
    ? (previewFontSize ?? config.font_size)
    : (externalPreview?.font ?? config.font_size);

  // data-ds-preset 驱动 CSS 侧的主题变量，主窗预览也必须跟着换
  useEffect(() => {
    document.documentElement.dataset.dsPreset = activePreset;
    // 入口为防首帧闪白写过内联底色，这里交还给 body{background: var(--ds-bg)}，
    // 否则预览换明暗时底色会停在加载那一刻
    document.documentElement.style.background = '';
    document.body.style.background = '';
  }, [activePreset, activeScheme]);

  const preset = getPreset(activePreset as ThemePreset);
  const theme = useMemo(() => buildTheme(preset, activeScheme), [preset, activeScheme]);
  const resolver = useMemo(
    () => buildResolver(preset, activeFontSize),
    [preset, activeFontSize],
  );

  return (
    <MantineProvider
      key={`${preset.key}-${activeScheme}`}
      theme={theme}
      cssVariablesResolver={resolver}
      forceColorScheme={activeScheme}
      defaultColorScheme={activeScheme}
    >
      <Notifications
          position="bottom-right"
          limit={3}
          autoClose={3200}
          styles={{
            // 容器默认左对齐，短通知会飘在中间；贴右才符合"右下角提示"的预期
            root: { alignItems: 'flex-end' },
            // margin-inline-start:auto 直接把每条通知推到容器右缘（对齐属性常被库样式盖掉）
            notification: { width: 'fit-content', maxWidth: 480, marginInlineStart: 'auto' },
          }}
        />
      <ModalsProvider modalProps={{ centered: true }}>
        {status === 'error'
          ? <BootError message={bootError} />
          : windowKind === 'settings'
            ? <SettingsWindow />
            : <AppShellLayout />}
        {windowKind === 'main' && <AppSpotlight />}
        <Dialogs />
        <ModsModal />
        <AvatarUploadModal />
        <AvatarPickerModal />
        {windowKind === 'main' && <SaveCandidatesModal />}
      </ModalsProvider>
    </MantineProvider>
  );
}

/** 独立设置窗口：只渲染设置页本体，没有三栏与命令面板 */
function SettingsWindow() {
  // 头部固定、内容区自己滚：外层禁滚，滚动发生在 SettingsPage 内部
  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      <SettingsPage />
    </div>
  );
}
