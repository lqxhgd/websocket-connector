import type { WebSocket } from 'ws';

// ============================================================
// Plugin SDK 类型（OpenClaw 插件运行时接口）
// ============================================================

/** OpenClaw 插件 API，由宿主注入，用于注册能力和访问 Gateway */
export interface PluginApi {
  registerGatewayMethod(name: string, handler: GatewayMethodHandler): void;
  getConfig(): PluginConfig;
}

/** Gateway 方法处理函数签名 */
export type GatewayMethodHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** 插件运行时上下文，包含 Gateway 地址和认证信息 */
export interface PluginRuntime {
  gateway?: {
    port: number;
    host: string;
  };
  gatewayToken?: string;
  gatewayPassword?: string;
}

/** 插件配置（对应 openclaw.plugin.json 中的 configSchema） */
export interface PluginConfig {
  enabled: boolean;
  port: number;
  authToken: string;
  sessionTimeout: number;
  maxFileSize: number;
}

// ============================================================
// WebSocket 消息协议类型
// ============================================================

/** 所有 WebSocket 消息的统一结构 */
export interface WSMessage<T = unknown> {
  type: string;
  id: string;
  payload: T;
  timestamp: number;
}

/** 认证请求载荷 */
export interface AuthPayload {
  token: string;
  clientId?: string;
}

/** 对话请求载荷 */
export interface ChatPayload {
  sessionId: string;
  content: string;
  role?: 'user' | 'system';
}

/** 对话流式响应载荷 */
export interface ChatStreamPayload {
  sessionId: string;
  chunk: string;
}

/** 对话完成载荷 */
export interface ChatDonePayload {
  sessionId: string;
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** 文件上传发起载荷 */
export interface FileUploadStartPayload {
  fileName: string;
  fileSize: number;
  mimeType?: string;
}

/** 文件上传就绪响应载荷 */
export interface FileUploadReadyPayload {
  uploadId: string;
  chunkSize: number;
}

/** 文件上传完成通知载荷 */
export interface FileUploadCompletePayload {
  uploadId: string;
}

/** 文件上传处理完成响应载荷 */
export interface FileUploadDonePayload {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
}

/** 文件下载请求载荷 */
export interface FileDownloadPayload {
  fileId: string;
}

/** 文件下载完成响应载荷 */
export interface FileDownloadDonePayload {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
}

/** 文件转换请求载荷 */
export interface FileConvertPayload {
  fileId: string;
  targetFormat: string;
  sessionId?: string;
}

/** 会话创建载荷 */
export interface SessionCreatePayload {
  name?: string;
}

/** 会话恢复载荷 */
export interface SessionResumePayload {
  sessionId: string;
}

/** 会话销毁载荷 */
export interface SessionDestroyPayload {
  sessionId: string;
}

/** 任务提交载荷 */
export interface TaskSubmitPayload {
  sessionId: string;
  description: string;
  files?: string[];
}

/** 任务状态查询载荷 */
export interface TaskStatusPayload {
  taskId: string;
}

/** 任务取消载荷 */
export interface TaskCancelPayload {
  taskId: string;
}

/** 错误响应载荷 */
export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================================
// 连接与会话类型
// ============================================================

/** 客户端连接信息，绑定到每个 WebSocket 连接 */
export interface ClientConnection {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  clientId?: string;
  connectedAt: number;
  lastActivity: number;
}

/** 会话信息 */
export interface Session {
  id: string;
  connectionId: string;
  name?: string;
  createdAt: number;
  lastActivity: number;
  messageHistory: ChatMessage[];
}

/** 对话消息记录 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// ============================================================
// 文件管理类型
// ============================================================

/** 文件元数据 */
export interface FileMetadata {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  direction: 'inbound' | 'outbound';
  createdAt: number;
}

/** 上传任务状态 */
export interface UploadTask {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  receivedBytes: number;
  chunks: Buffer[];
  createdAt: number;
}

// ============================================================
// 任务管理类型
// ============================================================

/** 任务状态枚举 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 异步任务信息 */
export interface TaskInfo {
  id: string;
  sessionId: string;
  description: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  files?: string[];
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// Handler 接口
// ============================================================

/** 消息处理器接口，所有 Handler 必须实现 */
export interface IMessageHandler {
  /** 该 Handler 处理的消息类型前缀，如 "chat"、"file" */
  readonly prefix: string;
  /** 处理消息，conn 为发送消息的客户端连接 */
  handle(message: WSMessage, conn: ClientConnection): Promise<void>;
}

// ============================================================
// Gateway 客户端接口
// ============================================================

/** OpenClaw Gateway 客户端接口，便于后续适配不同版本 API */
export interface IGatewayClient {
  /** 发送流式对话请求，通过回调逐块返回 */
  streamChat(
    messages: ChatMessage[],
    sessionKey: string,
    onChunk: (chunk: string) => void,
    onDone: (fullContent: string) => void,
    onError: (error: Error) => void,
  ): Promise<void>;

  /** 发送非流式对话请求，返回完整响应 */
  chat(messages: ChatMessage[], sessionKey: string): Promise<string>;
}
