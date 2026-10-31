export class ApiError extends Error {
  code: string;
  detail: Record<string, unknown>;

  constructor(code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

export const ERROR_HINTS: Record<string, string> = {
  E_GAME_RUNNING: '请先完全退出饥荒，游戏会用内存里的进度把存档盖回去',
  E_PATH_ESCAPE: '路径不在备份目录内，已拒绝',
  E_SAVE_DIR_INVALID: '这个目录里没有 saveindex，不像是饥荒存档目录',
  E_BACKUP_NOT_FOUND: '这份备份可能已经被删了，刷新一下再看',
  E_BUSY: '还有任务在跑，等它结束',
  E_IO: '磁盘写入失败，检查权限或剩余空间',
  E_PARSE: '存档索引解析失败，可能文件已损坏',
  E_CONFIG: '配置文件损坏，已重置为默认值（原文件已备份）',
  E_NOT_SUPPORTED: '当前环境不支持这个操作',
  E_INTERNAL: '内部错误，详情见日志',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_HINTS[error.code] ? `${error.message} · ${ERROR_HINTS[error.code]}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
