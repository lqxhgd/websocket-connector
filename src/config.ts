import path from 'node:path';
import os from 'node:os';
import type { PluginConfig, PluginRuntime } from './types.js';

/** 默认配置值 */
const DEFAULTS: PluginConfig = {
  enabled: true,
  port: 18800,
  authToken: '',
  sessionTimeout: 30 * 60 * 1000,
  maxFileSize: 20 * 1024 * 1024,
};

/** 全局配置单例，管理插件运行时所有配置项 */
class Config {
  private pluginConfig: PluginConfig = { ...DEFAULTS };
  private runtime: PluginRuntime = {};

  /** 用外部配置覆盖默认值（插件注册时调用） */
  init(config: Partial<PluginConfig>, runtime?: PluginRuntime): void {
    this.pluginConfig = { ...DEFAULTS, ...config };
    if (runtime) this.runtime = runtime;
  }

  /** 获取 WebSocket 服务监听端口 */
  get port(): number {
    return Number(process.env.WS_PORT) || this.pluginConfig.port;
  }

  /** 获取客户端认证 Token（空字符串表示不校验） */
  get authToken(): string {
    return process.env.WS_AUTH_TOKEN || this.pluginConfig.authToken;
  }

  /** 获取会话超时时间（毫秒） */
  get sessionTimeout(): number {
    return this.pluginConfig.sessionTimeout;
  }

  /** 获取单文件最大大小（字节） */
  get maxFileSize(): number {
    return this.pluginConfig.maxFileSize;
  }

  /** 获取插件是否启用 */
  get enabled(): boolean {
    return this.pluginConfig.enabled;
  }

  /** 获取 OpenClaw Gateway 地址 */
  get gatewayUrl(): string {
    const host = this.runtime.gateway?.host || '127.0.0.1';
    const port = this.runtime.gateway?.port || 18789;
    return `http://${host}:${port}`;
  }

  /** 获取 Gateway 认证令牌 */
  get gatewayAuth(): string {
    return this.runtime.gatewayToken || this.runtime.gatewayPassword || '';
  }

  /** 获取文件存储根目录：~/.openclaw/workspace/media/ */
  get mediaDir(): string {
    return path.join(os.homedir(), '.openclaw', 'workspace', 'media');
  }

  /** 获取入站文件目录（Web → OpenClaw） */
  get inboundDir(): string {
    return path.join(this.mediaDir, 'inbound');
  }

  /** 获取出站文件目录（OpenClaw → Web） */
  get outboundDir(): string {
    return path.join(this.mediaDir, 'outbound');
  }

  /** 文件分块传输默认块大小（64KB） */
  get chunkSize(): number {
    return 64 * 1024;
  }

  /** 心跳检测间隔（毫秒） */
  get heartbeatInterval(): number {
    return 30_000;
  }

  /** 临时文件过期时间（毫秒），默认 24 小时 */
  get fileExpiry(): number {
    return 24 * 60 * 60 * 1000;
  }
}

export const config = new Config();
