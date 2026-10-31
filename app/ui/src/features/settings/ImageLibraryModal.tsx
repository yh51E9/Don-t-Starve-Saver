import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Menu,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconPencil, IconPhotoUp, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getBridge } from '../../lib/bridge/api';
import { notify } from '../../lib/notify';
import { HoverPreviewImage } from '../../components/HoverPreviewImage';
import type { AvatarItem, ImageItem } from '../../lib/bridge/types';
import { formatBytes } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';

const GROUPS = [
  { value: 'avatars', label: '角色头像' },
  { value: 'official', label: '官方头像' },
  { value: 'modicons', label: 'Mod 图标' },
];

/** 说明讲清楚"这个界面是干什么的"：素材管理本位，换头像在世界卡右键 */
const GROUP_HINT: Record<string, string> = {
  avatars: '上传或 Mod 提供的自定义头像，在这里删除管理。',
  official: '随程序内置的官方角色头像，只读。',
  modicons: 'Mod 管理列表里的小图标。',
};

const SOURCE_LABEL: Record<string, string> = {
  upload: '上传版',
  official: '官方版',
  mod: 'Mod 版',
  auto: '自动',
  unknown: '兜底',
};

type CardItem = (ImageItem & Partial<AvatarItem>) | AvatarItem;

export function ImageLibraryModal({
  opened,
  onClose,
  onRefreshAvatars,
}: {
  opened: boolean;
  onClose: () => void;
  onRefreshAvatars: () => Promise<void>;
}) {
  const [group, setGroup] = useState('avatars');
  const [items, setItems] = useState<CardItem[] | null>(null);
  const [meta, setMeta] = useState<{ cache_count: number; cache_bytes: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const avatars = useAppStore((state) => state.avatars);
  const [renaming, setRenaming] = useState<{ key: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = () => {
    setItems(null);
    setSelected(new Set());
    getBridge()
      .then((bridge) => bridge.imageLibrary())
      .then((result) => {
        let list = result[group as keyof typeof result] as CardItem[];
        if (group === 'avatars') {
          // 官方层已剪切到「官方头像」组：这里只留可管理的（有上传/Mod 图）
          list = (list as AvatarItem[]).filter(
            (item) => item.sources?.some((s) => s.source !== 'official')) as CardItem[];
        }
        setItems(list);
        setMeta({ cache_count: result.cache_count, cache_bytes: result.cache_bytes });
      })
      .catch(() => setItems([]));
  };

  useEffect(() => {
    if (!opened) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, group]);

  // 上传完成后 store 里的头像引用会变，列表跟着刷新（上传走全局弹窗，没有回调）
  const avatarsRef = useRef(avatars);
  useEffect(() => {
    if (avatarsRef.current === avatars) return;
    avatarsRef.current = avatars;
    if (!opened || group !== 'avatars') return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatars]);

  /** 是否可删：官方组只读；角色头像看有没有可删层（上传/Mod） */
  const deletable = (item: CardItem): boolean => {
    if (group === 'official') return false;
    if (group === 'modicons') return true;
    return Boolean((item as AvatarItem).sources?.some((s) => s.deletable));
  };

  const selectableKeys = useMemo(
    () => (items ?? []).filter(deletable).map((item) => item.key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, group],
  );
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selected.has(key));
  const someSelected = selected.size > 0 && !allSelected;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableKeys));
  };

  const remove = async (key: string, source?: string) => {
    try {
      const bridge = await getBridge();
      await bridge.imageDelete(group, key, source);
      setItems((prev) => prev?.filter((item) => item.key !== key) ?? null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      await onRefreshAvatars();
      notify({ message: `已删除 ${key}，需要时会自动重建`, color: 'teal' });
    } catch {
      notify({ message: '删除失败', color: 'red' });
    }
  };

  /** 删除勾选的项（一次提交，后端逐个删） */
  const removeSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const bridge = await getBridge();
      const result = await bridge.imageDeleteMany(group, [...selected]);
      await onRefreshAvatars();
      load();
      notify({
        message: `已删除 ${result.removed} 张${result.failed.length ? `，${result.failed.length} 张失败` : ''}`,
        color: result.failed.length ? 'orange' : 'teal',
      });
    } catch {
      notify({ message: '批量删除失败', color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  /** 按层批量清空（上传版 / Mod 版）；官方版不提供批量 */
  const clearLayer = async (layer: 'upload' | 'mod') => {
    try {
      const bridge = await getBridge();
      const result = await bridge.avatarClearLayer(layer);
      load();
      await onRefreshAvatars();
      notify({
        message: `已清空 ${result.removed} 张${SOURCE_LABEL[layer]}`,
        color: 'teal',
      });
    } catch {
      notify({ message: '批量删除失败', color: 'red' });
    }
  };

  /** 上传一张头像到图片库（不绑定角色），显示名默认取文件名 */
  const uploadAsset = async () => {
    try {
      const bridge = await getBridge();
      const picked = await bridge.avatarPickImage();
      if (!picked.picked) return;
      const result = await bridge.avatarUploadAsset(picked.picked, picked.name ?? '');
      if (!result.uploaded) {
        notify({ message: '上传失败，请确认是 PNG 图片', color: 'red' });
        return;
      }
      load();
      notify({ message: `已加入图片库：${result.name ?? ''}`, color: 'teal' });
    } catch {
      notify({ message: '上传失败', color: 'red' });
    }
  };

  /** 重命名上传版素材 */
  const renameAsset = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      const bridge = await getBridge();
      if (renaming.key.startsWith('up_')) {
        await bridge.avatarRenameAsset(renaming.key, name);
      } else {
        await bridge.avatarSetName(renaming.key, name);
        await onRefreshAvatars();
      }
      setRenaming(null);
      load();
    } catch {
      notify({ message: '重命名失败', color: 'red' });
    }
  };

  /** Mod 图标重扫：清缓存里的 icon 再按已安装列表重解 */
  const scanModIcons = async () => {
    setBusy(true);
    try {
      const bridge = await getBridge();
      const result = await bridge.modiconsScan();
      load();
      notify({ message: `已扫描 ${result.mods} 个 Mod，解出 ${result.icons} 张图标`, color: 'teal' });
    } catch {
      notify({ message: '扫描失败', color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  /** 重建缓存：重扫 Mod 头像 + 清理旧缓存（唯一的"刷新"入口） */
  const rebuildCache = async () => {
    setBusy(true);
    try {
      const bridge = await getBridge();
      await bridge.avatarRebuild();
      await onRefreshAvatars();
      load();
      notify({ message: 'Mod 头像已重扫，旧缓存已清理', color: 'teal' });
    } catch {
      notify({ message: '重建失败', color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="图片库"
      size={680}
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
      <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
        <Group justify="space-between" wrap="nowrap">
          <SegmentedControl size="sm" data={GROUPS} value={group} onChange={setGroup} />
          {meta && (
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
              共 {meta.cache_count} 份 · {formatBytes(meta.cache_bytes)}
            </Text>
          )}
        </Group>
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" lh={1.6}>
          {GROUP_HINT[group]}
        </Text>

        {group !== 'official' && (
          <Group gap="xs" wrap="nowrap">
            {group === 'avatars' && (
              <Tooltip label="上传一张 PNG 到图片库，之后可重命名或分配给角色">
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconPhotoUp size={14} stroke={2} />}
                  onClick={() => void uploadAsset()}
                >
                  上传头像
                </Button>
              </Tooltip>
            )}
            {group === 'avatars' && (
              <Tooltip label="重新扫描 Mod 头像并清理旧缓存">
                <Button
                  variant="default"
                  size="xs"
                  loading={busy}
                  leftSection={<IconRefresh size={14} stroke={2} />}
                  onClick={() => void rebuildCache()}
                >
                  重建缓存
                </Button>
              </Tooltip>
            )}
            {group === 'modicons' && (
              <Tooltip label="按已安装 Mod 重新解析图标（只刷新本程序的缓存）">
                <Button
                  variant="default"
                  size="xs"
                  loading={busy}
                  leftSection={<IconRefresh size={14} stroke={2} />}
                  onClick={() => void scanModIcons()}
                >
                  扫描图标
                </Button>
              </Tooltip>
            )}
            <Checkbox
              size="xs"
              label="全选"
              checked={allSelected}
              indeterminate={someSelected}
              disabled={selectableKeys.length === 0}
              onChange={toggleAll}
            />
            <Button
              variant="subtle"
              color="red"
              size="xs"
              px={8}
              disabled={selected.size === 0}
              loading={busy}
              leftSection={<IconTrash size={14} stroke={2} />}
              onClick={() => void removeSelected()}
            >
              删除选中{selected.size > 0 ? `（${selected.size}）` : ''}
            </Button>
            <Box style={{ flex: 1 }} />
            <Menu position="bottom-end" withinPortal shadow="md">
              <Menu.Target>
                <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} stroke={2} />}>
                  批量删除
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>按层批量清空（官方版不可删）</Menu.Label>
                <Menu.Item color="red" onClick={() => void clearLayer('upload')}>
                  清空全部上传版
                </Menu.Item>
                <Menu.Item color="red" onClick={() => void clearLayer('mod')}>
                  清空全部 Mod 版
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        )}

        {!items ? (
          <Group justify="center" py="lg"><Loader size="sm" color="accent" /></Group>
        ) : items.length === 0 ? (
          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" ta="center" py="md">
            这一组暂时没有图片
          </Text>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
              gap: 10,
              padding: '2px 6px 10px 2px',
            }}
          >
            {items.map((item) => {
              const isAvatar = group === 'avatars' && 'sources' in item;
              const avatar = isAvatar ? (item as AvatarItem) : null;
              const displayLabel = item.label ?? item.key;
              const subLabel = displayLabel !== item.key ? item.key : null;
              const activeSource = avatar
                ? (avatar.active_source === 'auto'
                  ? (avatar.sources[0]?.source ?? 'unknown')
                  : avatar.active_source)
                : null;
              // 每个可删层一个删除钮（官方版不渲染）
              const deletableSources = avatar
                ? avatar.sources.filter((s) => s.deletable)
                : group === 'modicons' ? [{ source: 'modicons', deletable: true }] : [];
              const canSelect = deletable(item);
              const checked = selected.has(item.key);
              return (
                <Box
                  key={item.key}
                  p={10}
                  style={{
                    position: 'relative',
                    borderRadius: 'calc(var(--ds-radius) * 2)',
                    border: `0.5px solid ${checked ? 'var(--ds-accent)' : 'var(--ds-hairline)'}`,
                    background: 'var(--ds-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 132,
                  }}
                  onClick={() => canSelect && toggle(item.key)}
                >
                  {canSelect && (
                    <Checkbox
                      size="xs"
                      checked={checked}
                      onChange={() => toggle(item.key)}
                      onClick={(event) => event.stopPropagation()}
                      style={{ position: 'absolute', top: 8, right: 8 }}
                      aria-label={`选择 ${displayLabel}`}
                    />
                  )}
                  <Group wrap="nowrap" gap={10} align="flex-start">
                    {item.url ? (
                      <HoverPreviewImage
                        src={item.url}
                        alt={displayLabel}
                        size={52}
                        radius={9}
                        loadFull={group === 'modicons'
                          ? async () => (await (await getBridge()).modiconPreview(item.key)).url
                          : undefined}
                      />
                    ) : (
                      <div style={{ width: 52, height: 52, flex: 'none' }} />
                    )}
                    <Box style={{ minWidth: 0, flex: 1, paddingRight: canSelect ? 18 : 0 }}>
                      {/* 固定两行：名称主行 + id 副行，卡片高度因此整齐 */}
                      <Text fz="var(--ds-fs-meta)" fw={500} truncate title={item.key}>{displayLabel}</Text>
                      <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" truncate>
                        {subLabel ?? '\u00A0'}
                      </Text>
                      {avatar ? (
                        <Badge
                          size="sm"
                          variant="light"
                          color={activeSource === 'upload' ? 'teal' : activeSource === 'mod' ? 'indigo' : 'gray'}
                          mt={4}
                        >
                          {SOURCE_LABEL[activeSource ?? ''] ?? '自动'}
                        </Badge>
                      ) : (
                        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                          {formatBytes((item as ImageItem).size ?? 0)}
                        </Text>
                      )}
                    </Box>
                  </Group>

                  <Group gap={4} mt="auto" pt={8} wrap="nowrap">
                    {(item.key.startsWith('up_')
                      || Boolean(avatar?.sources.some((s) => s.source === 'upload'))) && (
                      <Tooltip label="重命名这张上传素材" openDelay={100}>
                        <Button
                          variant="default"
                          size="xs"
                          px={8}
                          leftSection={<IconPencil size={14} stroke={2} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            setRenameValue(displayLabel);
                            setRenaming({ key: item.key });
                          }}
                        >
                          重命名
                        </Button>
                      </Tooltip>
                    )}
                    {deletableSources.map((s) => {
                      // 悬停即提示删除动作与对象（按来源说清删的是什么）
                      const tip =
                        s.source === 'upload'
                          ? '移除上传的自定义头像'
                          : s.source === 'modicons'
                            ? '移除这张 Mod 图标'
                            : '移除 Mod 提供的角色头像';
                      const short = deletableSources.length > 1 ? (s.source === 'upload' ? '删除上传' : '删除Mod') : '删除';
                      return (
                        <Tooltip key={s.source} label={tip} openDelay={100}>
                          <Button
                            variant="subtle"
                            color="red"
                            size="xs"
                            px={8}
                            leftSection={<IconTrash size={14} stroke={2} />}
                            onClick={(event) => {
                              event.stopPropagation();
                              void remove(item.key, s.source === 'upload' || s.source === 'mod' ? s.source : undefined);
                            }}
                          >
                            {short}
                          </Button>
                        </Tooltip>
                      );
                    })}
                  </Group>
                </Box>
              );
            })}
          </div>
        )}
      </Stack>

      <Modal
        opened={renaming !== null}
        onClose={() => setRenaming(null)}
        title="重命名上传素材"
        size={360}
        centered
        styles={{ content: { background: 'var(--ds-surface)' } }}
      >
        <Stack gap="sm">
          <TextInput
            size="sm"
            label="显示名"
            value={renameValue}
            maxLength={40}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            data-autofocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') void renameAsset();
            }}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="sm" onClick={() => setRenaming(null)}>取消</Button>
            <Button size="sm" disabled={!renameValue.trim()} onClick={() => void renameAsset()}>保存</Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
