import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config.js';
import { sessionNotFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { Session, ChatMessage } from '../../types.js';

const log = logger.child('Session');

/**
 * 会话生命周期管理服务。
 * 每个会话维护独立的消息历史，支持创建、恢复、销毁和超时清理。
 * 一个 WebSocket 连接可绑定多个会话（通过 sessionId 区分）。
 */
export class SessionManager {
  /** sessionId → Session */
  private sessions = new Map<string, Session>();
  /** 超时清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** 启动超时清理定时器 */
  init(): void {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpired(),
      60_000,
    );
    log.info('会话管理已初始化');
  }

  /**
   * 创建新会话，绑定到指定连接。
   * @param connectionId - 所属的 WebSocket 连接 ID
   * @param name - 可选的会话名称
   * @returns 新创建的会话对象
   */
  create(connectionId: string, name?: string): Session {
    const session: Session = {
      id: uuidv4(),
      connectionId,
      name,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageHistory: [],
    };
    this.sessions.set(session.id, session);
    log.info(`会话已创建: ${session.id}, 连接: ${connectionId}`);
    return session;
  }

  /** 根据 sessionId 获取会话，不存在则抛出异常 */
  get(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw sessionNotFound(sessionId);
    return session;
  }

  /** 安全获取会话，不存在时返回 undefined 而不抛异常 */
  find(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 恢复会话：检查会话是否存在且未过期，更新绑定的连接 ID。
   * 用于客户端断线重连后恢复之前的对话上下文。
   */
  resume(sessionId: string, connectionId: string): Session {
    const session = this.get(sessionId);
    session.connectionId = connectionId;
    session.lastActivity = Date.now();
    log.info(`会话已恢复: ${sessionId}, 新连接: ${connectionId}`);
    return session;
  }

  /** 销毁指定会话 */
  destroy(sessionId: string): void {
    this.sessions.delete(sessionId);
    log.info(`会话已销毁: ${sessionId}`);
  }

  /** 销毁指定连接关联的所有会话（连接断开时调用） */
  destroyByConnection(connectionId: string): void {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.connectionId === connectionId) {
        this.sessions.delete(id);
        count++;
      }
    }
    if (count > 0) {
      log.info(`连接 ${connectionId} 断开，清理 ${count} 个会话`);
    }
  }

  /** 列出指定连接的所有会话 */
  listByConnection(connectionId: string): Session[] {
    const result: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.connectionId === connectionId) {
        result.push(session);
      }
    }
    return result;
  }

  /** 向会话追加一条消息，同时更新活动时间 */
  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.get(sessionId);
    session.messageHistory.push(message);
    session.lastActivity = Date.now();
  }

  /** 获取会话的完整消息历史 */
  getHistory(sessionId: string): ChatMessage[] {
    return this.get(sessionId).messageHistory;
  }

  /** 获取用于 Gateway 的 sessionKey（唯一标识这轮对话） */
  getSessionKey(session: Session): string {
    return `ws-connector:${session.connectionId}:${session.id}`;
  }

  /** 停止清理定时器 */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** 清理超时的会话 */
  private cleanupExpired(): void {
    const now = Date.now();
    const timeout = config.sessionTimeout;
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > timeout) {
        this.sessions.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      log.info(`清理过期会话: ${removed} 个`);
    }
  }
}
