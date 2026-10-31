import { Tooltip } from '@mantine/core';
import {
  IconBookmark,
  IconClock,
  IconClockBolt,
  IconDeviceFloppy,
  IconLogout,
  IconPackageImport,
  IconShieldCheck,
} from '@tabler/icons-react';

import type { BackupTag } from '../lib/bridge/types';

/** 来源标记：图标 + 配色 + 悬停解释触发时机。
 *  color 只染图标/描边（文字保持中性，保证各主题可读性）。
 */
const SPEC: Record<BackupTag, { icon: typeof IconBookmark; label: string; color: string; hint: string }> = {
  manual: {
    icon: IconBookmark, label: '手动', color: 'var(--ds-accent)',
    hint: '你点击「备份」按钮时手动创建',
  },
  auto: {
    icon: IconClockBolt, label: '自动', color: 'var(--ds-text-faint)',
    hint: '自动备份创建（旧版本未细分触发方式）',
  },
  autosave: {
    icon: IconDeviceFloppy, label: '游戏保存', color: 'var(--ds-success)',
    hint: '游戏运行中写盘完成后自动创建',
  },
  autoexit: {
    icon: IconLogout, label: '游戏关闭', color: 'var(--ds-info)',
    hint: '游戏退出时的存档写盘被捕捉到后自动创建（退出时会自动存一次盘）',
  },
  tick: {
    icon: IconClock, label: '定时', color: 'var(--ds-violet)',
    hint: '软件按固定间隔定时创建',
  },
  pre: {
    icon: IconShieldCheck, label: '恢复前', color: 'var(--ds-warning)',
    hint: '恢复或删除存档前自动拍的保护快照，出问题可以拿它反悔',
  },
  import: {
    icon: IconPackageImport, label: '导入', color: 'var(--ds-rose)',
    hint: '从文件或压缩包导入的备份',
  },
};

/** 供筛选面板等处复用同一份来源元数据（标签/配色/悬停文案） */
export const TAG_META = SPEC;

export function Tag({ tag, label, matched }: { tag: BackupTag; label?: string; matched?: boolean }) {
  const spec = SPEC[tag] ?? SPEC.manual;
  const Icon = spec.icon;
  return (
    <Tooltip withinPortal openDelay={200} label={spec.hint}>
      <span
        className={matched ? 'ds-tag ds-tag-hit' : 'ds-tag'}
        style={{
          borderColor: `color-mix(in srgb, ${spec.color} 55%, var(--ds-hairline))`,
          background: `color-mix(in srgb, ${spec.color} 12%, transparent)`,
        }}
      >
        <Icon size={11} stroke={1.8} color={spec.color} />
        {label ?? spec.label}
      </span>
    </Tooltip>
  );
}
