import { AppShell, useAppShellResize } from '@mantine/core';

import { WorldRail } from '../features/worlds/WorldRail';
import { SettingsPage } from '../pages/SettingsPage';
import { WorldsPage } from '../pages/WorldsPage';
import { loadLayoutSizes, saveLayoutSizes } from '../lib/layoutStorage';
import { useAppStore } from '../lib/store/useAppStore';
import { LAYOUT } from '../theme/layout';
import { Header } from './Header';

export function AppShellLayout() {
  const view = useAppStore((state) => state.view);
  const isWorlds = view === 'worlds';

  const saved = loadLayoutSizes();
  const resize = useAppShellResize({
    navbar: { min: LAYOUT.railMin, max: LAYOUT.railMax, label: '拖拽调整世界栏宽度' },
    // 只回填 navbar：旧数据里的 aside 宽度若被写回，会继续在右侧留一条空白
    initialSizes: saved.navbar ? { navbar: saved.navbar } : {},
    onResizeEnd: (sizes) => saveLayoutSizes({ navbar: sizes.navbar }),
  });

  return (
    <AppShell
      className="ds-app"
      resize={resize}
      header={{ height: LAYOUT.headerH }}
      navbar={{ width: LAYOUT.railW, breakpoint: '0em' }}
      padding={0}
    >
      <AppShell.Header p={0}>
        <Header />
      </AppShell.Header>
      <WorldRail />
      <AppShell.Main>
        {isWorlds ? <WorldsPage /> : <SettingsPage />}
      </AppShell.Main>
    </AppShell>
  );
}
