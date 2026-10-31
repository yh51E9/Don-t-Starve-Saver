import { Center } from '@mantine/core';
import { IconArchiveOff } from '@tabler/icons-react';

import { EmptyState } from '../components/EmptyState';
import { BackupTimeline } from '../features/backups/BackupTimeline';
import { WorldHeader } from '../features/backups/WorldHeader';
import { ProgressOverlay } from '../features/jobs/ProgressOverlay';
import { useAppStore } from '../lib/store/useAppStore';

export function WorldsPage() {
  const world = useAppStore(
    (state) => state.worlds.find((item) => item.id === state.selectedSlot) ?? null,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {world ? (
        <>
          <WorldHeader world={world} />
          {/* 滚动只发生在表格内部：分页条永远钉在底部，不跟着表格滚走 */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <BackupTimeline world={world} />
          </div>
          <ProgressOverlay />
        </>
      ) : (
        <Center style={{ flex: 1 }}>
          <EmptyState
            icon={IconArchiveOff}
            title="还没有选中世界"
            hint="在左边挑一个世界，或者检查顶部的存档目录"
          />
        </Center>
      )}
    </div>
  );
}
