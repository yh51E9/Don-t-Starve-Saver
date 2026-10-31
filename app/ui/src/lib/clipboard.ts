/** 剪贴板：WebView2 里 navigator.clipboard 可能被权限拒，兜底 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/** workshop-2890042663 → 2890042663（短 id / 纯数字） */
export function shortModId(id: string): string {
  return id.replace(/^workshop-/, '');
}

export function workshopUrl(modId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${shortModId(modId)}`;
}
