import { ActionIcon, Tooltip } from '@mantine/core';
import { useRef, useState } from 'react';
import type { ComponentType } from 'react';

type Size = 'sm' | 'md' | 'lg';

const BUTTON_PX: Record<Size, number> = { sm: 28, md: 34, lg: 40 };
const ICON_PX: Record<Size, number> = { sm: 14, md: 18, lg: 22 };

interface Props {
  icon: ComponentType<{ size?: number; stroke?: number; className?: string }>;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'accent' | 'danger';
  size?: Size;
  /** 导航选中态：带底色 + 1px 强调色环 */
  active?: boolean;
  /** 开关状态：只染图标 + 很淡的底 */
  on?: boolean;
  variant?: 'subtle' | 'default';
  disabled?: boolean;
  /** 点击后图标转一圈（刷新类按钮的反馈） */
  spinOnClick?: boolean;
  /** 覆盖按钮尺寸（如图标不变、按钮框压窄） */
  style?: React.CSSProperties;
}

const SPIN_MS = 600;

export function IconButton({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  size = 'md',
  active,
  on,
  variant = 'subtle',
  disabled,
  spinOnClick = false,
  style,
}: Props) {
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const color = tone === 'danger'
    ? 'var(--ds-danger)'
    : active || on
      ? 'var(--ds-accent)'
      : 'var(--ds-text-dim)';

  const handleClick = () => {
    onClick();
    if (!spinOnClick) return;
    setSpinning(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSpinning(false), SPIN_MS);
  };

  return (
    <Tooltip label={label}>
      <ActionIcon
        size={BUTTON_PX[size]}
        style={style}
        variant={variant}
        color={tone === 'accent' ? 'accent' : 'gray'}
        c={color}
        className="ds-iconbtn"
        data-active={active}
        data-on={on}
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active ?? on}
      >
        <Icon
          size={ICON_PX[size]}
          stroke={size === 'sm' ? 1.6 : 1.8}
          className={spinning ? 'ds-spin' : undefined}
        />
      </ActionIcon>
    </Tooltip>
  );
}
