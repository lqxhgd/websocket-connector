import type { WSMessage, ClientConnection, IMessageHandler } from '../types.js';
import { ErrorCode } from '../utils/errors.js';
import { serialize, serializeError } from './Serializer.js';
import { MSG } from './MessageTypes.js';
import { logger } from '../utils/logger.js';

const log = logger.child('Router');

/**
 * 消息路由器：按消息 type 的前缀分发到对应的 Handler。
 *
 * 路由规则：
 *   "chat"      → prefix="chat" 的 Handler
 *   "chat.done" → prefix="chat" 的 Handler（匹配前缀）
 *   "file.upload.start" → prefix="file" 的 Handler
 *
 * Handler 在启动时通过 register() 注册自己。
 */
export class MessageRouter {
  /** prefix → handler 映射表 */
  private handlers = new Map<string, IMessageHandler>();

  /** 注册一个消息处理器（按其 prefix 属性） */
  register(handler: IMessageHandler): void {
    this.handlers.set(handler.prefix, handler);
    log.info(`注册 Handler: ${handler.prefix}`);
  }

  /**
   * 将消息路由到匹配的 Handler。
   * 匹配逻辑：取 type 中第一个 "." 之前的部分作为前缀查找。
   * 系统消息（ping/pong/auth）不经过此路由，由 WebSocketServer 直接处理。
   */
  async route(message: WSMessage, conn: ClientConnection): Promise<void> {
    const prefix = message.type.split('.')[0];
    const handler = this.handlers.get(prefix);

    if (!handler) {
      log.warn(`未知消息类型: ${message.type}`);
      conn.socket.send(
        serializeError(ErrorCode.UNKNOWN_TYPE, `未知消息类型: ${message.type}`, message.id),
      );
      return;
    }

    try {
      await handler.handle(message, conn);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`Handler [${prefix}] 处理异常: ${errMsg}`);
      conn.socket.send(
        serializeError(ErrorCode.INTERNAL_ERROR, errMsg, message.id),
      );
    }
  }
}
