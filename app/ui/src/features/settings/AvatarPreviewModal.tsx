import { Badge, Box, Button, Group, Loader, Modal, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { getBridge } from '../../lib/bridge/api';
import { notify } from '../../lib/notify';
import { formatBytes } from '../../lib/format';

interface AvatarItem {
  char: string;
  url: string;
  missing: boolean;
  group: string;
}

const GROUP_LABEL: Record<string, string> = {
  base: '本体',
  dlc: 'DLC',
  mod: 'Mod',
  missing: '缺素材',
};

export function AvatarPreviewModal({
  opened,
  onClose,
  onRefreshAvatars,
}: {
  opened: boolean;
  onClose: () => void;
  onRefreshAvatars: () => Promise<void>;
}) {
  const [items, setItems] = useState<AvatarItem[] | null>(null);
  const [meta, setMeta] = useState<{ cache_count: number; cache_bytes: number } | null>(null);

  useEffect(() => {
    if (!opened) return;
    setItems(null);
    getBridge()
      .then((bridge) => bridge.avatarPreview())
      .then((result) => {
        setItems(result.items);
        setMeta({ cache_count: result.cache_count, cache_bytes: result.cache_bytes });
      })
      .catch(() => setItems([]));
  }, [opened]);

  const remove = async (name: string) => {
    try {
      const bridge = await getBridge();
      await bridge.avatarDelete(name);
      setItems((prev) => prev?.filter((item) => item.char !== name) ?? null);
      await onRefreshAvatars();
      notify({ message: `已删除 ${name}，访问时会自动重建`, color: 'teal' });
    } catch {
      notify({ message: '删除失败', color: 'red' });
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="头像库预览"
      size={640}
      styles={{ content: { background: 'var(--ds-surface)' } }}
    >
      <Stack gap="sm">
        {meta && (
          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">
            缓存 {meta.cache_count} 份（{formatBytes(meta.cache_bytes)}）· 删除后不影响任何数据，访问时会自动重建
          </Text>
        )}

        {!items ? (
          <Group justify="center" py="lg"><Loader size="sm" color="accent" /></Group>
        ) : items.length === 0 ? (
          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" ta="center" py="md">
            没有可预览的头像
          </Text>
        ) : (
          <ScrollArea style={{ maxHeight: 400 }} offsetScrollbars scrollbarSize={8}
            styles={{ thumb: { background: 'var(--ds-hairline)' } }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 10,
              }}
            >
              {items.map((item) => (
                <Box
                  key={item.char}
                  p={10}
                  style={{
                    borderRadius: 8,
                    border: '0.5px solid var(--ds-hairline)',
                    background: 'var(--ds-surface)',
                  }}
                >
                  <Group wrap="nowrap" gap={10}>
                    {item.url ? (
                      <img
                        src={item.url}
                        alt={item.char}
                        width={48}
                        height={48}
                        style={{ borderRadius: 8, flex: 'none', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ width: 48, height: 48, flex: 'none' }} />
                    )}
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text fz="var(--ds-fs-meta)" truncate className="ds-mono">{item.char}</Text>
                      <Badge
                        size="xs"
                        variant="subtle"
                        color={item.missing ? 'red' : item.group === 'mod' ? 'grape' : 'teal'}
                      >
                        {GROUP_LABEL[item.group] ?? item.group}
                      </Badge>
                    </Box>
                  </Group>
                  <Tooltip label="删除缓存（自动重建）">
                    <Button
                      variant="subtle"
                      color="red"
                      size="compact-xs"
                      w="100%"
                      mt={6}
                      leftSection={<IconTrash size={14} stroke={1.8} />}
                      onClick={() => void remove(item.char)}
                    >
                      删除
                    </Button>
                  </Tooltip>
                </Box>
              ))}
            </div>
          </ScrollArea>
        )}

        <Group justify="flex-end">
          <Button variant="default" size="sm" onClick={onClose}>关闭</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
