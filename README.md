# OpenClaw WebSocket Connector

通用 WebSocket 插件，让任意 Web 项目通过 WebSocket 连接即可与 OpenClaw 通信。支持流式对话、文件双向传输、会话管理和异步任务管理。

## 功能特性

- **流式对话** — 实时逐字推送 AI 回复，支持多轮对话上下文
- **文件传输** — 双向分块传输，支持大文件上传/下载
- **文件转换** — PDF→DOC 等格式转换（通过 AI Agent 完成）
- **会话管理** — 多会话并行、断线恢复、超时自动清理
- **任务管理** — 异步任务提交、状态查询、结果推送
- **通用接入** — 任何支持 WebSocket 的平台均可接入（浏览器、Node.js、Python、移动端等）

## 前置要求

- [OpenClaw](https://github.com/open-claw/openclaw) 已部署并运行（Docker 或本地）
- OpenClaw Gateway 已配置好 AI 模型（如 Kimi、GPT 等）

## 安装

### 方式一：通过 npm 安装（推荐）

在 OpenClaw 运行环境中执行：

```bash
openclaw plugins install openclaw-websocket-connector
```

### 方式二：Docker 环境安装

如果 OpenClaw 运行在 Docker 中：

```bash
# 进入容器
docker compose exec openclaw-gateway sh

# 安装插件
node dist/index.js plugins install openclaw-websocket-connector

# 退出容器
exit

# 重启容器加载插件
docker compose restart openclaw-gateway
```

### 方式三：从源码安装

```bash
git clone https://github.com/lqxhgd/websocket-connector.git
cd websocket-connector
npm install

# 在 OpenClaw 容器中安装
docker cp ./websocket-connector 容器名:/tmp/ws-plugin
docker compose exec openclaw-gateway node dist/index.js plugins install /tmp/ws-plugin
docker compose restart openclaw-gateway
```

## 配置

### 1. 开启 Gateway HTTP 端点

在 `~/.openclaw/openclaw.json` 的 `gateway` 配置中启用 `chatCompletions`：

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

### 2. 端口映射（Docker 环境）

在 `docker-compose.yml` 的 `ports` 中添加 WebSocket 端口：

```yaml
ports:
  - "18789:18789"
  - "18800:18800"   # WebSocket Connector 端口
```

### 3. 插件配置项

安装后可在 `openclaw.json` 中配置：

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

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用插件 |
| `port` | number | `18800` | WebSocket 服务监听端口 |
| `authToken` | string | `""` | 客户端认证 Token（为空不校验） |
| `sessionTimeout` | number | `1800000` | 会话超时（毫秒），默认 30 分钟 |
| `maxFileSize` | number | `20971520` | 单文件大小限制（字节），默认 20MB |

环境变量覆盖：`WS_PORT`、`WS_AUTH_TOKEN`、`LOG_LEVEL`（debug/info/warn/error）

## 快速接入

### 基本流程

```
连接 → 认证 → 创建会话 → 发送消息 → 接收流式响应
```

### JavaScript / 浏览器

```javascript
const ws = new WebSocket('ws://your-server:18800');

// 1. 认证（连接成功后自动触发）
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    id: '1',
    payload: { token: 'your-token' },  // 服务端未设 authToken 时留空即可
    timestamp: Date.now()
  }));
};

let sessionId = null;

// 2. 监听消息
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'auth.success':
      // 认证成功，创建会话
      ws.send(JSON.stringify({
        type: 'session.create',
        id: '2',
        payload: { name: '我的会话' },
        timestamp: Date.now()
      }));
      break;

    case 'session.info':
      // 会话创建成功，保存 sessionId
      sessionId = msg.payload.sessionId;
      console.log('会话已创建:', sessionId);
      break;

    case 'chat.stream':
      // 流式响应，逐字显示
      process.stdout.write(msg.payload.chunk);
      break;

    case 'chat.done':
      // 对话完成
      console.log('\n[完成]');
      break;

    case 'error':
      console.error('错误:', msg.payload.message);
      break;
  }
};

// 3. 发送对话
function sendMessage(content) {
  ws.send(JSON.stringify({
    type: 'chat',
    id: String(Date.now()),
    payload: { sessionId, content },
    timestamp: Date.now()
  }));
}
```

### Node.js

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://your-server:18800');

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'auth',
    id: '1',
    payload: { token: '' },
    timestamp: Date.now()
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log(`[${msg.type}]`, JSON.stringify(msg.payload));
});
```

### Python

```python
import asyncio
import websockets
import json

async def main():
    uri = "ws://your-server:18800"
    async with websockets.connect(uri) as ws:
        # 认证
        await ws.send(json.dumps({
            "type": "auth",
            "id": "1",
            "payload": {"token": ""},
            "timestamp": 0
        }))

        # 创建会话
        auth_resp = json.loads(await ws.recv())
        print("认证:", auth_resp["type"])

        await ws.send(json.dumps({
            "type": "session.create",
            "id": "2",
            "payload": {"name": "test"},
            "timestamp": 0
        }))

        session_resp = json.loads(await ws.recv())
        session_id = session_resp["payload"]["sessionId"]

        # 发送对话
        await ws.send(json.dumps({
            "type": "chat",
            "id": "3",
            "payload": {"sessionId": session_id, "content": "你好"},
            "timestamp": 0
        }))

        # 接收流式响应
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "chat.stream":
                print(msg["payload"]["chunk"], end="", flush=True)
            elif msg["type"] == "chat.done":
                print("\n[完成]")
                break

asyncio.run(main())
```

## 文件传输

### 上传文件

```javascript
// 1. 发起上传
ws.send(JSON.stringify({
  type: 'file.upload.start',
  id: '10',
  payload: {
    fileName: 'document.pdf',
    fileSize: file.size,
    mimeType: 'application/pdf'
  },
  timestamp: Date.now()
}));

