/** 日志级别 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

/** 带前缀和时间戳的轻量日志工具 */
class Logger {
  private level: LogLevel = 'info';
  private prefix: string;

  constructor(prefix = 'WS-Plugin') {
    this.prefix = prefix;
    const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
    if (envLevel && envLevel in LEVEL_PRIORITY) {
      this.level = envLevel;
    }
  }

  /** 创建带子前缀的 Logger 实例（用于各模块独立标记） */
  child(subPrefix: string): Logger {
    const child = new Logger(`${this.prefix}:${subPrefix}`);
    child.level = this.level;
    return child;
  }

  debug(msg: string, ...args: unknown[]): void {
    this.log('debug', msg, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.log('info', msg, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.log('warn', msg, ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.log('error', msg, ...args);
  }

  private log(level: LogLevel, msg: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return;
    const time = new Date().toISOString();
    const color = LEVEL_COLORS[level];
    const tag = level.toUpperCase().padEnd(5);
    console.log(`${color}[${time}] [${tag}] [${this.prefix}]${RESET} ${msg}`, ...args);
  }
}

/** 全局 Logger 实例 */
export const logger = new Logger();
