import type { WSMessage, ClientConnection, IMessageHandler, ChatPayload } from '../types.js';
import type { OpenClawClient } from '../services/gateway/OpenClawClient.js';
import type { SessionManager } from '../services/session/SessionManager.js';
import { ConnectionManager } from '../server/ConnectionManager.js';
import { MSG } from '../protocol/MessageTypes.js';
import { serialize, serializeError } from '../protocol/Serializer.js';
import { ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const log = logger.child('ChatHandler');

/**
 * 对话处理器：处理所有 "chat" 前缀的消息。
 * 核心流程：接收用户消息 → 追加到会话历史 → 调用 Gateway 流式请求 → 逐块推送给客户端。
 *
 * 消息类型：
 *   chat         → 用户发送对话（触发流式请求）
 */
export class ChatHandler implements IMessageHandler {
  readonly prefix = 'chat';

  constructor(
    private gateway: OpenClawClient,
    private sessions: SessionManager,
    private connManager: ConnectionManager,
  ) {}

  /** 按消息 type 分发到具体处理方法 */
  async handle(message: WSMessage, conn: ClientConnection): Promise<void> {
    switch (message.type) {
      case MSG.CHAT:
        await this.handleChat(message, conn);
        break;
      default:
        conn.socket.send(
          serializeError(ErrorCode.UNKNOWN_TYPE, `未知对话消息类型: ${message.type}`, message.id),
        );
    }
  }

  /**
   * 处理对话消息：
   * 1. 从 payload 中获取 sessionId 和内容
   * 2. 将用户消息追加到会话历史
   * 3. 向 Gateway 发起流式请求
   * 4. 每收到一个 chunk 通过 WebSocket 推送 chat.stream
   * 5. 完成后推送 chat.done 并将 AI 回复追加到历史
   */
  private async handleChat(message: WSMessage, conn: ClientConnection): Promise<void> {
    const payload = message.payload as ChatPayload;
    if (!payload?.sessionId || !payload?.content) {
      this.connManager.send(
        conn,
        serializeError(ErrorCode.INVALID_MESSAGE, '缺少 sessionId 或 content', message.id),
      );
      return;
    }

    const session = this.sessions.find(payload.sessionId);
    if (!session) {
      this.connManager.send(
        conn,
        serializeError(ErrorCode.SESSION_NOT_FOUND, `会话 ${payload.sessionId} 不存在`, message.id),
      );
      return;
    }

    // 追加用户消息到历史
    this.sessions.addMessage(session.id, {
      role: 'user',
      content: payload.content,
      timestamp: Date.now(),
    });

    const history = this.sessions.getHistory(session.id);
    const sessionKey = this.sessions.getSessionKey(session);

    log.info(`对话请求: session=${session.id}, 历史消息数=${history.length}`);

    // 向 Gateway 发起流式请求
    await this.gateway.streamChat(
      history,
      sessionKey,
      (chunk) => {
        this.connManager.send(
          conn,
          serialize(MSG.CHAT_STREAM, { sessionId: session.id, chunk }, message.id),
        );
      },
      (fullContent) => {
        // 将 AI 回复追加到会话历史
        this.sessions.addMessage(session.id, {
          role: 'assistant',
          content: fullContent,
          timestamp: Date.now(),
        });
        this.connManager.send(
          conn,
          serialize(MSG.CHAT_DONE, { sessionId: session.id, content: fullContent }, message.id),
        );
        log.info(`对话完成: session=${session.id}, 回复长度=${fullContent.length}`);
      },
      (error) => {
        this.connManager.send(
          conn,
          serialize(MSG.CHAT_ERROR, { sessionId: session.id, message: error.message }, message.id),
        );
        log.error(`对话错误: session=${session.id}, ${error.message}`);
      },
    );
  }
}
