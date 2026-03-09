import { v4 as uuidv4 } from 'uuid';
import type { WSMessage, ClientConnection, IMessageHandler, TaskSubmitPayload, TaskStatusPayload, TaskCancelPayload, TaskInfo } from '../types.js';
import type { OpenClawClient } from '../services/gateway/OpenClawClient.js';
import type { SessionManager } from '../services/session/SessionManager.js';
import { ConnectionManager } from '../server/ConnectionManager.js';
import { MSG } from '../protocol/MessageTypes.js';
import { serialize, serializeError } from '../protocol/Serializer.js';
import { ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const log = logger.child('TaskHandler');

/**
 * 任务处理器：处理所有 "task" 前缀的消息。
 * 支持提交异步任务（如文件处理、复杂计算），后台执行后通过 WebSocket 推送结果。
 *
 * 消息类型：
 *   task.submit → 提交任务
 *   task.status → 查询任务状态
 *   task.cancel → 取消任务
 */
export class TaskHandler implements IMessageHandler {
  readonly prefix = 'task';

  /** taskId → TaskInfo */
  private tasks = new Map<string, TaskInfo>();
  /** taskId → 所属 connectionId（用于推送结果） */
  private taskOwners = new Map<string, string>();

  constructor(
    private gateway: OpenClawClient,
    private sessions: SessionManager,
    private connManager: ConnectionManager,
  ) {}

  async handle(message: WSMessage, conn: ClientConnection): Promise<void> {
    switch (message.type) {
      case MSG.TASK_SUBMIT:
        await this.handleSubmit(message, conn);
        break;
      case MSG.TASK_STATUS:
        this.handleStatus(message, conn);
        break;
      case MSG.TASK_CANCEL:
        this.handleCancel(message, conn);
        break;
      default:
        conn.socket.send(
          serializeError(ErrorCode.UNKNOWN_TYPE, `未知任务消息类型: ${message.type}`, message.id),
        );
    }
  }

  /**
   * 提交异步任务：
   * 1. 创建任务记录
   * 2. 立即返回 taskId
   * 3. 后台调用 Gateway 执行任务
   * 4. 完成后通过 WebSocket 推送 task.result
   */
  private async handleSubmit(message: WSMessage, conn: ClientConnection): Promise<void> {
    const payload = message.payload as TaskSubmitPayload;
    if (!payload?.sessionId || !payload?.description) {
      this.connManager.send(
        conn,
        serializeError(ErrorCode.INVALID_MESSAGE, '缺少 sessionId 或 description', message.id),
      );
      return;
    }

    const taskId = uuidv4();
    const task: TaskInfo = {
      id: taskId,
      sessionId: payload.sessionId,
      description: payload.description,
      status: 'pending',
      files: payload.files,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, task);
    this.taskOwners.set(taskId, conn.id);

    // 立即返回 taskId
    this.connManager.send(
      conn,
      serialize(MSG.TASK_STATUS, { taskId, status: 'pending' }, message.id),
    );

    // 后台异步执行
    this.executeTask(task, conn);
  }

  /** 查询任务当前状态 */
  private handleStatus(message: WSMessage, conn: ClientConnection): void {
    const payload = message.payload as TaskStatusPayload;
    const task = this.tasks.get(payload.taskId);

    if (!task) {
      this.connManager.send(
        conn,
        serializeError(ErrorCode.TASK_NOT_FOUND, `任务 ${payload.taskId} 不存在`, message.id),
      );
      return;
    }

    this.connManager.send(
      conn,
      serialize(MSG.TASK_STATUS, {
        taskId: task.id,
        status: task.status,
        result: task.result,
        error: task.error,
      }, message.id),
    );
  }

  /** 取消任务（仅能取消 pending 状态的任务） */
  private handleCancel(message: WSMessage, conn: ClientConnection): void {
    const payload = message.payload as TaskCancelPayload;
    const task = this.tasks.get(payload.taskId);

    if (!task) {
      this.connManager.send(
        conn,
        serializeError(ErrorCode.TASK_NOT_FOUND, `任务 ${payload.taskId} 不存在`, message.id),
      );
      return;
    }

    if (task.status === 'pending') {
      task.status = 'cancelled';
      task.updatedAt = Date.now();
    }

    this.connManager.send(
      conn,
      serialize(MSG.TASK_STATUS, { taskId: task.id, status: task.status }, message.id),
    );
  }

  /**
   * 后台执行任务：调用 Gateway 的非流式接口，完成后推送结果。
   * 不阻塞主流程，错误会被捕获并更新任务状态。
   */
  private async executeTask(task: TaskInfo, conn: ClientConnection): Promise<void> {
    task.status = 'running';
    task.updatedAt = Date.now();

    try {
      const session = this.sessions.find(task.sessionId);
      const sessionKey = session
        ? this.sessions.getSessionKey(session)
        : `task:${task.id}`;

      const fileContext = task.files?.length
        ? `\n相关文件: ${task.files.join(', ')}`
        : '';

      const result = await this.gateway.chat(
        [{ role: 'user', content: task.description + fileContext, timestamp: Date.now() }],
        sessionKey,
      );

      task.status = 'completed';
      task.result = result;
      task.updatedAt = Date.now();

      log.info(`任务完成: ${task.id}`);
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      task.updatedAt = Date.now();

      log.error(`任务失败: ${task.id}, ${task.error}`);
    }

    // 推送结果给客户端
    this.connManager.send(
      conn,
      serialize(MSG.TASK_RESULT, {
        taskId: task.id,
        status: task.status,
        result: task.result,
        error: task.error,
      }),
    );
  }
}
