import { initialOf } from '../lib/format';

/** Mod 图标：有图用图，没图用「按 id 生成的稳定色块 + 首字母」。
 *
 * 很多老 mod 根本没带 modicon（有的只带 modicon.xml 没有贴图），
 * 这时灰方块像是加载失败；彩色首字母更像"这个 mod 的徽标"。
 */
export function ModIcon({
  icon,
  name,
  seed,
  size = 26,
  dim = false,
  radius,
}: {
  icon?: string;
  name: string;
  /** 生成色相用（默认用 name，建议传 mod id 保证稳定） */
  seed?: string;
  size?: number;
  dim?: boolean;
  radius?: number;
}) {
  const rounded = radius ?? Math.round(size * 0.24);
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        width={size}
        height={size}
        style={{
          borderRadius: rounded,
          flex: 'none',
          objectFit: 'cover',
          opacity: dim ? 0.55 : 1,
          filter: dim ? 'grayscale(0.5)' : undefined,
        }}
      />
    );
  }

  const key = seed || name || '?';
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        flex: 'none',
        background: `hsl(${hash} 34% 42%)`,
        color: '#fff',
        fontSize: Math.round(size * 0.4),
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: dim ? 0.55 : 1,
        filter: dim ? 'grayscale(0.5)' : undefined,
      }}
      aria-hidden
    >
      {initialOf(name)}
    </div>
  );
}
