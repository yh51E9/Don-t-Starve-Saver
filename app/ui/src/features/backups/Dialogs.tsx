import {
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconInfoCircle,
  IconShieldCheck,
  IconTrendingDown,
  IconTrashX,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { formatBytes } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';
import type { Config } from '../../lib/bridge/types';

/** 还原默认：显示"哪些项会变"的辅助 */
const RESET_LABELS: Record<string, string> = {
  theme_mode: '明暗',
  theme_preset: '主题',
  font_size: '字号',
  auto_backup: '自动备份',
  auto_mode: '触发方式',
  auto_interval_min: '备份间隔（分钟）',
  auto_min_gap_min: '最小间隔（分钟）',
  auto_only_when_running: '仅游戏运行时备份',
  keep: '手动保留份数',
  keep_auto: '自动保留份数',
  keep_mode: '保留策略',
  keep_days_manual: '手动保留天数',
  keep_days_auto: '自动保留天数',
  close_action: '关闭按钮行为',
};
const APPEARANCE_KEYS = ['theme_mode', 'theme_preset', 'font_size'];
const VALUE_LABELS: Record<string, Record<string, string>> = {
  theme_mode: { auto: '跟随系统', dark: '暗色', light: '亮色' },
  theme_preset: { nightfall: '夜航', ledger: '野外手账', brass: '暗铜机械' },
  font_size: { 15: '小', 16: '偏小', 17: '标准', 18: '偏大', 19: '大' },
  auto_mode: { change: '变化时', interval: '固定间隔', both: '两者' },
  keep_mode: { count: '按份数', days: '按天数' },
  close_action: { ask: '每次询问', tray: '隐藏到托盘', exit: '直接退出' },
};

function displayValue(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? '开' : '关';
  const labels = VALUE_LABELS[key];
  if (
    labels &&
    (typeof value === 'string' || typeof value === 'number') &&
    labels[String(value)] !== undefined
  ) {
    return labels[String(value)];
  }
  if (Array.isArray(value)) return value.map(String).join(' / ');
  return String(value);
}

function resetDiffItems(
  scope: 'appearance' | 'all',
  config: Config,
  draft: Partial<Config>,
  defaults: Config,
): Array<{ key: string; label: string; from: string; to: string }> {
  const effective = { ...config, ...draft };
  const keys = scope === 'appearance' ? APPEARANCE_KEYS : Object.keys(RESET_LABELS);
  return keys
    .filter(
      (key) =>
        key in defaults &&
        JSON.stringify(effective[key as keyof Config]) !==
          JSON.stringify(defaults[key as keyof Config]),
    )
    .map((key) => ({
      key,
      label: RESET_LABELS[key] ?? key,
      from: displayValue(key, effective[key as keyof Config]),
      to: displayValue(key, defaults[key as keyof Config]),
    }));
}

export function Dialogs() {
  const dialog = useAppStore((state) => state.dialog);
  const closeDialog = useAppStore((state) => state.closeDialog);
  const confirmRestore = useAppStore((state) => state.confirmRestore);
  const confirmDelete = useAppStore((state) => state.confirmDelete);
  const confirmDeleteSave = useAppStore((state) => state.confirmDeleteSave);
  const confirmDeleteBackups = useAppStore((state) => state.confirmDeleteBackups);
  const resolveClose = useAppStore((state) => state.resolveClose);
  const resolveSettingsClose = useAppStore((state) => state.resolveSettingsClose);
  const resetSettings = useAppStore((state) => state.resetSettings);
  const restoreBackupRoot = useAppStore((state) => state.restoreBackupRoot);
  const config = useAppStore((state) => state.config);
  const defaults = useAppStore((state) => state.defaults);
  const settingsDraft = useAppStore((state) => state.settingsDraft);
  const worlds = useAppStore((state) => state.worlds);
  const [remember, setRemember] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [withBackups, setWithBackups] = useState(false);
  const [keepLatest, setKeepLatest] = useState(true);
  const [gameAck, setGameAck] = useState(false);

  const kind = dialog?.kind ?? null;

  useEffect(() => {
    if (kind === 'close') setRemember(false);
    if (kind === 'restore') setGameAck(false);
    if (kind === 'deleteSave') {
      setConfirmText('');
      setWithBackups(false);
    }
    if (kind === 'deleteBackups') setKeepLatest(true);
  }, [kind]);

  const preview = dialog?.kind === 'restore' ? dialog.preview : null;
  const loading = dialog?.kind === 'restore' ? dialog.loading : false;
  const delta = preview?.delta_days ?? null;
  const saveWorld = dialog?.kind === 'deleteSave'
    ? worlds.find((item) => item.id === dialog.slotId) ?? null
    : null;

  return (
    <>
      <Modal
        opened={kind === 'restore'}
        onClose={closeDialog}
        title="确认恢复"
        size={520}
        closeOnClickOutside={false}
      >
        {loading || !preview ? (
          <Group justify="center" py={40}><Loader size="sm" color="accent" /></Group>
        ) : (
          <Stack gap="sm" data-autofocus tabIndex={-1}>
            <Box className="ds-panel" p="sm">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Box>
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">当前存档</Text>
                  <Text className="ds-day" fz={30}>{preview.current_day}</Text>
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">天</Text>
                </Box>
                <Text size="lg" c="var(--ds-text-faint)">→</Text>
                <Box ta="right">
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">这份备份</Text>
                  <Text className="ds-day" fz={30} c="var(--ds-accent)">
                    {preview.backup_day ?? '—'}
                  </Text>
                  <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">天</Text>
                </Box>
              </Group>

              <Group gap={6} mt={8} wrap="nowrap">
                {delta !== null && delta < 0 && (
                  <>
                    <IconTrendingDown size={14} stroke={1.8} color="var(--ds-danger)" />
                    <Text fz="var(--ds-fs-body)" c="var(--ds-danger)">会退回 {-delta} 天</Text>
                  </>
                )}
                {delta === 0 && (
                  <>
                    <IconInfoCircle size={14} stroke={1.8} color="var(--ds-text-dim)" />
                    <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">同一天，仅覆盖文件</Text>
                  </>
                )}
                {delta !== null && delta > 0 && (
                  <>
                    <IconAlertTriangle size={14} stroke={1.8} color="var(--ds-danger)" />
                    <Text fz="var(--ds-fs-meta)" c="var(--ds-danger)">
                      备份比当前存档更新，这不正常，请确认没有选错
                    </Text>
                  </>
                )}
                {delta === null && (
                  <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)">备份里没有天数信息</Text>
                )}
              </Group>

              <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" mt={6}>
                将写回 {preview.files} 个文件 · {formatBytes(preview.bytes)}
              </Text>
            </Box>

            {preview.warnings.length > 0 && (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />}>
                <Stack gap={2}>
                  {preview.warnings.map((warning) => (
                    <Text key={warning} fz="var(--ds-fs-meta)">{warning}</Text>
                  ))}
                </Stack>
              </Alert>
            )}

            {preview.game_running ? (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />}>
                <Stack gap={6}>
                  <Text fz="var(--ds-fs-meta)" fw={600}>检测到饥荒正在运行</Text>
                  <Text fz="var(--ds-fs-meta)">
                    游戏正在玩<b>这个存档</b>的话，恢复会被游戏下一次存盘覆盖回去——那种情况请先退出游戏。
                    停在主菜单、或正在玩<b>别的存档</b>，现在恢复就是安全的。
                  </Text>
                  <Checkbox
                    size="sm"
                    checked={gameAck}
                    onChange={(event) => setGameAck(event.currentTarget.checked)}
                    label="我确认游戏没有在玩这个存档"
                  />
                </Stack>
              </Alert>
            ) : (
              <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)" lh={1.6}>
                恢复时请确保饥荒没有运行，否则游戏会用内存里的进度把它盖回去。
              </Text>
            )}
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" lh={1.6}>
              覆盖前会自动为当前状态拍一份「恢复前」快照，恢复错了还能退回来。
            </Text>
          </Stack>
        )}

        <Group justify="flex-end" mt="lg" gap="xs">
          <Button variant="default" size="sm" onClick={closeDialog}>取消</Button>
          <Button
            size="sm"
            onClick={() => void confirmRestore(gameAck)}
            disabled={loading || !preview || (delta !== null && delta > 0) || (preview.game_running && !gameAck)}
          >
            确认恢复
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={kind === 'delete'}
        onClose={closeDialog}
        title="删除这份备份"
        size={460}
      >
        {dialog?.kind === 'delete' && (
          <Stack gap="xs" data-autofocus tabIndex={-1}>
            <Text fz="var(--ds-fs-body)">确定永久删除这份备份吗？</Text>
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" className="ds-mono">
              {dialog.backup.time} · {dialog.backup.day ?? '?'} 天 · {formatBytes(dialog.backup.size_bytes)}
            </Text>
            <Text fz="var(--ds-fs-meta)" c="var(--ds-danger)">删除后无法恢复。</Text>
          </Stack>
        )}
        <Group justify="flex-end" mt="lg" gap="xs">
          <Button variant="default" size="sm" onClick={closeDialog}>取消</Button>
          <Button color="red" size="sm" onClick={() => void confirmDelete()}>删除</Button>
        </Group>
      </Modal>

      <Modal
        opened={kind === 'deleteSave'}
        onClose={closeDialog}
        title="删除存档（危险操作）"
        size={520}
        closeOnClickOutside={false}
      >
        {dialog?.kind === 'deleteSave' && saveWorld && (
          <Stack gap="sm">
            <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)" lh={1.6}>
              将删除 <Text span fw={600} c="var(--ds-text)">{saveWorld.character_label}</Text> 的
              第 {dialog.slotId} 号存档（{saveWorld.mode_label} · {saveWorld.day} 天）。
              游戏里这个槽位会变成"未创建"状态。
            </Text>

            <Box className="ds-panel" p="sm">
              <Stack gap={6}>
                <Group gap={7} wrap="nowrap">
                  <IconShieldCheck size={18} stroke={1.8} color="var(--ds-accent)" />
                  <Text fz="var(--ds-fs-meta)">删除前会自动拍一份快照，存进备份列表（可恢复）</Text>
                </Group>
                <Group gap={7} wrap="nowrap">
                  <IconShieldCheck size={18} stroke={1.8} color="var(--ds-accent)" />
                  <Text fz="var(--ds-fs-meta)">
                    存档文件移入回收站（backups\_trash），保留 7 天，不直接抹掉
                  </Text>
                </Group>
              </Stack>
            </Box>

            {dialog.running && (
              <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
                <Text fz="var(--ds-fs-meta)">
                  检测到饥荒正在运行——请先完全退出游戏，否则删除会失败。
                </Text>
              </Alert>
            )}

            <Checkbox
              size="sm"
              checked={withBackups}
              onChange={(event) => setWithBackups(event.currentTarget.checked)}
              label={`同时删除这个存档的 ${saveWorld.backup_count} 份备份（默认保留，以后还能恢复）`}
              disabled={saveWorld.backup_count === 0}
            />

            <TextInput
              size="sm"
              label={`输入槽位号 ${dialog.slotId} 确认`}
              placeholder={dialog.slotId}
              value={confirmText}
              onChange={(event) => setConfirmText(event.currentTarget.value)}
              data-autofocus
            />
          </Stack>
        )}

        <Group justify="flex-end" mt="lg" gap="xs">
          <Button variant="default" size="sm" onClick={closeDialog}>取消</Button>
          <Button
            color="red"
            size="sm"
            leftSection={<IconTrashX size={18} stroke={1.8} />}
            disabled={
              !dialog || dialog.kind !== 'deleteSave' || confirmText !== dialog.slotId || dialog.running
            }
            onClick={() => void confirmDeleteSave(withBackups)}
          >
            删除存档
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={kind === 'deleteBackups'}
        onClose={closeDialog}
        title="删除所有备份"
        size={460}
      >
        {dialog?.kind === 'deleteBackups' && (
          <Stack gap="sm" data-autofocus tabIndex={-1}>
            <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
              这个存档共有 <Text span fw={600} c="var(--ds-text)">{dialog.count}</Text> 份备份。
            </Text>
            <Checkbox
              size="sm"
              checked={keepLatest}
              onChange={(event) => setKeepLatest(event.currentTarget.checked)}
              label="保留最新一份（推荐，留条退路）"
              disabled={dialog.count === 0}
            />
            <Text fz="var(--ds-fs-meta)" c="var(--ds-danger)">
              删除后无法恢复（回收站只保护存档文件，不保护备份）。
            </Text>
          </Stack>
        )}
        <Group justify="flex-end" mt="lg" gap="xs">
          <Button variant="default" size="sm" onClick={closeDialog}>取消</Button>
          <Button
            color="red"
            size="sm"
            disabled={!dialog || dialog.kind !== 'deleteBackups' || dialog.count === 0}
            onClick={() => void confirmDeleteBackups(keepLatest)}
          >
            删除
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={kind === 'close'}
        onClose={closeDialog}
        title="关闭窗口"
        size={420}
        centered
        zIndex={5000}
        styles={{
          content: {
            background: 'var(--ds-surface)',
            display: 'flex',
            flexDirection: 'column',
          },
          header: { flexShrink: 0 },
          body: { paddingTop: 4 },
        }}
      >
        <Stack gap="md" data-autofocus tabIndex={-1} pb="xs">
          <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)" lh={1.6}>
            隐藏到托盘可让自动备份继续运行；直接退出会停止备份与监视。
          </Text>
          {/* 桌面端惯例：辅助选项在左、按钮在右且宽度贴合文字（不拉满行） */}
          <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
            <Checkbox
              size="sm"
              label="记住我的选择"
              checked={remember}
              onChange={(event) => setRemember(event.currentTarget.checked)}
            />
            <Group gap={8} wrap="nowrap">
              <Button variant="default" size="sm" onClick={() => void resolveClose('exit', remember)}>
                直接退出
              </Button>
              <Button size="sm" onClick={() => void resolveClose('tray', remember)}>
                隐藏到托盘
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={kind === 'resetBackupRoot'}
        onClose={closeDialog}
        title="备份目录恢复默认位置"
        size={440}
        withCloseButton={false}
        closeOnClickOutside={false}
      >
        <Stack gap="sm" data-autofocus tabIndex={-1}>
          <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
            把备份目录恢复为默认位置（程序同级目录 backups\）。
          </Text>
          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-faint)" lh={1.6}>
            当前目录里已有的备份不会被移动或删除，仍留在原处；恢复后可在旧目录手动取回。
          </Text>
          <Group gap="xs">
            <Button size="sm" onClick={closeDialog}>保持现状</Button>
            <Button
              variant="subtle"
              color="red"
              size="sm"
              onClick={() => void restoreBackupRoot()}
            >
              恢复默认位置
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={kind === 'resetSettings'}
        onClose={closeDialog}
        title="恢复默认设置"
        size={460}
        withCloseButton={false}
        closeOnClickOutside={false}
      >
        {dialog?.kind === 'resetSettings' && (() => {
          const items = defaults
            ? resetDiffItems(dialog.scope, config, settingsDraft, defaults)
            : [];
          const note = dialog.scope === 'appearance'
            ? '只还原主题、明暗和字号；目录与其他设置不受影响。'
            : '存档目录、备份目录和游戏目录不会被动。未保存的修改也会一并还原。';
          return (
            <Stack gap="sm" data-autofocus tabIndex={-1}>
              {items.length === 0 ? (
                <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
                  各项都已经是默认值，没有需要还原的。
                </Text>
              ) : (
                <Box
                  className="ds-panel"
                  p="sm"
                  style={{ maxHeight: 220, overflowY: 'auto' }}
                >
                  <Stack gap={4}>
                    {items.map((item) => (
                      <Group key={item.key} justify="space-between" gap={8} wrap="nowrap">
                        <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">{item.label}</Text>
                        <Text fz="var(--ds-fs-meta)" className="ds-mono" truncate>
                          {item.from} <Text span c="var(--ds-text-faint)">→</Text> {item.to}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                </Box>
              )}
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" lh={1.6}>{note}</Text>
              <Group gap="xs">
                <Button size="sm" onClick={closeDialog}>保持现状</Button>
                <Button
                  variant="subtle"
                  color="red"
                  size="sm"
                  disabled={items.length === 0}
                  onClick={() => void resetSettings(dialog.scope)}
                >
                  确认还原{items.length > 0 ? `（${items.length} 项）` : ''}
                </Button>
              </Group>
            </Stack>
          );
        })()}
      </Modal>

      <Modal
        opened={kind === 'settingsClose'}
        onClose={closeDialog}
        title="放弃未保存的设置？"
        size={430}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
      >
        <Stack gap="sm" data-autofocus tabIndex={-1}>
          <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)">
            以下设置尚未保存，关闭就会放弃：
          </Text>
          {/* 字段级提示：让用户知道具体改了什么，而不是一句笼统的"有修改" */}
          <Group gap={6}>
            {Object.keys(settingsDraft).map((key) => (
              <Text key={key} fz="var(--ds-fs-micro)" className="ds-mono" c="var(--ds-text-faint)">
                {RESET_LABELS[key] ?? key}
              </Text>
            ))}
          </Group>
          <Group gap="xs">
            {/* 安全操作当主按钮，破坏性操作退为红字次要——别让"放弃"像默认选项 */}
            <Button size="sm" onClick={closeDialog}>
              继续编辑
            </Button>
            <Button variant="subtle" color="red" size="sm" onClick={() => void resolveSettingsClose(true)}>
              放弃修改并关闭
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
