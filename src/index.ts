/**
 * OpenClaw WebSocket Plugin 入口文件。
 *
 * 整体组装流程：
 *   1. OpenClaw 加载插件，调用 plugin.register(api)
 *   2. register 中注册 Service（同步），实际启动在 service.start() 中完成
 *   3. service.start() 初始化服务层 → 处理层 → 协议层 → 传输层
 *   4. 启动 WebSocket 服务，开始接受外部 Web 项目连接
 */

import { config } from './config.js';

// 传输层
import { ConnectionManager } from './server/ConnectionManager.js';
import { WebSocketServerWrapper } from './server/WebSocketServer.js';

// 协议层
import { MessageRouter } from './protocol/MessageRouter.js';

// 服务层
import { OpenClawClient } from './services/gateway/OpenClawClient.js';
import { FileManager } from './services/file/FileManager.js';
import { FileTransfer } from './services/file/FileTransfer.js';
import { FileConverter } from './services/file/FileConverter.js';
import { SessionManager } from './services/session/SessionManager.js';

// 处理层
import { ChatHandler } from './handlers/ChatHandler.js';
import { FileHandler } from './handlers/FileHandler.js';
import { TaskHandler } from './handlers/TaskHandler.js';
import { SessionHandler } from './handlers/SessionHandler.js';

import type { PluginConfig } from './types.js';

/** WebSocket 服务实例引用，用于 stop 时关闭 */
let wsServer: WebSocketServerWrapper | null = null;
let fileManager: FileManager | null = null;
let sessionManager: SessionManager | null = null;

/**
 * 插件主对象，导出给 OpenClaw 加载。
 * 遵循 OpenClawPluginDefinition 接口：id + name + register(api)
 */
const plugin = {
  id: 'websocket-connector',
  name: 'WebSocket Connector',
  description: '通用 WebSocket 插件，让任意 Web 项目通过 WebSocket 与 OpenClaw 通信',

  /**
   * 插件注册入口（由 OpenClaw 宿主调用，必须同步）。
   * 通过 api.registerService() 注册后台服务，
   * 实际的异步初始化在 service.start() 中完成。
   */
  register(api: {
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    runtime: Record<string, unknown>;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void; debug?: (msg: string) => void };
    registerService: (service: { id: string; start: (ctx: unknown) => Promise<void> | void; stop?: (ctx: unknown) => Promise<void> | void }) => void;
    registerGatewayMethod: (method: string, handler: (params: Record<string, unknown>) => unknown) => void;
  }) {
    const log = api.logger;
    log.info('WebSocket Connector 插件注册中...');

    // 从 pluginConfig 读取插件配置
    const pluginCfg = (api.pluginConfig || {}) as Partial<PluginConfig>;
    config.init(pluginCfg, {
      gatewayToken: (api.config as Record<string, unknown>)?.gateway
        ? ((api.config as Record<string, Record<string, unknown>>).gateway?.auth as Record<string, unknown>)?.token as string || ''
        : '',
    });

    if (!config.enabled) {
      log.info('WebSocket Connector 插件已禁用，跳过');
      return;
    }

    // 注册为后台服务，OpenClaw 会在 gateway 启动后调用 start()
    api.registerService({
      id: 'websocket-connector',

      /** 服务启动：初始化所有模块并启动 WebSocket 服务器 */
      async start() {
        log.info('WebSocket Connector 服务启动中...');

        // 初始化服务层
        const gateway = new OpenClawClient();
        fileManager = new FileManager();
        const fileTransfer = new FileTransfer();
        const fileConverter = new FileConverter(gateway, fileManager);
        sessionManager = new SessionManager();

        await fileManager.init();
        sessionManager.init();

        // 初始化传输层
        const connManager = new ConnectionManager();
        const router = new MessageRouter();
        wsServer = new WebSocketServerWrapper(connManager, router);

        // 初始化处理层并注册到路由器
        const chatHandler = new ChatHandler(gateway, sessionManager, connManager);
        const fileHandler = new FileHandler(fileManager, fileTransfer, fileConverter, wsServer, connManager);
        const taskHandler = new TaskHandler(gateway, sessionManager, connManager);
        const sessionHandler = new SessionHandler(sessionManager, connManager);

        router.register(chatHandler);
        router.register(fileHandler);
        router.register(taskHandler);
        router.register(sessionHandler);

        // 启动 WebSocket 服务
        wsServer.start();

        log.info(`WebSocket Connector 已启动，端口: ${config.port}`);
      },

      /** 服务停止：关闭 WebSocket 服务器和所有资源 */
      stop() {
        log.info('WebSocket Connector 服务关闭中...');
        wsServer?.stop();
        fileManager?.destroy();
        sessionManager?.shutdown();
        wsServer = null;
        fileManager = null;
        sessionManager = null;
      },
    });

    // 注册 Gateway 方法
    api.registerGatewayMethod('websocket-connector.status', () => ({
      enabled: config.enabled,
      port: config.port,
    }));

    api.registerGatewayMethod('websocket-connector.probe', () => ({
      status: 'ok',
      timestamp: Date.now(),
    }));

    log.info('WebSocket Connector 插件注册完成');
  },
};

export default plugin;
