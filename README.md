# OpenClaw WebSocket Plugin

通用 WebSocket 插件，让任意 Web 项目通过 WebSocket 连接即可与 OpenClaw 通信。

## 功能

- **对话** — 流式 AI 对话，实时逐字推送
- **文件传输** — 双向分块传输，支持大文件
- **文件转换** — PDF→DOC 等格式转换（通过 AI Agent 完成）
- **会话管理** — 多会话、断线恢复、超时清理
- **任务管理** — 异步任务提交、状态查询、结果推送

## 快速开始

### 1. 安装

将 `websocket-connector` 目录放入 OpenClaw 的插件目录，或在 `~/.openclaw/openclaw.json` 中配置：

```json
{
  "channels": {
    "websocket-connector": {
      "enabled": true,
      "port": 18800,
      "authToken": "",
      "sessionTimeout": 1800000,
      "maxFileSize": 20971520
    }
  }
}
```

### 2. 安装依赖

```bash
cd websocket-connector
npm install
```

### 3. 启动

插件随 OpenClaw 自动加载启动。独立开发调试：

```bash
npm run dev
```

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用插件 |
| `port` | number | `18800` | WebSocket 服务端口 |
| `authToken` | string | `""` | 认证 Token（为空不校验） |
| `sessionTimeout` | number | `1800000` | 会话超时（ms），默认 30 分钟 |
| `maxFileSize` | number | `20971520` | 单文件大小限制（bytes），默认 20MB |

环境变量覆盖：`WS_PORT`、`WS_AUTH_TOKEN`、`LOG_LEVEL`（debug/info/warn/error）。

## 消息协议

所有消息为 JSON 格式，统一结构：

```typescript
{
  type: string,      // 消息类型
  id: string,        // 唯一 ID（用于请求-响应匹配）
  payload: object,   // 业务数据
  timestamp: number  // 时间戳
}
```

## Web 客户端接入示例

```javascript
const ws = new WebSocket('ws://your-host:18800');

// 认证
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    id: '1',
    payload: { token: 'your-token' },
    timestamp: Date.now()
  }));
};

// 创建会话
ws.send(JSON.stringify({
  type: 'session.create',
  id: '2',
  payload: { name: '测试会话' },
  timestamp: Date.now()
}));

// 发送对话（收到 session.info 后使用返回的 sessionId）
ws.send(JSON.stringify({
  type: 'chat',
  id: '3',
  payload: { sessionId: 'xxx', content: '你好' },
  timestamp: Date.now()
}));

// 接收消息
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'auth.success':
      console.log('认证成功');
      break;
    case 'session.info':
      console.log('会话:', msg.payload.sessionId);
      break;
    case 'chat.stream':
      process.stdout.write(msg.payload.chunk);
      break;
    case 'chat.done':
      console.log('\n完成');
      break;
    case 'error':
      console.error('错误:', msg.payload.message);
      break;
  }
};
```

### 文件上传示例

```javascript
// 1. 发起上传
ws.send(JSON.stringify({
  type: 'file.upload.start',
  id: '10',
  payload: { fileName: 'doc.pdf', fileSize: 1024000 },
  timestamp: Date.now()
}));

// 2. 收到 file.upload.ready 后，按 chunkSize 分块发送二进制帧
// ws.send(binaryChunk);  // ArrayBuffer

// 3. 所有块发送完成后通知
ws.send(JSON.stringify({
  type: 'file.upload.complete',
  id: '11',
  payload: { uploadId: 'xxx' },
  timestamp: Date.now()
}));
```

### 文件下载示例

```javascript
ws.send(JSON.stringify({
  type: 'file.download',
  id: '20',
  payload: { fileId: 'yyy' },
  timestamp: Date.now()
}));
// 服务端先发送 file.download.start（含文件信息），
// 再逐块发送二进制帧，最后发送 file.download.done。
```

## 消息类型清单

| 类型 | 方向 | 说明 |
|------|------|------|
| `auth` | C→S | 认证 |
| `auth.success` | S→C | 认证成功 |
| `ping` / `pong` | 双向 | 心跳 |
| `error` | S→C | 错误 |
| `chat` | C→S | 发送对话 |
| `chat.stream` | S→C | 流式响应片段 |
| `chat.done` | S→C | 对话完成 |
| `chat.error` | S→C | 对话错误 |
| `file.upload.start` | C→S | 发起上传 |
| `file.upload.ready` | S→C | 上传就绪 |
| `file.upload.complete` | C→S | 上传完成 |
| `file.upload.done` | S→C | 处理完成 |
| `file.download` | C→S | 请求下载 |
| `file.download.start` | S→C | 下载开始 |
| `file.download.done` | S→C | 下载完成 |
| `file.convert` | C→S | 格式转换 |
| `file.convert.done` | S→C | 转换完成 |
| `session.create` | C→S | 创建会话 |
| `session.resume` | C→S | 恢复会话 |
| `session.destroy` | C→S | 销毁会话 |
| `session.list` | C→S | 列出会话 |
| `session.info` | S→C | 会话信息 |
| `task.submit` | C→S | 提交任务 |
| `task.status` | C→S / S→C | 任务状态 |
| `task.result` | S→C | 任务结果 |
| `task.cancel` | C→S | 取消任务 |

## 项目结构

```
src/
├── index.ts              # 插件入口
├── config.ts             # 配置管理
├── types.ts              # 类型定义
├── server/               # 传输层
│   ├── WebSocketServer.ts
│   └── ConnectionManager.ts
├── protocol/             # 协议层
│   ├── MessageTypes.ts
│   ├── MessageRouter.ts
│   └── Serializer.ts
├── handlers/             # 处理层
│   ├── ChatHandler.ts
│   ├── FileHandler.ts
│   ├── TaskHandler.ts
│   └── SessionHandler.ts
├── services/             # 服务层
│   ├── gateway/
│   ├── file/
│   └── session/
└── utils/                # 工具层
```

## License

MIT
