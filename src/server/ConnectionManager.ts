import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { ClientConnection } from '../types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const log = logger.child('ConnMgr');

/**
 * 管理所有 WebSocket 客户端连接的生命周期。
 * 职责：创建连接、认证校验、查找连接、移除连接。
 */
export class ConnectionManager {
  /** connectionId → ClientConnection */
  private connections = new Map<string, ClientConnection>();

  /** 为新的 WebSocket 创建连接记录，返回连接 ID */
  create(socket: WebSocket): ClientConnection {
    const conn: ClientConnection = {
      id: uuidv4(),
      socket,
      authenticated: false,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.connections.set(conn.id, conn);
    log.info(`新连接: ${conn.id}, 当前总数: ${this.connections.size}`);
    return conn;
  }

  /**
   * 校验客户端 Token。
   * 如果服务端未配置 authToken（为空），则直接放行。
   * @returns 认证是否通过
   */
  authenticate(conn: ClientConnection, token: string): boolean {
    const required = config.authToken;
    if (!required || token === required) {
      conn.authenticated = true;
      log.info(`连接 ${conn.id} 认证通过`);
      return true;
    }
    log.warn(`连接 ${conn.id} 认证失败`);
    return false;
  }

  /** 根据连接 ID 查找连接 */
  get(id: string): ClientConnection | undefined {
    return this.connections.get(id);
  }

  /** 更新连接的最后活动时间 */
  touch(conn: ClientConnection): void {
    conn.lastActivity = Date.now();
  }

  /** 移除连接（WebSocket 关闭或异常时调用） */
  remove(id: string): void {
    this.connections.delete(id);
    log.info(`连接断开: ${id}, 剩余: ${this.connections.size}`);
  }

  /** 获取当前所有活跃连接数 */
  get size(): number {
    return this.connections.size;
  }

  /** 向指定连接发送文本消息（自动检查连接状态） */
  send(conn: ClientConnection, data: string): void {
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(data);
    }
  }

  /** 向指定连接发送二进制数据 */
  sendBinary(conn: ClientConnection, data: Buffer): void {
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(data);
    }
  }

  /** 广播消息给所有已认证的连接 */
  broadcast(data: string): void {
    for (const conn of this.connections.values()) {
      if (conn.authenticated) {
        this.send(conn, data);
      }
    }
  }
}
