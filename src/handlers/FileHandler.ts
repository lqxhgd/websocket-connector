import type {
  WSMessage, ClientConnection, IMessageHandler,
  FileUploadStartPayload, FileUploadCompletePayload,
  FileDownloadPayload, FileConvertPayload,
} from '../types.js';
import type { FileManager } from '../services/file/FileManager.js';
import type { FileTransfer } from '../services/file/FileTransfer.js';
import type { FileConverter } from '../services/file/FileConverter.js';
import type { WebSocketServerWrapper } from '../server/WebSocketServer.js';
import { ConnectionManager } from '../server/ConnectionManager.js';
import { MSG } from '../protocol/MessageTypes.js';
import { serialize, serializeError } from '../protocol/Serializer.js';
import { ErrorCode, PluginError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const log = logger.child('FileHandler');

/**
 * 文件处理器：处理所有 "file" 前缀的消息。
 * 编排 FileManager、FileTransfer、FileConverter 三个服务完成文件操作。
 *
 * 消息类型：
 *   file.upload.start    → 发起上传
 *   file.upload.complete → 上传完成（二进制帧在上传期间由 WSServer 转发）
 *   file.download        → 请求下载
 *   file.convert         → 请求格式转换
 */
export class FileHandler implements IMessageHandler {
  readonly prefix = 'file';

  /** uploadId → connectionId 的映射，用于关联二进制帧与上传任务 */
  private activeUploads = new Map<string, string>();

  constructor(
    private fileManager: FileManager,
    private fileTransfer: FileTransfer,
    private fileConverter: FileConverter,
    private wsServer: WebSocketServerWrapper,
    private connManager: ConnectionManager,
  ) {}

  async handle(message: WSMessage, conn: ClientConnection): Promise<void> {
    switch (message.type) {
      case MSG.FILE_UPLOAD_START:
        this.handleUploadStart(message, conn);
        break;
      case MSG.FILE_UPLOAD_COMPLETE:
        await this.handleUploadComplete(message, conn);
        break;
      case MSG.FILE_DOWNLOAD:
        await this.handleDownload(message, conn);
        break;
      case MSG.FILE_CONVERT:
        await this.handleConvert(message, conn);
        break;
      default:
        conn.socket.send(
          serializeError(ErrorCode.UNKNOWN_TYPE, `未知文件消息类型: ${message.type}`, message.id),
        );
    }
  }

  /**
   * 处理上传发起请求：
   * 1. 创建上传任务
   * 2. 注册二进制帧回调（后续客户端发送的二进制帧自动追加到此任务）
   * 3. 返回 uploadId 和 chunkSize
   */
  private handleUploadStart(message: WSMessage, conn: ClientConnection): void {
    const payload = message.payload as FileUploadStartPayload;
    try {
      const { uploadId, chunkSize } = this.fileTransfer.initUpload(
        payload.fileName,
        payload.fileSize,
        payload.mimeType,
      );

      this.activeUploads.set(uploadId, conn.id);

      // 注册二进制帧回调：客户端后续发送的 binary 帧自动接收到此上传任务
      this.wsServer.registerBinaryHandler(conn.id, (chunk) => {
        this.fileTransfer.receiveChunk(uploadId, chunk);
      });

      this.connManager.send(
        conn,
        serialize(MSG.FILE_UPLOAD_READY, { uploadId, chunkSize }, message.id),
      );
      log.info(`上传就绪: uploadId=${uploadId}, file=${payload.fileName}`);
    } catch (err) {
      const msg = err instanceof PluginError ? err.message : String(err);
      this.connManager.send(conn, serializeError(ErrorCode.UPLOAD_FAILED, msg, message.id));
    }
  }

  /**
   * 处理上传完成通知：
   * 1. 拼接所有 chunk 为完整文件
   * 2. 保存到磁盘
   * 3. 移除二进制帧回调
   * 4. 返回文件元数据
   */
  private async handleUploadComplete(message: WSMessage, conn: ClientConnection): Promise<void> {
    const payload = message.payload as FileUploadCompletePayload;
    try {
      const { data, fileName, mimeType } = this.fileTransfer.completeUpload(payload.uploadId);
      const meta = await this.fileManager.save(fileName, data, mimeType);

      // 清理
      this.activeUploads.delete(payload.uploadId);
      this.wsServer.removeBinaryHandler(conn.id);

      this.connManager.send(
        conn,
        serialize(MSG.FILE_UPLOAD_DONE, {
          fileId: meta.id,
          fileName: meta.fileName,
          filePath: meta.filePath,
          fileSize: meta.fileSize,
        }, message.id),
      );
    } catch (err) {
      const msg = err instanceof PluginError ? err.message : String(err);
      this.connManager.send(conn, serializeError(ErrorCode.UPLOAD_FAILED, msg, message.id));
    }
  }

  /**
   * 处理文件下载请求：
   * 1. 读取文件数据
   * 2. 发送 download.start 消息
   * 3. 分块发送二进制帧
   * 4. 发送 download.done 消息
   */
  private async handleDownload(message: WSMessage, conn: ClientConnection): Promise<void> {
    const payload = message.payload as FileDownloadPayload;
    try {
      const { data, meta } = await this.fileManager.read(payload.fileId);

      // 发送下载开始通知
      this.connManager.send(
        conn,
        serialize(MSG.FILE_DOWNLOAD_START, {
          fileId: meta.id,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          mimeType: meta.mimeType,
        }, message.id),
      );

      // 分块发送文件数据
      const totalChunks = this.fileTransfer.sendChunks(
        data,
        (chunk) => this.connManager.sendBinary(conn, chunk),
      );

      // 发送下载完成通知
      this.connManager.send(
        conn,
        serialize(MSG.FILE_DOWNLOAD_DONE, {
          fileId: meta.id,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          totalChunks,
        }, message.id),
      );
      log.info(`下载完成: fileId=${meta.id}, chunks=${totalChunks}`);
    } catch (err) {
      const msg = err instanceof PluginError ? err.message : String(err);
      this.connManager.send(conn, serializeError(ErrorCode.DOWNLOAD_FAILED, msg, message.id));
    }
  }

  /**
   * 处理文件格式转换请求：
   * 1. 获取源文件元数据
   * 2. 调用 FileConverter 通过 AI Agent 完成转换
   * 3. 返回转换后的文件元数据
   */
  private async handleConvert(message: WSMessage, conn: ClientConnection): Promise<void> {
    const payload = message.payload as FileConvertPayload;
    try {
      const sourceMeta = this.fileManager.getMeta(payload.fileId);
      if (!sourceMeta) {
        this.connManager.send(
          conn,
          serializeError(ErrorCode.FILE_NOT_FOUND, `文件 ${payload.fileId} 不存在`, message.id),
        );
        return;
      }

      const sessionKey = payload.sessionId || `convert:${conn.id}`;
      const resultMeta = await this.fileConverter.convert(sourceMeta, payload.targetFormat, sessionKey);

      this.connManager.send(
        conn,
        serialize('file.convert.done', {
          sourceFileId: payload.fileId,
          resultFileId: resultMeta.id,
          resultFileName: resultMeta.fileName,
          resultFileSize: resultMeta.fileSize,
        }, message.id),
      );
    } catch (err) {
      const msg = err instanceof PluginError ? err.message : String(err);
      this.connManager.send(conn, serializeError(ErrorCode.CONVERT_FAILED, msg, message.id));
    }
  }
}
