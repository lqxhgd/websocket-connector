import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config.js';
import { fileNotFound, PluginError, ErrorCode } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { FileMetadata } from '../../types.js';

const log = logger.child('FileMgr');

/**
 * 文件存储服务：负责文件的保存、读取、元数据管理和过期清理。
 * 文件按 inbound（上传）和 outbound（下载）分目录存放。
 */
export class FileManager {
  /** fileId → FileMetadata 内存索引 */
  private files = new Map<string, FileMetadata>();
  /** 过期清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** 初始化：确保存储目录存在，启动过期清理 */
  async init(): Promise<void> {
    await fs.mkdir(config.inboundDir, { recursive: true });
    await fs.mkdir(config.outboundDir, { recursive: true });
    this.startCleanup();
    log.info(`文件存储已初始化: ${config.mediaDir}`);
  }

  /**
   * 保存文件到 inbound 目录，返回文件元数据。
   * @param fileName - 原始文件名
   * @param data - 文件完整内容
   * @param mimeType - MIME 类型
   */
  async save(fileName: string, data: Buffer, mimeType = 'application/octet-stream'): Promise<FileMetadata> {
    const id = uuidv4();
    const safeName = `${Date.now()}-${sanitizeFileName(fileName)}`;
    const filePath = path.join(config.inboundDir, safeName);

    await fs.writeFile(filePath, data);

    const meta: FileMetadata = {
      id,
      fileName,
      filePath,
      fileSize: data.length,
      mimeType,
      direction: 'inbound',
      createdAt: Date.now(),
    };
    this.files.set(id, meta);
    log.info(`文件已保存: ${id} → ${safeName} (${formatSize(data.length)})`);
    return meta;
  }

  /**
   * 读取文件内容。
   * @param fileId - 文件 ID
   * @returns 文件 Buffer 和元数据
   */
  async read(fileId: string): Promise<{ data: Buffer; meta: FileMetadata }> {
    const meta = this.files.get(fileId);
    if (!meta) throw fileNotFound(fileId);

    try {
      const data = await fs.readFile(meta.filePath);
      return { data, meta };
    } catch {
      throw fileNotFound(fileId);
    }
  }

  /** 根据文件 ID 获取元数据 */
  getMeta(fileId: string): FileMetadata | undefined {
    return this.files.get(fileId);
  }

  /**
   * 注册一个已存在于磁盘的文件（如 OpenClaw 生成的输出文件）。
   * @param filePath - 文件在磁盘上的绝对路径
   * @param fileName - 展示给客户端的文件名
   */
  async register(filePath: string, fileName: string): Promise<FileMetadata> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) throw fileNotFound(filePath);

    const id = uuidv4();
    const meta: FileMetadata = {
      id,
      fileName,
      filePath,
      fileSize: stat.size,
      mimeType: guessMimeType(fileName),
      direction: 'outbound',
      createdAt: Date.now(),
    };
    this.files.set(id, meta);
    log.info(`文件已注册: ${id} → ${fileName}`);
    return meta;
  }

  /** 停止清理定时器 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** 定时清理过期文件（默认 24 小时） */
  private startCleanup(): void {
    const interval = 60 * 60 * 1000; // 每小时检查一次
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    const expiry = config.fileExpiry;
    let removed = 0;

    for (const [id, meta] of this.files) {
      if (now - meta.createdAt > expiry) {
        await fs.unlink(meta.filePath).catch(() => {});
        this.files.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      log.info(`清理过期文件: ${removed} 个`);
    }
  }
}

/** 移除文件名中的危险字符，防止路径穿越 */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
}

/** 根据文件扩展名猜测 MIME 类型 */
function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.zip': 'application/zip',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/** 格式化文件大小为可读字符串 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
