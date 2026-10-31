import { ExpansionIcon } from './ExpansionIcon';

interface Props {
  mode: string;
  size?: number;
  color?: string;
  /** DLC 中文名列表（决定生存模式显示松树还是鹿角） */
  dlc?: string[];
}

/** 兼容入口：统一转给 ExpansionIcon（松树 / 鹿角 / 模式图标）。 */
export function ModeIcon({ mode, size = 16, color, dlc }: Props) {
  return <ExpansionIcon mode={mode} dlc={dlc} size={size} color={color} />;
}
