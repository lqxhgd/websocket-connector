import type {
  WSMessage, ClientConnection, IMessageHandler,
  SessionCreatePayload, SessionResumePayload, SessionDestroyPayload,
} from '../types.js';
import type { SessionManager } from '../services/session/SessionManager.js';
import { ConnectionManager } from '../server/ConnectionManager.js';
import { MSG } from '../protocol/MessageTypes.js';
import { serialize, serializeError } from '../protocol/Serializer.js';
import { ErrorCode, PluginError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const log = logger.child('SessionHandler');

/**
 * 会话处理器：处理所有 "session" 前缀的消息。
 * 编排 SessionManager 完成会话的创建、恢复、销毁和列表查询。
 *
 * 消息类型：
 *   session.create  → 创建新会话
 *   session.resume  → 恢复已有会话
 *   session.destroy → 销毁会话
 *   session.list    → 列出当前连接的所有会话
 */
export class SessionHandler implements IMessageHandler {
  readonly prefix = 'session';

  constructor(
    private sessions: SessionManager,
    private connManager: ConnectionManager,
  ) {}

  async handle(message: WSMessage, conn: ClientConnection): Promise<void> {
    switch (message.type) {
      case MSG.SESSION_CREATE:
        this.handleCreate(message, conn);
        break;
      case MSG.SESSION_RESUME:
        this.handleResume(message, conn);
        break;
      case MSG.SESSION_DESTROY:
        this.handleDestroy(message, conn);
        break;
      case MSG.SESSION_LIST:
        this.handleList(message, conn);
        break;
      default:
        conn.socket.send(
          serializeError(ErrorCode.UNKNOWN_TYPE, `未知会话消息类型: ${message.type}`, message.id),
        );
    }
  }

  /** 创建新会话并返回会话信息 */
  private handleCreate(message: WSMessage, conn: ClientConnection): void {
    const payload = message.payload as SessionCreatePayload;
    const session = this.sessions.create(conn.id, payload?.name);

    this.connManager.send(
      conn,
      serialize(MSG.SESSION_INFO, {
        sessionId: session.id,
        name: session.name,
        createdAt: session.createdAt,
      }, message.id),
    );
    log.info(`会话创建: ${session.id}, 连接: ${conn.id}`);
  }

  /** 恢复已有会话（客户端断线重连时使用） */
  private handleResume(message: WSMessage, conn: ClientConnection): void {
    const payload = message.payload as SessionResumePayload;
    try {
      const session = this.sessions.resume(payload.sessionId, conn.id);

      this.connManager.send(
        conn,
        serialize(MSG.SESSION_INFO, {
          sessionId: session.id,
          name: session.name,
          createdAt: session.createdAt,
          messageCount: session.messageHistory.length,
        }, message.id),
      );
    } catch (err) {
      const msg = err instanceof PluginError ? err.message : String(err);
      this.connManager.send(
        conn,
        serializeError(ErrorCode.SESSION_NOT_FOUND, msg, message.id),
      );
    }
  }

  /** 销毁指定会话 */
  private handleDestroy(message: WSMessage, conn: ClientConnection): void {
    const payload = message.payload as SessionDestroyPayload;
    this.sessions.destroy(payload.sessionId);

    this.connManager.send(
      conn,
      serialize('session.destroyed', { sessionId: payload.sessionId }, message.id),
    );
    log.info(`会话销毁: ${payload.sessionId}`);
  }

  /** 列出当前连接的所有活跃会话 */
  private handleList(message: WSMessage, conn: ClientConnection): void {
    const list = this.sessions.listByConnection(conn.id);
    const sessions = list.map((s) => ({
      sessionId: s.id,
      name: s.name,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      messageCount: s.messageHistory.length,
    }));

    this.connManager.send(
      conn,
      serialize('session.list', { sessions }, message.id),
    );
  }
}
