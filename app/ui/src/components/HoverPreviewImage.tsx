import { HoverCard, Loader } from '@mantine/core';
import { useRef, useState } from 'react';

/** 缩略图 + 悬停看原图。
 *
 * 列表里的图都是 64px 缓存，直接放大只会更糊；这里在首次悬停时按需去后端取
 * 「最大 256px 的原图」（原图不足 128px 时后端返回空，就按原生尺寸显示，不放大）。
 */
export function HoverPreviewImage({
  src,
  alt,
  size = 52,
  radius = 9,
  loadFull,
}: {
  src: string;
  alt: string;
  size?: number;
  radius?: number;
  /** 按需取大图；不传则直接预览 src（用于本来就够大的图，如官方头像） */
  loadFull?: () => Promise<string>;
}) {
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requested = useRef(false);

  const request = () => {
    if (!loadFull || requested.current) return;
    requested.current = true;
    setLoading(true);
    loadFull()
      .then((url) => setFull(url || ''))
      .catch(() => setFull(''))
      .finally(() => setLoading(false));
  };

  const previewSrc = full || src;
  const nativeOnly = full === '';

  return (
    <HoverCard position="right" withArrow openDelay={140} shadow="md" withinPortal onOpen={request}>
      <HoverCard.Target>
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          style={{ borderRadius: radius, flex: 'none', objectFit: 'cover', cursor: 'zoom-in' }}
        />
      </HoverCard.Target>
      <HoverCard.Dropdown p={6}>
        {loading ? (
          <div style={{ width: 160, height: 160, display: 'grid', placeItems: 'center' }}>
            <Loader size="sm" color="accent" />
          </div>
        ) : (
          <img
            src={previewSrc}
            alt={alt}
            style={{
              display: 'block',
              borderRadius: 10,
              // 只缩小不放大：原图小的时候保持原生尺寸，避免二次模糊
              maxWidth: 240,
              maxHeight: 240,
              width: nativeOnly ? size * 2 : 'auto',
              height: 'auto',
              objectFit: 'contain',
            }}
          />
        )}
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
