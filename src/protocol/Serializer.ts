import { v4 as uuidv4 } from 'uuid';
import type { WSMessage, ErrorPayload } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('Serializer');

/**
 * 将原始 WebSocket 数据解析为 WSMessage 对象。
 * 仅处理文本帧（JSON），二进制帧由 FileHandler 单独处理。
 * @returns 解析后的消息，格式错误时返回 null
 */
export function deserialize(raw: string): WSMessage | null {
  try {
    const msg = JSON.parse(raw) as WSMessage;
    if (!msg.type || !msg.id) {
      log.warn('消息缺少 type 或 id 字段');
      return null;
    }
    return msg;
  } catch {
    log.warn('JSON 解析失败');
    return null;
  }
}

/**
 * 将 WSMessage 序列化为 JSON 字符串，用于通过 WebSocket 发送。
 * 自动补全 timestamp 字段。
 */
export function serialize<T>(type: string, payload: T, id?: string): string {
  const msg: WSMessage<T> = {
    type,
    id: id || uuidv4(),
    payload,
    timestamp: Date.now(),
  };
  return JSON.stringify(msg);
}

/** 构造一条错误响应消息的 JSON 字符串 */
export function serializeError(code: string, message: string, replyTo?: string): string {
  const payload: ErrorPayload = { code, message };
  return serialize('error', payload, replyTo);
}
