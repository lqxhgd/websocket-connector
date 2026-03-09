import { WebSocketServer as WSServer } from 'ws';
import type { WebSocket, RawData } from 'ws';
import { config } from '../config.js';
import { ConnectionManager } from './ConnectionManager.js';
import { MessageRouter } from '../protocol/MessageRouter.js';
import { deserialize, serialize, serializeError } from '../protocol/Serializer.js';
import { MSG } from '../protocol/MessageTypes.js';
import { ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { ClientConnection, AuthPayload } from '../types.js';

const log = logger.child('WSServer');

/**
 * WebSocket 服务器：插件的传输层入口。
 * 负责启停服务、监听连接、心跳检测、认证拦截，
 * 将业务消息委托给 MessageRouter 分发到各 Handler。
 */
export class WebSocketServerWrapper {
  private wss: WSServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connManager: ConnectionManager;
  private router: MessageRouter;

  /**
   * 文件二进制帧回调：当收到 binary 帧时，由外部（FileHandler）注册的回调处理。
   * key = connectionId，value = 处理函数。
   */
  private binaryHandlers = new Map<string, (data: Buffer) => void>();

  constructor(connManager: ConnectionManager, router: MessageRouter) {
    this.connManager = connManager;
    this.router = router;
  }

  /** 启动 WebSocket 服务，开始监听指定端口 */
  start(): void {
    const port = config.port;
    this.wss = new WSServer({ port });

    this.wss.on('connection', (socket) => this.onConnection(socket));
    this.wss.on('error', (err) => log.error('服务器错误:', err));

    this.startHeartbeat();
    log.info(`WebSocket 服务已启动, 端口: ${port}`);
  }

  /** 关闭 WebSocket 服务和所有连接 */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.wss?.close();
    this.wss = null;
    log.info('WebSocket 服务已关闭');
  }

  /**
   * 注册二进制帧处理回调（供 FileHandler 在文件上传时使用）。
   * 同一连接同一时间只能有一个活跃的二进制处理器。
   */
  registerBinaryHandler(connectionId: string, handler: (data: Buffer) => void): void {
    this.binaryHandlers.set(connectionId, handler);
  }

  /** 移除连接的二进制帧处理回调 */
  removeBinaryHandler(connectionId: string): void {
    this.binaryHandlers.delete(connectionId);
  }

  /** 处理新的 WebSocket 连接 */
  private onConnection(socket: WebSocket): void {
    const conn = this.connManager.create(socket);

    socket.on('message', (raw, isBinary) => this.onMessage(conn, raw, isBinary));
    socket.on('close', () => this.onClose(conn));
    socket.on('error', (err) => {
      log.error(`连接 ${conn.id} 错误:`, err);
      this.onClose(conn);
    });
    socket.on('pong', () => {
      this.connManager.touch(conn);
    });
  }

  /** 处理收到的消息（区分文本帧和二进制帧） */
  private onMessage(conn: ClientConnection, raw: RawData, isBinary: boolean): void {
    this.connManager.touch(conn);

    // 二进制帧 → 交给文件传输回调
    if (isBinary) {
      const handler = this.binaryHandlers.get(conn.id);
      if (handler) {
        handler(Buffer.from(raw as ArrayBuffer));
      } else {
        log.warn(`连接 ${conn.id} 收到未注册的二进制帧，忽略`);
      }
      return;
    }

    // 文本帧 → JSON 解析 → 路由
    const text = raw.toString();
    const message = deserialize(text);
    if (!message) {
      this.connManager.send(conn, serializeError(ErrorCode.INVALID_MESSAGE, '无效的消息格式'));
      return;
    }

    // 系统消息直接处理，不经过路由
    if (message.type === MSG.PING) {
      this.connManager.send(conn, serialize(MSG.PONG, null, message.id));
      return;
    }

    if (message.type === MSG.AUTH) {
      this.handleAuth(conn, message.payload as AuthPayload, message.id);
      return;
    }

    // 非认证消息需要先通过认证
    if (!conn.authenticated) {
      this.connManager.send(
        conn,
        serializeError(ErrorCode.AUTH_REQUIRED, '请先认证', message.id),
      );
      return;
    }

    // 业务消息交给路由器分发
    this.router.route(message, conn);
  }

  /** 处理认证请求 */
  private handleAuth(conn: ClientConnection, payload: AuthPayload, messageId: string): void {
    const success = this.connManager.authenticate(conn, payload?.token || '');
    if (success) {
      conn.clientId = payload?.clientId;
      this.connManager.send(conn, serialize('auth.success', { connectionId: conn.id }, messageId));
    } else {
      this.connManager.send(conn, serializeError(ErrorCode.AUTH_FAILED, '认证失败', messageId));
      conn.socket.close(4001, '认证失败');
    }
  }

  /** 处理连接关闭 */
  private onClose(conn: ClientConnection): void {
    this.binaryHandlers.delete(conn.id);
    this.connManager.remove(conn.id);
  }

  /** 启动心跳检测定时器，检测并断开无响应的连接 */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.wss?.clients.forEach((socket) => {
        if (socket.readyState === socket.OPEN) {
          socket.ping();
        }
      });
    }, config.heartbeatInterval);
  }
}
