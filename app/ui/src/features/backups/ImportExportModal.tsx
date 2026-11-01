import { Alert, Box, Button, Group, Modal, Radio, Stack, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconFileExport,
  IconPackageImport,
  IconShieldCheck,
} from '@tabler/icons-react';
import { useState } from 'react';

import { getBridge } from '../../lib/bridge/api';
import type { ImportScan } from '../../lib/bridge/types';
import { formatBytes } from '../../lib/format';
import { useAppStore } from '../../lib/store/useAppStore';

type Phase = 'pick' | 'preview' | 'running' | 'done' | 'error';

/** 导入 / 导出向导。
 *  导入：选来源 -> 识别预览 + 「导入为备份 / 导入为存档」二选一 -> 执行。
 *  导出：确认范围 -> 选保存位置 -> 打包 zip（manifest + 每份一个目录）。
 */
export function ImportExportModal({
  mode,
  ids,
  onClose,
}: {
  mode: 'import' | 'export';
  ids: string[];
  onClose: () => void;
}) {
  const refreshBackups = useAppStore((state) => state.refreshBackups);
  const [phase, setPhase] = useState<Phase>(mode === 'export' ? 'preview' : 'pick');
  const [source, setSource] = useState('');
  const [scan, setScan] = useState<ImportScan | null>(null);
  const [entryKey, setEntryKey] = useState('');
  const [importMode, setImportMode] = useState<'backup' | 'save'>('backup');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fail = (exc: unknown) => {
    setError(String((exc as Error)?.message ?? exc));
    setPhase('error');
  };

  const pickSource = async () => {
    try {
      const bridge = await getBridge();
      const res = await bridge.pickFile(false, [
        'Zip archive (*.zip)',
        '7z archive (*.7z)',
        'Rar archive (*.rar)',
        'All files (*.*)',
      ]);
      const path = res.paths[0];
      if (!path) return;
      setSource(path);
      setPhase('running');
      const result = await bridge.importScan(path);
      setScan(result);
      setEntryKey(result.entries[0]?.key ?? '');
      setPhase('preview');
    } catch (exc) {
      fail(exc);
    }
  };

  const runImport = async () => {
    try {
      setPhase('running');
      const bridge = await getBridge();
      const res = await bridge.importBackup(source, importMode, entryKey);
      setMessage(
        res.mode === 'save'
          ? `已导入为存档（槽位 ${res.slot_id}），重启游戏即可看到`
          : `已导入为备份（槽位 ${res.slot_id}），来源标记为「导入」`,
      );
      await refreshBackups();
      setPhase('done');
    } catch (exc) {
      fail(exc);
    }
  };

  const runExport = async () => {
    try {
      setPhase('running');
      const bridge = await getBridge();
      const name = ids.length === 1 ? `backup-${ids[0].replace(':', '-')}.zip` : `backups-${ids.length}.zip`;
      const picked = await bridge.pickSaveFile(name);
      if (!picked.path) {
        setPhase('preview');
        return;
      }
      const res = await bridge.exportBackups(ids, picked.path);
      setMessage(`已导出 ${res.count} 份备份（${formatBytes(res.bytes)}）到 ${res.path}`);
      setPhase('done');
    } catch (exc) {
      fail(exc);
    }
  };

  const entry = scan?.entries.find((item) => item.key === entryKey) ?? scan?.entries[0] ?? null;

  return (
    <Modal
      opened
      onClose={onClose}
      title={mode === 'import' ? '导入备份 / 存档' : `导出 ${ids.length} 份备份`}
      size={520}
      centered
      styles={{ content: { background: 'var(--ds-surface)' } }}
    >
      <Stack gap="md">
        {phase === 'pick' && (
          <>
            <Button
              size="lg"
              variant="default"
              leftSection={<IconPackageImport size={20} stroke={1.8} />}
              onClick={() => void pickSource()}
            >
              选择压缩包或存档文件
            </Button>
            <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" lh={1.6}>
              支持 zip / 7z / rar 压缩包与单个存档文件；本工具导出的 zip 可整包导入（含多份备份）。
            </Text>
          </>
        )}

        {phase === 'preview' && mode === 'import' && scan && (
          <>
            <Box>
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)" mb={6}>
                识别结果 · {scan.kind.toUpperCase()} · 来源 {source}
              </Text>
              {!scan.recognized && (
                <Alert color="red" icon={<IconAlertTriangle size={16} />}>
                  没有识别出任何存档内容（需要 saveindex 或 survival_x / cave_x 等世界文件）
                </Alert>
              )}
              {scan.recognized && (
                <Radio.Group
                  value={entryKey}
                  onChange={setEntryKey}
                  label={`共 ${scan.entries.length} 份内容，选择要导入的：`}
                >
                  <Stack gap={6} mt={6}>
                    {scan.entries.map((item) => (
                      <Radio
                        key={item.key}
                        value={item.key}
                        label={
                          <Text fz="var(--ds-fs-meta)">
                            {item.label} · 槽位 {item.slot_id ?? '?'} · {item.file_count} 个文件 ·{' '}
                            {formatBytes(item.bytes)}
                            {!item.has_saveindex && ' · 缺 saveindex'}
                          </Text>
                        }
                      />
                    ))}
                  </Stack>
                </Radio.Group>
              )}
            </Box>

            {scan.recognized && (
              <Radio.Group value={importMode} onChange={(v) => setImportMode(v as 'backup' | 'save')} label="导入方式">
                <Stack gap={8} mt={6}>
                  <Radio
                    value="backup"
                    label={
                      <Text fz="var(--ds-fs-meta)">
                        导入为备份 · 收进备份库（来源标记「导入」），不碰游戏存档
                      </Text>
                    }
                  />
                  <Radio
                    value="save"
                    label={
                      <Text fz="var(--ds-fs-meta)">
                        导入为存档 · 覆盖当前槽位的游戏存档
                      </Text>
                    }
                  />
                </Stack>
              </Radio.Group>
            )}

            {importMode === 'save' && scan.recognized && (
              <Alert color="orange" icon={<IconShieldCheck size={16} />}>
                导入为存档会覆盖槽位 {entry?.slot_id ?? '?'} 的当前存档。开始前会自动拍一份「恢复前」保护快照；
                请先退出游戏。
              </Alert>
            )}
            {entry && !entry.has_saveindex && importMode === 'backup' && (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                这份内容没有 saveindex（存档账本），将借用当前存档的账本打包；天数等信息可能不准确。
              </Alert>
            )}
            {scan.unknown.length > 0 && (
              <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
                忽略的非存档文件：{scan.unknown.slice(0, 6).join('、')}
              </Text>
            )}

            <Group justify="flex-end" gap="xs">
              <Button variant="default" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button size="sm" disabled={!scan.recognized} onClick={() => void runImport()}>
                开始导入
              </Button>
            </Group>
          </>
        )}

        {phase === 'preview' && mode === 'export' && (
          <>
            <Text fz="var(--ds-fs-meta)" lh={1.6}>
              将把选中的 {ids.length} 份备份打包为 zip（一份一个目录，附 manifest 清单）。
              换机器或重装后，用本界面的「导入」即可整包还原。
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button variant="default" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button size="sm" leftSection={<IconFileExport size={16} stroke={1.8} />} onClick={() => void runExport()}>
                选择保存位置
              </Button>
            </Group>
          </>
        )}

        {phase === 'running' && (
          <Text fz="var(--ds-fs-meta)" c="var(--ds-text-dim)">
            {mode === 'import' ? '正在识别 / 导入…' : '正在打包…'}
          </Text>
        )}

        {phase === 'done' && (
          <>
            <Text fz="var(--ds-fs-meta)" c="var(--ds-text)">{message}</Text>
            <Group justify="flex-end">
              <Button size="sm" onClick={onClose}>
                完成
              </Button>
            </Group>
          </>
        )}

        {phase === 'error' && (
          <>
            <Alert color="red" icon={<IconAlertTriangle size={16} />}>
              {error}
            </Alert>
            <Group justify="flex-end">
              <Button size="sm" variant="default" onClick={onClose}>
                关闭
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}