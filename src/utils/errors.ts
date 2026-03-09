/** 插件业务错误码枚举 */
export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_FAILED = 'AUTH_FAILED',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  UNKNOWN_TYPE = 'UNKNOWN_TYPE',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  CONVERT_FAILED = 'CONVERT_FAILED',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  GATEWAY_ERROR = 'GATEWAY_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** 插件业务异常，携带错误码，便于向客户端返回结构化错误 */
export class PluginError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.details = details;
  }
}

/** 快捷构造：认证失败 */
export function authError(message = '认证失败'): PluginError {
  return new PluginError(ErrorCode.AUTH_FAILED, message);
}

/** 快捷构造：无效消息格式 */
export function invalidMessage(message = '无效的消息格式'): PluginError {
  return new PluginError(ErrorCode.INVALID_MESSAGE, message);
}

/** 快捷构造：会话未找到 */
export function sessionNotFound(sessionId: string): PluginError {
  return new PluginError(ErrorCode.SESSION_NOT_FOUND, `会话 ${sessionId} 不存在`);
}

/** 快捷构造：文件未找到 */
export function fileNotFound(fileId: string): PluginError {
  return new PluginError(ErrorCode.FILE_NOT_FOUND, `文件 ${fileId} 不存在`);
}

/** 快捷构造：Gateway 通信错误 */
export function gatewayError(message: string, details?: unknown): PluginError {
  return new PluginError(ErrorCode.GATEWAY_ERROR, message, details);
}