// 2. 收到 file.upload.ready 后，按返回的 chunkSize 分块发送
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'file.upload.ready') {
    const chunkSize = msg.payload.chunkSize;  // 默认 64KB
    let offset = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      ws.send(chunk);  // 发送二进制帧
      offset += chunkSize;
    }
    // 3. 所有块发送完成后通知
    ws.send(JSON.stringify({
      type: 'file.upload.complete',
      id: '11',
      payload: { uploadId: msg.payload.uploadId },
      timestamp: Date.now()
    }));
  }
};

// 4. 收到 file.upload.done，获取 fileId
// { type: "file.upload.done", payload: { fileId: "xxx", fileName: "document.pdf", fileSize: 1024000 } }
```

### 下载文件

```javascript
ws.send(JSON.stringify({
  type: 'file.download',
  id: '20',
  payload: { fileId: 'your-file-id' },
  timestamp: Date.now()
}));

// 服务端依次发送：
// 1. file.download.start — 文件元信息（文件名、大小）
// 2. 多个二进制帧    — 文件数据块
// 3. file.download.done — 下载完成通知
```

### 文件格式转换

```javascript
ws.send(JSON.stringify({
  type: 'file.convert',
  id: '30',
  payload: {
    fileId: 'uploaded-file-id',
    targetFormat: 'docx'
  },
  timestamp: Date.now()
}));

// 收到 file.convert.done：
// { payload: { resultFileId: "xxx", resultFileName: "document.docx" } }
// 用 resultFileId 请求下载即可获取转换后的文件
```

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

### 消息类型清单

| 类型 | 方向 | 说明 |
|------|------|------|
| **系统** | | |
| `auth` | C→S | 客户端认证 |
| `auth.success` | S→C | 认证成功，返回 connectionId |
| `ping` / `pong` | 双向 | 心跳检测 |
| `error` | S→C | 错误通知 |
| **对话** | | |
| `chat` | C→S | 发送对话消息 |
| `chat.stream` | S→C | 流式响应片段 |
| `chat.done` | S→C | 对话完成，返回完整内容 |
| `chat.error` | S→C | 对话错误 |
| **文件** | | |
| `file.upload.start` | C→S | 发起文件上传 |
| `file.upload.ready` | S→C | 返回 uploadId 和 chunkSize |
| `file.upload.complete` | C→S | 通知上传完成 |
| `file.upload.done` | S→C | 服务端处理完成，返回 fileId |
| `file.download` | C→S | 请求下载文件 |
| `file.download.start` | S→C | 下载开始，含文件元信息 |
| `file.download.done` | S→C | 下载完成 |
| `file.convert` | C→S | 请求文件格式转换 |
| `file.convert.done` | S→C | 转换完成，返回新 fileId |
| **会话** | | |
| `session.create` | C→S | 创建新会话 |
| `session.resume` | C→S | 恢复已有会话（断线重连） |
| `session.destroy` | C→S | 销毁会话 |
| `session.list` | C→S | 列出当前连接的所有会话 |
| `session.info` | S→C | 返回会话信息 |
| **任务** | | |
| `task.submit` | C→S | 提交异步任务 |
| `task.status` | C→S / S→C | 查询/推送任务状态 |
| `task.result` | S→C | 任务完成，返回结果 |
| `task.cancel` | C→S | 取消任务 |

## 项目结构

```
websocket-connector/
├── src/
│   ├── index.ts              # 插件入口（注册到 OpenClaw）
│   ├── config.ts             # 配置管理
│   ├── types.ts              # 全局类型定义
│   ├── server/               # 传输层：WebSocket 服务
│   │   ├── WebSocketServer.ts
│   │   └── ConnectionManager.ts
│   ├── protocol/             # 协议层：消息路由与序列化
│   │   ├── MessageTypes.ts
│   │   ├── MessageRouter.ts
│   │   └── Serializer.ts
│   ├── handlers/             # 处理层：业务逻辑
│   │   ├── ChatHandler.ts
│   │   ├── FileHandler.ts
│   │   ├── TaskHandler.ts
│   │   └── SessionHandler.ts
│   ├── services/             # 服务层：核心能力
│   │   ├── gateway/          # OpenClaw Gateway 通信
│   │   ├── file/             # 文件管理与传输
│   │   └── session/          # 会话生命周期管理
│   └── utils/                # 工具层
├── test/
│   └── index.html            # 测试面板（浏览器打开即可测试）
├── openclaw.plugin.json      # OpenClaw 插件元数据
├── package.json
└── ARCHITECTURE.md           # 架构设计文档
```

## 测试

项目自带一个测试面板 `test/index.html`，用浏览器直接打开即可：

- 连接 / 断开 WebSocket
- 创建 / 切换 / 删除会话
- 发送对话并查看流式响应
- 上传 / 下载文件
- 提交异步任务
- 查看完整通信日志

## 常见问题

### 连接被拒绝？

- 确认 OpenClaw 容器已启动且插件已加载（查看日志中 `WebSocket 服务已启动, 端口: 18800`）
- 确认 Docker 端口映射包含 `18800:18800`
- 确认防火墙未拦截该端口

### 对话返回 404？

在 `openclaw.json` 的 `gateway.http.endpoints.chatCompletions.enabled` 设为 `true`，详见上方配置说明。

### 插件加载失败（world-writable path）？

Windows + Docker 环境下，挂载卷权限显示为 777 被安全检查拦截。解决方案：
1. 在 `docker-compose.yml` 中为 extensions 使用 Docker 命名卷
2. 或在 Linux 服务器上部署（无此问题）

详见 [ARCHITECTURE.md](ARCHITECTURE.md) 中的部署说明。

## License

MIT
