import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config.js';
import { PluginError, ErrorCode } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { UploadTask, ClientConnection } from '../../types.js';

const log = logger.child('Transfer');

/**
 * 文件分块传输服务：管理上传任务的分块接收和下载的分块发送。
 * 上传流程：initUpload → receiveChunk（多次）→ completeUpload → 返回完整 Buffer
 * 下载流程：sendChunks → 将 Buffer 分块通过 WebSocket 发送
 */
export class FileTransfer {
  /** uploadId → UploadTask */
  private uploads = new Map<string, UploadTask>();

  /**
   * 初始化一个上传任务，返回 uploadId 和协商的块大小。
   * 客户端后续按此块大小发送二进制帧。
   *
   * @param fileName - 文件名
   * @param fileSize - 文件总大小（字节）
   * @param mimeType - MIME 类型
   * @returns uploadId 和 chunkSize
   */
  initUpload(fileName: string, fileSize: number, mimeType?: string): { uploadId: string; chunkSize: number } {
    if (fileSize > config.maxFileSize) {
      throw new PluginError(
        ErrorCode.FILE_TOO_LARGE,
        `文件大小 ${fileSize} 超过限制 ${config.maxFileSize}`,
      );
    }

    const uploadId = uuidv4();
    const task: UploadTask = {
      id: uploadId,
      fileName,
      fileSize,
      mimeType: mimeType || 'application/octet-stream',
      chunkSize: config.chunkSize,
      receivedBytes: 0,
      chunks: [],
      createdAt: Date.now(),
    };
    this.uploads.set(uploadId, task);
    log.info(`上传任务已创建: ${uploadId}, 文件: ${fileName}, 大小: ${fileSize}`);

    return { uploadId, chunkSize: task.chunkSize };
  }

  /**
   * 接收一个二进制数据块，追加到对应的上传任务。
   * @returns 当前已接收字节数
   */
  receiveChunk(uploadId: string, chunk: Buffer): number {
    const task = this.uploads.get(uploadId);
    if (!task) {
      throw new PluginError(ErrorCode.UPLOAD_FAILED, `上传任务 ${uploadId} 不存在`);
    }

    task.chunks.push(chunk);
    task.receivedBytes += chunk.length;
    return task.receivedBytes;
  }

  /**
   * 完成上传：将所有 chunk 拼接为完整 Buffer 并清理任务。
   * @returns 完整文件数据、文件名和 MIME 类型
   */
  completeUpload(uploadId: string): { data: Buffer; fileName: string; mimeType: string } {
    const task = this.uploads.get(uploadId);
    if (!task) {
      throw new PluginError(ErrorCode.UPLOAD_FAILED, `上传任务 ${uploadId} 不存在`);
    }

    const data = Buffer.concat(task.chunks);
    log.info(`上传完成: ${uploadId}, 接收 ${data.length} 字节`);
    this.uploads.delete(uploadId);

    return { data, fileName: task.fileName, mimeType: task.mimeType };
  }

  /**
   * 将文件数据分块发送给客户端。
   * 先发送 download.start 消息告知文件信息，再逐块发送二进制帧，最后发送 download.done。
   *
   * @param data - 文件完整数据
   * @param sendBinary - 发送二进制帧的回调函数
   * @returns 发送的总块数
   */
  sendChunks(data: Buffer, sendBinary: (chunk: Buffer) => void): number {
    const chunkSize = config.chunkSize;
    const totalChunks = Math.ceil(data.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      sendBinary(data.subarray(start, end));
    }

    log.debug(`文件分块发送完成: ${totalChunks} 块, ${data.length} 字节`);
    return totalChunks;
  }

  /** 获取上传任务信息（用于状态查询） */
  getUploadTask(uploadId: string): UploadTask | undefined {
    return this.uploads.get(uploadId);
  }

  /** 取消上传任务，释放内存 */
  cancelUpload(uploadId: string): void {
    this.uploads.delete(uploadId);
    log.info(`上传任务已取消: ${uploadId}`);
  }
}
