/**
 * 所有 WebSocket 消息类型常量。
 * 命名规则：模块.动作，如 "chat"、"file.upload.start"。
 * 客户端和服务端共用同一套类型，通过方向注释区分。
 */
export const MSG = {
  // ---- 系统类 ----
  AUTH: 'auth',                           // 客户端→服务端：认证
  PING: 'ping',                           // 双向：心跳请求
  PONG: 'pong',                           // 双向：心跳响应
  ERROR: 'error',                         // 服务端→客户端：错误通知

  // ---- 对话类 ----
  CHAT: 'chat',                           // 客户端→服务端：发送对话消息
  CHAT_STREAM: 'chat.stream',             // 服务端→客户端：流式响应片段
  CHAT_DONE: 'chat.done',                 // 服务端→客户端：对话完成
  CHAT_ERROR: 'chat.error',              // 服务端→客户端：对话错误

  // ---- 文件类 ----
  FILE_UPLOAD_START: 'file.upload.start',       // 客户端→服务端：发起上传
  FILE_UPLOAD_READY: 'file.upload.ready',       // 服务端→客户端：上传就绪
  FILE_UPLOAD_COMPLETE: 'file.upload.complete', // 客户端→服务端：上传完成
  FILE_UPLOAD_DONE: 'file.upload.done',         // 服务端→客户端：处理完成
  FILE_DOWNLOAD: 'file.download',               // 客户端→服务端：请求下载
  FILE_DOWNLOAD_START: 'file.download.start',   // 服务端→客户端：下载开始
  FILE_DOWNLOAD_DONE: 'file.download.done',     // 服务端→客户端：下载完成
  FILE_CONVERT: 'file.convert',                 // 客户端→服务端：格式转换

  // ---- 会话类 ----
  SESSION_CREATE: 'session.create',       // 客户端→服务端：创建会话
  SESSION_RESUME: 'session.resume',       // 客户端→服务端：恢复会话
  SESSION_DESTROY: 'session.destroy',     // 客户端→服务端：销毁会话
  SESSION_LIST: 'session.list',           // 客户端→服务端：列出会话
  SESSION_INFO: 'session.info',           // 服务端→客户端：会话信息

  // ---- 任务类 ----
  TASK_SUBMIT: 'task.submit',             // 客户端→服务端：提交任务
  TASK_STATUS: 'task.status',             // 客户端→服务端：查询状态
  TASK_RESULT: 'task.result',             // 服务端→客户端：任务结果
  TASK_CANCEL: 'task.cancel',             // 客户端→服务端：取消任务
} as const;

/** 消息类型的联合类型，用于类型检查 */
export type MessageType = (typeof MSG)[keyof typeof MSG];
