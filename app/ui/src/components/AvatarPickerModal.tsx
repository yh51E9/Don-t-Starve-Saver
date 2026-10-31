import { Box, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';

import { getBridge } from '../lib/bridge/api';
import type { AvatarItem } from '../lib/bridge/types';
import { useAppStore } from '../lib/store/useAppStore';

/**
 * 头像选择器（全局单例）：从图片库已有头像里挑一张指定给某个角色。
 * 世界卡右键与备份时间轴右键共用。
 */
export function AvatarPickerModal() {
  const forChar = useAppStore((state) => state.avatarPickerFor);
  const closePicker = useAppStore((state) => state.closeAvatarPicker);
  const refreshAvatars = useAppStore((state) => state.refreshAvatars);
  const [items, setItems] = useState<AvatarItem[] | null>(null);

  useEffect(() => {
    if (!forChar) return;
    setItems(null);
    getBridge()
      .then((bridge) => bridge.imageLibrary())
      .then((result) => setItems(result.avatars))
      .catch(() => setItems([]));
  }, [forChar]);

  const assign = async (sourceChar: string) => {
    if (!forChar) return;
    try {
      const bridge = await getBridge();
      await bridge.avatarAssignFrom(forChar, sourceChar);
      await refreshAvatars();
      closePicker();
    } catch {
      // assign 失败静默，弹窗保持
    }
  };

  return (
    <Modal
      opened={forChar !== null}
      onClose={closePicker}
      title={`为「${forChar ?? ''}」选择头像（来自图片库）`}
      size={620}
      styles={{
      content: {
        background: 'var(--ds-surface)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100dvh - 64px)',
      },
      header: { flexShrink: 0 },
      body: { overflowY: 'auto', minHeight: 0 },
    }}
    >
      <Stack gap="sm">
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
          点选一张头像，它会被复制为该角色的自定义头像（原角色不受影响）。
        </Text>
        {!items ? (
          <Group justify="center" py="lg"><Loader size="sm" color="accent" /></Group>
        ) : items.length === 0 ? (
          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" ta="center" py="md">
            图片库还是空的
          </Text>
        ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 8,
                padding: '2px 6px 10px 2px',
              }}
            >
              {items.map((item) => (
                <Box
                  key={item.key}
                  p={8}
                  onClick={() => void assign(item.key)}
                  style={{
                    borderRadius: 'calc(var(--ds-radius) * 2)',
                    border: '0.5px solid var(--ds-hairline)',
                    background: 'var(--ds-surface)',
                    cursor: 'pointer',
                    transition: 'border-color var(--ds-t-fast) ease',
                  }}
                  className="ds-pick-card"
                >
                  <Group wrap="nowrap" gap={8}>
                    {item.url ? (
                      <img
                        src={item.url}
                        alt={item.label}
                        width={40}
                        height={40}
                        style={{ borderRadius: 8, flex: 'none', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ width: 40, height: 40, flex: 'none' }} />
                    )}
                    <Box style={{ minWidth: 0 }}>
                      <Text fz="var(--ds-fs-meta)" truncate>{item.label}</Text>
                      <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" truncate>
                        {item.key}
                      </Text>
                    </Box>
                  </Group>
                </Box>
              ))}
            </div>
        )}
        <Group justify="flex-end">
          <Button variant="default" size="sm" onClick={closePicker}>取消</Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              closePicker();
              if (forChar) void useAppStore.getState().startAvatarUpload(forChar, false);
            }}
          >
            改为上传本地图片…
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
