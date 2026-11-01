import {
  Box,
  Button,
  Collapse,
  Container,
  Slider,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAppWindow,
  IconBrandBilibili,
  IconBrandGithub,
  IconDeviceFloppy,
  IconExternalLink,
  IconInfoCircle,
  IconKeyboard,
  IconLayoutGrid,
  IconPalette,
  IconPower,
  IconRotate2,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { OptionCards } from '../components/OptionCards';
import { Row } from '../components/Row';
import { Section } from '../components/Section';
import { getBridge } from '../lib/bridge/api';
import type { AvatarLibrary, Config } from '../lib/bridge/types';
import { formatBytes } from '../lib/format';
import { useAppStore } from '../lib/store/useAppStore';
import {
  activeShortcuts,
  comboFromEvent,
  formatCombo,
  resetShortcuts,
  saveShortcut,
  type ShortcutAction,
  type ShortcutDef,
} from '../lib/shortcuts';
import { PRESET_LIST } from '../theme/presets';
import { LAYOUT } from '../theme/layout';
import { ImageLibraryModal } from '../features/settings/ImageLibraryModal';

const NAV_ITEMS = [
  { id: 'sec-appearance', label: '外观', icon: IconPalette },
  { id: 'sec-resources', label: '图片与资源', icon: IconLayoutGrid },
  { id: 'sec-backup', label: '备份', icon: IconDeviceFloppy },
  { id: 'sec-window', label: '窗口', icon: IconAppWindow },
  { id: 'sec-shortcuts', label: '快捷键', icon: IconKeyboard },
  { id: 'sec-about', label: '关于', icon: IconInfoCircle },
];

/** CHANGELOG.md 极简渲染：## 版本段 → 折叠块，### 分组，- 条目 */
function ChangelogView({ markdown }: { markdown: string }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const blocks = markdown.split(/^## /m).filter((b) => b.trim() && !b.startsWith('# 更新日志'));
  return (
    <Stack gap={8}>
      {blocks.map((block) => {
        const [title, ...rest] = block.split('\n');
        const key = title.trim();
        const intro = rest.join('\n').replace(/### ([^\n]+)/g, '$1').trim();
        return (
          <Box key={key}>
            <UnstyledButton
              onClick={() => setOpenKey(openKey === key ? null : key)}
              w="100%"
              c="var(--ds-text-dim)"
            >
              <Group justify="space-between" wrap="nowrap">
                <Text fz="var(--ds-fs-body)" fw={500}>{key}</Text>
                <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                  {openKey === key ? '收起' : '展开'}
                </Text>
              </Group>
            </UnstyledButton>
            <Collapse expanded={openKey === key}>
              <Stack gap={3} pt={8} pl={4}>
                {intro.split('\n').filter(Boolean).map((line, index) => (
                  <Text
                    key={index}
                    fz="var(--ds-fs-micro)"
                    c={line.startsWith('**') ? 'var(--ds-text)' : 'var(--ds-text-dim)'}
                    lh={1.6}
                  >
                    {line.replace(/^\- /, '· ').replace(/\*\*/g, '')}
                  </Text>
                ))}
              </Stack>
            </Collapse>
          </Box>
        );
      })}
    </Stack>
  );
}

export function SettingsPage() {
  const config = useAppStore((state) => state.config);
  const options = useAppStore((state) => state.options);
  const stats = useAppStore((state) => state.stats);
  const platform = useAppStore((state) => state.platform);
  const version = useAppStore((state) => state.version);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const chooseFolder = useAppStore((state) => state.chooseFolder);
  const cleanup = useAppStore((state) => state.cleanup);
  const refreshAvatars = useAppStore((state) => state.refreshAvatars);
  const reveal = useAppStore((state) => state.reveal);
  const openResetSettings = useAppStore((state) => state.openResetSettings);
  const openResetBackupRoot = useAppStore((state) => state.openResetBackupRoot);
  const openExternal = useAppStore((state) => state.openExternal);
  const defaults = useAppStore((state) => state.defaults);
  const [previewOpen, setPreviewOpen] = useState(false);
  const openPreview = async () => {
    setPreviewOpen(true);
  };
  const draft = useAppStore((state) => state.settingsDraft);
  const dirty = useAppStore((state) => state.settingsDirty);
  const update = useAppStore((state) => state.settingsPreview);
  const previewFontSize = useAppStore((state) => state.previewFontSize);
  const setPreviewFontSize = (v: number) => useAppStore.setState({ previewFontSize: v });

  const [library, setLibrary] = useState<AvatarLibrary | null>(null);
  const [changelog, setChangelog] = useState('');
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(() => activeShortcuts());
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [activeSec, setActiveSec] = useState(NAV_ITEMS[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmaticUntil = useRef(0);

  const reloadLibrary = () => {
    getBridge()
      .then((bridge) => bridge.avatarLibrary())
      .then(setLibrary)
      .catch(() => setLibrary(null));
  };

  useEffect(() => {
    reloadLibrary();
    getBridge()
      .then((bridge) => bridge.getChangelog())
      .then((result) => setChangelog(result.markdown))
      .catch(() => setChangelog(''));
  }, [config]);

  // 改键捕获：进入捕获态后，下一次按键就是新键位（Esc 取消）
  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(event);
      if (!combo) return;
      saveShortcut(capturing, combo);
      setShortcuts(activeShortcuts());
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  if (!options) return null;

  const value: Config = { ...config, ...draft };

  const scrollTo = (id: string) => {
    const container = scrollRef.current;
    if (!container) return;
    setActiveSec(id); // 乐观高亮，平滑滚动期间不被 onScroll 抢走
    programmaticUntil.current = Date.now() + 900;
    const isLast = NAV_ITEMS[NAV_ITEMS.length - 1].id === id;
    if (isLast) {
      // 最后一段可能不满一屏，scrollIntoView 到不了底——直接滚到底
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    if (Date.now() < programmaticUntil.current) return; // 程序滚动期间不抢高亮
    let current = NAV_ITEMS[0].id;
    for (const item of NAV_ITEMS) {
      const el = document.getElementById(item.id);
      if (el && el.getBoundingClientRect().top - container.getBoundingClientRect().top < 140) {
        current = item.id;
      }
    }
    // 滚到底视为最后一节（否则「关于」永远高亮不到）
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
      current = NAV_ITEMS[NAV_ITEMS.length - 1].id;
    }
    setActiveSec(current);
  };

  const browseBackupRoot = async () => {
    const path = await chooseFolder('backup_root');
    if (path) update({ backup_root: path });
  };

  const save = async () => {
    await saveSettings(draft);
  };

  const isAbsolutePath = (path: string) =>
    /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');

  // 展示用绝对路径：配置里可能存的是便携相对路径（data/backups），实际落点是程序目录下的绝对路径
  const backupRootAbs = (() => {
    const raw = (value.backup_root ?? '').trim() || (defaults?.backup_root ?? '');
    if (!raw) return platform?.backup_root ?? '';
    if (isAbsolutePath(raw)) return raw;
    const base = (platform?.app_dir ?? '').replace(/[\\/]+$/, '');
    return base ? `${base}\\${raw.replace(/\//g, '\\')}` : raw;
  })();

  const browseGameDir = async () => {
    const path = await chooseFolder('game_dir');
    if (path) update({ game_dir: path });
  };

  return (
    <Box style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ImageLibraryModal
        opened={previewOpen}
        onClose={() => { setPreviewOpen(false); reloadLibrary(); }}
        onRefreshAvatars={refreshAvatars}
      />
      <Container size={LAYOUT.settingsW + 170} px="md" pt="lg" pb="sm" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
          <Group gap={12} align="center" wrap="nowrap">
            {/* 页首唯一重音：实心图块，图标取表面色保证两套主题都有对比 */}
            <Box
              style={{
                width: 38,
                height: 38,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 11,
                background: 'var(--ds-accent)',
                color: 'var(--ds-surface)',
                boxShadow: '0 3px 12px color-mix(in srgb, var(--ds-accent) 30%, transparent)',
              }}
            >
              <IconSettings size={22} stroke={2.2} />
            </Box>
            <Box>
              <Title order={3} className="ds-display" fz="var(--ds-fs-title)">设置</Title>
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={2}>
                外观、图片资源、备份策略与窗口行为
              </Text>
            </Box>
          </Group>
          <Group gap={10} wrap="nowrap">
            {dirty && (
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">有未保存的修改</Text>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={() => openResetSettings('appearance')}
            >
              还原外观默认
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => openResetSettings('all')}
            >
              还原全部默认
            </Button>
            <Button
              size="sm"
              leftSection={<IconDeviceFloppy size={18} stroke={1.8} />}
              onClick={() => void save()}
              disabled={!dirty}
            >
              保存设置
            </Button>
          </Group>
        </Group>

        <Group align="stretch" wrap="nowrap" gap="lg" style={{ flex: 1, minHeight: 0 }}>
          {/* 锚点导航：粘性，点击平滑滚动，滚动时高亮当前 */}
          <nav
            style={{
              width: 148,
              flex: 'none',
              position: 'sticky',
              top: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {NAV_ITEMS.map((item) => {
              const NavIcon = item.icon;
              const active = activeSec === item.id;
              return (
                <UnstyledButton
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  px={10}
                  py={7}
                  style={{
                    borderRadius: 'var(--ds-radius)',
                    background: active ? 'var(--ds-surface-hover)' : 'transparent',
                    color: active ? 'var(--ds-text)' : 'var(--ds-text-dim)',
                    borderLeft: `2px solid ${active ? 'var(--ds-accent)' : 'transparent'}`,
                    transition: 'background-color var(--ds-t-fast) ease, color var(--ds-t-fast) ease',
                  }}
                >
                  <Group gap={9} wrap="nowrap" align="center">
                    <NavIcon
                      size={17}
                      stroke={2}
                      color={active ? 'var(--ds-accent)' : 'var(--ds-text-faint)'}
                      style={{ flex: 'none' }}
                    />
                    <Text fz="var(--ds-fs-meta)">{item.label}</Text>
                  </Group>
                </UnstyledButton>
              );
            })}
          </nav>

          <Box style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100%' }} ref={scrollRef} onScroll={onScroll}>
            <Box id="sec-appearance">
              <Section icon={<IconPalette size={16} stroke={2.2} color="var(--ds-accent)" />} title="外观" size="md">
                {/* 卡片：主题 */}
                                  <Stack gap={12} w="100%">
          <Row label="主题" hint="换的是灯光和形状，灰阶不动">
                    <SimpleGrid cols={3} spacing="xs">
                      {PRESET_LIST.map((preset) => (
                        <Box
                          key={preset.key}
                          className="ds-theme-card"
                          data-selected={value.theme_preset === preset.key}
                          onClick={() => update({ theme_preset: preset.key })}
                        >
                          <Group gap={4} mb={7}>
                            <span style={{ width: 18, height: 18, background: preset.dark.bg, borderRadius: 1, border: '1px solid rgb(255 255 255 / 10%)' }} />
                            <span style={{ width: 18, height: 18, background: preset.dark.surface, borderRadius: 1 }} />
                            <span style={{ width: 18, height: 18, background: preset.dark.accent, borderRadius: 1 }} />
                            <span style={{ width: 18, height: 18, background: preset.light.bg, borderRadius: 1, border: '1px solid rgb(0 0 0 / 10%)' }} />
                            <span style={{ width: 18, height: 18, background: preset.light.accent, borderRadius: 1 }} />
                          </Group>
                          <Text fz="var(--ds-fs-body)" fw={500}>{preset.label}</Text>
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mt={2} lh={1.45}>{preset.blurb}</Text>
                        </Box>
                      ))}
                    </SimpleGrid>
                  </Row>

                {/* 卡片：明暗 */}
                                  <Row label="明暗" hint="跟随系统时，Windows 切换会自动生效；切换即刻预览，保存才生效">
                    <OptionCards
                      value={value.theme_mode}
                      onChange={(next) => update({ theme_mode: next as Config['theme_mode'] })}
                      items={options.theme_mode.map((item) => ({
                        value: item.value,
                        label: item.label,
                        hint: { auto: 'Windows 深浅色切换时自动跟随', dark: '墨色底 · 适合暗环境', light: '纸白底 · 适合亮环境' }[item.value] ?? '',
                      }))}
                    />
                  </Row>

                {/* 卡片：界面字号（五档标实际 px + 自定义） */}
                                  <Row label="界面字号" hint="拖动即时预览，松手记入草稿；14-22px 任意档位">
            <Stack gap={10} w="100%">
              <Slider
                value={previewFontSize ?? value.font_size}
                onChange={(v) => setPreviewFontSize(v)}
                onChangeEnd={(v) => update({ font_size: v })}
                min={14}
                max={22}
                step={1}
                label={(v) => `${v}px`}
                marks={Array.from({ length: 9 }, (_, i) => ({ value: 14 + i, label: String(14 + i) }))}
                mb={18}
                px={6}
              />
              <Box>
                <Button
                  variant="default"
                  size="compact-xs"
                  leftSection={<IconRotate2 size={14} stroke={1.8} />}
                  disabled={value.font_size === 17}
                  onClick={() => update({ font_size: 17 })}
                >
                  恢复默认（标准 17px）
                </Button>
              </Box>
            </Stack>
          </Row>
          </Stack>
              </Section>
            </Box>

            <Box id="sec-resources" mt="xl">
              <Section icon={<IconLayoutGrid size={16} stroke={2.2} color="var(--ds-accent)" />} title="图片与资源" size="md">
                {/* 卡片：游戏目录 */}
                                  <Stack gap={12} w="100%">
          <Row label="游戏目录" hint="读取角色头像；留空自动扫描 Steam 库">
                    <Stack gap={6} w="100%">
                      <Group gap="xs" wrap="nowrap">
                        <TextInput
                          size="sm"
                          placeholder="自动检测"
                          value={value.game_dir}
                          onChange={(event) => update({ game_dir: event.currentTarget.value })}
                          style={{ flex: 1 }}
                        />
                        <Button variant="default" size="sm" onClick={() => void browseGameDir()}>浏览…</Button>
                        <Button variant="default" size="sm" onClick={() => update({ game_dir: '' })}>自动</Button>
                      </Group>
                      {/* 即使留空自动检测，也要让人看见实际用的是哪个目录 */}
                      <Text
                        fz="var(--ds-fs-micro)"
                        c="var(--ds-text-faint)"
                        className="ds-mono"
                        truncate
                        title={value.game_dir || platform?.game_dir_auto || ''}
                      >
                        {(value.game_dir || platform?.game_dir_auto || '')
                          ? `${value.game_dir ? '使用' : '自动检测'}：${value.game_dir || platform?.game_dir_auto}`
                          : '未检测到游戏目录，可手动指定'}
                      </Text>
                    </Stack>
                  </Row>

                  <Row label="图片库" hint="存档槽与世界列表里的角色形象都在这里管理：官方版随程序内置，可上传自定义覆盖，Mod 头像自动收录">
                    <Stack gap={6} w="100%">
                      <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">
                        {library
                          ? `官方版 ${library.official_count} · 上传 ${library.upload_count} · Mod 版 ${library.mod_count} · 缺素材 ${library.missing.length} · 缓存 ${library.cache_count} 份（${formatBytes(library.cache_bytes)}）`
                          : '尚未扫描'}
                      </Text>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          variant="default"
                          size="sm"
                          leftSection={<IconLayoutGrid size={18} stroke={1.8} />}
                          onClick={() => void openPreview()}
                        >
                          预览
                        </Button>
                      </Group>
                      {library && library.missing.length > 0 && (
                        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono">
                          缺素材：{library.missing.join('、')}
                        </Text>
                      )}
                    </Stack>
                  </Row>
          </Stack>
              </Section>
            </Box>

            <Box id="sec-backup" mt="xl">
              <Section icon={<IconDeviceFloppy size={16} stroke={2.2} color="var(--ds-accent)" />} title="备份" size="md">
                {/* 卡片：备份位置 */}
                                  <Stack gap={12} w="100%">
          <Row label="备份目录" hint="默认在程序同级目录，不污染文档目录">
                    <Stack gap={6} w="100%">
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        size="sm"
                        value={backupRootAbs}
                        onChange={(event) => update({ backup_root: event.currentTarget.value })}
                        title={backupRootAbs}
                        style={{ flex: 1 }}
                      />
                      <Button variant="default" size="sm" onClick={() => void browseBackupRoot()}>浏览…</Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => openResetBackupRoot()}
                        disabled={value.backup_root === defaults?.backup_root}
                      >
                        恢复默认位置
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => void reveal('backup_root')}
                        aria-label="打开备份目录"
                      >
                        <IconExternalLink size={14} stroke={1.8} />
                      </Button>
                    </Group>
                    {value.backup_root && !isAbsolutePath(value.backup_root) && (
                      <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" className="ds-mono" truncate>
                        配置保存为相对路径 {value.backup_root}（跟随程序目录，换盘不用改）
                      </Text>
                    )}
                    </Stack>
                  </Row>

                {/* 卡片：保留策略 */}
                                  <Row label="保留策略" hint="天数模式更保守：超龄且超份数才删">
                    <Stack gap={10} w="100%">
                      <OptionCards
                        value={value.keep_mode}
                        onChange={(next) => update({ keep_mode: next as Config['keep_mode'] })}
                        items={options.keep_mode.map((item) => ({
                          value: item.value,
                          label: item.label,
                          hint: { count: '只看份数：超出就删最旧', days: '份数与天数双限制，更保守' }[item.value] ?? '',
                        }))}
                      />
                      {value.keep_mode === 'days' && (
                        <Group gap="lg" wrap="wrap">
                          <Group gap="sm" wrap="nowrap">
                            <NumberInput
                              size="sm"
                              w={LAYOUT.numberW}
                              min={0}
                              max={3650}
                              clampBehavior="strict"
                              value={value.keep_days_manual}
                              onChange={(next) => update({ keep_days_manual: typeof next === 'number' ? next : 0 })}
                            />
                            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">手动保留天数（0=不限）</Text>
                          </Group>
                          <Group gap="sm" wrap="nowrap">
                            <NumberInput
                              size="sm"
                              w={LAYOUT.numberW}
                              min={0}
                              max={3650}
                              clampBehavior="strict"
                              value={value.keep_days_auto}
                              onChange={(next) => update({ keep_days_auto: typeof next === 'number' ? next : 0 })}
                            />
                            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">自动保留天数（0=不限）</Text>
                          </Group>
                        </Group>
                      )}
                      <Group gap="lg" wrap="wrap">
                        <Group gap="sm" wrap="nowrap">
                          <NumberInput
                            size="sm"
                            w={LAYOUT.numberW}
                            min={1}
                            max={999}
                            clampBehavior="strict"
                            value={value.keep}
                            onChange={(next) => update({ keep: typeof next === 'number' ? next : 1 })}
                          />
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">手动保留份数</Text>
                        </Group>
                        <Group gap="sm" wrap="nowrap">
                          <NumberInput
                            size="sm"
                            w={LAYOUT.numberW}
                            min={1}
                            max={999}
                            clampBehavior="strict"
                            value={value.keep_auto}
                            onChange={(next) => update({ keep_auto: typeof next === 'number' ? next : 1 })}
                          />
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">自动保留份数（分开计数）</Text>
                        </Group>
                      </Group>
                      <Group gap="sm" wrap="nowrap">
                        <Text fz="var(--ds-fs-meta)" className="ds-mono">
                          占用 {formatBytes(stats.total_bytes)} · {stats.count} 份
                        </Text>
                        <Button
                          variant="default"
                          size="compact-xs"
                          leftSection={<IconTrash size={14} stroke={1.8} />}
                          onClick={() => void cleanup()}
                        >
                          清理超限旧备份
                        </Button>
                      </Group>
                    </Stack>
                  </Row>

                {/* 卡片：自动备份 */}
                                  <Row label="自动备份" hint="巡检世界文件，连续两轮稳定才备份">
                    <Group gap="md" wrap="nowrap">
                      <Switch
                        size="xs"
                        color="accent"
                        checked={value.auto_backup}
                        onChange={(event) => update({ auto_backup: event.currentTarget.checked })}
                      />
                      <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">
                        存档变化时自动打快照，同一世界 60 秒内只备一次
                      </Text>
                    </Group>
                  </Row>

                  <Row label="触发方式" hint="变化时 = 存档写完就拍；间隔 = 定时巡检">
                    <Stack gap={8} w="100%">
                      <OptionCards
                        value={value.auto_mode}
                        onChange={(next) => update({ auto_mode: next as Config['auto_mode'] })}
                        items={options.auto_mode.map((item) => ({
                          value: item.value,
                          label: item.label,
                          hint: { change: '存档写完就拍，最跟手', interval: '每 N 分钟巡检一次', both: '两条线都开，互相让路' }[item.value] ?? '',
                        }))}
                      />
                      {(value.auto_mode === 'interval' || value.auto_mode === 'both') && (
                        <Group gap="sm" wrap="nowrap">
                          <NumberInput
                            size="sm"
                            w={LAYOUT.numberW}
                            min={1}
                            max={1440}
                            clampBehavior="strict"
                            value={value.auto_interval_min}
                            onChange={(next) => update({ auto_interval_min: typeof next === 'number' ? next : 30 })}
                          />
                          <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">分钟一份</Text>
                        </Group>
                      )}
                      {(value.auto_mode === 'interval' || value.auto_mode === 'both') && (
                        <Switch
                          size="xs"
                          color="accent"
                          checked={value.auto_only_when_running}
                          onChange={(event) => update({ auto_only_when_running: event.currentTarget.checked })}
                          label="只在游戏运行时定时备份"
                        />
                      )}
                      <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                        最小间隔 {value.auto_min_gap_min} 分钟：变化备份和定时备份谁刚打过，另一个就让路
                      </Text>
                    </Stack>
                  </Row>
          </Stack>
              </Section>
            </Box>

            <Box id="sec-window" mt="xl">
              <Section icon={<IconPower size={16} stroke={2.2} color="var(--ds-accent)" />} title="窗口" size="md">
                                  <Stack gap={12} w="100%">
          <Row label="关闭按钮" hint="默认隐藏到托盘，自动备份会继续跑">
                    <OptionCards
                      value={value.close_action}
                      onChange={(next) => update({ close_action: next as Config['close_action'] })}
                      items={options.close_action.map((item) => ({
                        value: item.value,
                        label: item.label,
                        hint: { ask: '每次点叉都问一下', tray: '后台继续自动备份（推荐）', exit: '直接退出程序' }[item.value] ?? '',
                      }))}
                    />
                  </Row>
          </Stack>
              </Section>
            </Box>

            <Box id="sec-shortcuts" mt="xl">
              <Section icon={<IconKeyboard size={16} stroke={2.2} color="var(--ds-accent)" />} title="快捷键" size="md">
                <Stack gap={12} w="100%">
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" lh={1.6}>
                    点击键位框，按下新的组合键即可修改（Esc 取消）。快捷键只在主界面生效，输入框内打字时不会触发。
                  </Text>
                  {shortcuts.map((item) => (
                    <Group key={item.id} justify="space-between" wrap="nowrap" gap={12}>
                      <Box style={{ minWidth: 0 }}>
                        <Text fz="var(--ds-fs-meta)">{item.label}</Text>
                        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">{item.hint}</Text>
                      </Box>
                      <Button
                        variant={capturing === item.id ? 'light' : 'default'}
                        color={capturing === item.id ? 'red' : 'gray'}
                        size="compact-sm"
                        miw={120}
                        className="ds-mono"
                        onClick={() => setCapturing(capturing === item.id ? null : item.id)}
                      >
                        {capturing === item.id ? '按下新键…' : formatCombo(item.combo)}
                      </Button>
                    </Group>
                  ))}
                  <Group justify="flex-end">
                    <Button
                      variant="default"
                      size="sm"
                      leftSection={<IconRotate2 size={16} stroke={1.8} />}
                      onClick={() => {
                        resetShortcuts();
                        setShortcuts(activeShortcuts());
                        setCapturing(null);
                      }}
                    >
                      恢复默认
                    </Button>
                  </Group>
                </Stack>
              </Section>
            </Box>

            <Box id="sec-about" mt="xl">
              <Section icon={<IconInfoCircle size={16} stroke={2.2} color="var(--ds-accent)" />} title="关于" size="md">
                {/* 卡片：版本 */}
                                  <Stack gap={12} w="100%">
          <Row label="版本" hint="首个正式版本：备份、恢复与图片管理一站式工具">
                    <Stack gap={10} w="100%">
                      <Text fz="var(--ds-fs-body)" fw={600} className="ds-mono">
                        v{version || '1.0.0'}
                      </Text>
                      <Group gap={8} wrap="nowrap">
                        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" style={{ width: 40 }}>前端</Text>
                        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" className="ds-mono">
                          React 19.3 · Mantine 9.7 · Vite 8.3 · TypeScript 7.0
                        </Text>
                      </Group>
                      <Group gap={8} wrap="nowrap">
                        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" style={{ width: 40 }}>后端</Text>
                        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-dim)" className="ds-mono">
                          Python 3.14 · pywebview 6.2
                        </Text>
                      </Group>
                      {changelog && (
                        <Box>
                          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" mb={6}>更新详情</Text>
                          <ChangelogView markdown={changelog} />
                        </Box>
                      )}
                    </Stack>
                  </Row>

                {/* 卡片：安装目录 */}
                                  <Row label="安装目录" hint="配置、备份、日志都在这个目录的 data\ 下，整目录拷走即完整迁移">
                    <Stack gap={6}>
                      <Text fz="var(--ds-fs-micro)" className="ds-mono" c="var(--ds-text-dim)" style={{ wordBreak: 'break-all' }}>
                        {platform?.app_dir || '—'}
                      </Text>
                      <Group gap="xs">
                        <Button
                          variant="default"
                          size="sm"
                          leftSection={<IconExternalLink size={16} stroke={1.8} />}
                          onClick={() => void reveal('backup_root')}
                        >
                          打开备份目录
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          leftSection={<IconExternalLink size={16} stroke={1.8} />}
                          onClick={() => void reveal('log_dir')}
                        >
                          打开日志目录
                        </Button>
                      </Group>
                    </Stack>
                  </Row>

                {/* 卡片：作者 */}
                <Row label="作者" hint="一个人做的独立工具，欢迎来逛逛主页">
                  <Stack gap={8}>
                    <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)" lh={1.6}>
                      饥荒单机版存档备份工具由我独立设计与开发。使用中有问题或建议，欢迎来 B 站找我。
                    </Text>
                    <Group gap="xs">
                      <Button
                        variant="default"
                        size="sm"
                        leftSection={<IconBrandBilibili size={16} stroke={1.8} />}
                        onClick={() => void openExternal('https://space.bilibili.com/435302929')}
                      >
                        B 站主页
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        leftSection={<IconBrandGithub size={16} stroke={1.8} />}
                        onClick={() => void openExternal('https://github.com/yh51E9/Don-t-Starve-Saver')}
                      >
                        GitHub 项目
                      </Button>
                    </Group>
                  </Stack>
                </Row>
          </Stack>
              </Section>
            </Box>
          </Box>
        </Group>
      </Container>
    </Box>
  );
}
