import { logger } from '../../utils/logger.js';
import { PluginError, ErrorCode } from '../../utils/errors.js';
import type { OpenClawClient } from '../gateway/OpenClawClient.js';
import type { ChatMessage, FileMetadata } from '../../types.js';
import type { FileManager } from './FileManager.js';

const log = logger.child('Converter');

/**
 * 文件格式转换服务。
 * 自身不实现转换逻辑，而是通过 OpenClaw Gateway 发送指令，
 * 让 AI Agent 完成转换（如 PDF→DOC），再从输出路径读取结果。
 */
export class FileConverter {
  constructor(
    private gateway: OpenClawClient,
    private fileManager: FileManager,
  ) {}

  /**
   * 请求文件格式转换。
   * 向 OpenClaw 发送转换指令，等待 Agent 处理完成后返回结果文件元数据。
   *
   * @param sourceMeta - 源文件的元数据（必须已保存到磁盘）
   * @param targetFormat - 目标格式，如 "docx"、"pdf"、"txt"
   * @param sessionKey - 会话标识
   * @returns 转换后的文件元数据
   */
  async convert(
    sourceMeta: FileMetadata,
    targetFormat: string,
    sessionKey: string,
  ): Promise<FileMetadata> {
    log.info(`转换请求: ${sourceMeta.fileName} → ${targetFormat}`);

    const prompt = buildConvertPrompt(sourceMeta, targetFormat);
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个文件处理助手，请按用户要求进行文件格式转换。', timestamp: Date.now() },
      { role: 'user', content: prompt, timestamp: Date.now() },
    ];

    const response = await this.gateway.chat(messages, sessionKey);
    const outputPath = extractOutputPath(response);

    if (!outputPath) {
      throw new PluginError(
        ErrorCode.CONVERT_FAILED,
        `转换失败：未能从 AI 响应中提取输出文件路径`,
      );
    }

    const resultName = replaceExtension(sourceMeta.fileName, targetFormat);
    const meta = await this.fileManager.register(outputPath, resultName);
    log.info(`转换完成: ${sourceMeta.fileName} → ${resultName}, fileId=${meta.id}`);
    return meta;
  }
}

/** 构造发给 AI Agent 的转换提示词 */
function buildConvertPrompt(meta: FileMetadata, targetFormat: string): string {
  return [
    `请将以下文件转换为 ${targetFormat} 格式：`,
    `文件路径: ${meta.filePath}`,
    `文件名: ${meta.fileName}`,
    `文件大小: ${meta.fileSize} 字节`,
    `请完成转换后，输出转换后文件的完整路径。`,
  ].join('\n');
}

/** 从 AI 响应文本中提取文件路径（匹配常见路径格式） */
function extractOutputPath(response: string): string | null {
  const patterns = [
    /(?:路径|path|输出)[：:]\s*([^\s\n]+)/i,
    /(\/[\w./-]+\.\w+)/,
    /([A-Z]:\\[\w.\\-]+\.\w+)/,
  ];
  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** 替换文件扩展名 */
function replaceExtension(fileName: string, newExt: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = newExt.startsWith('.') ? newExt : `.${newExt}`;
  return `${base}${ext}`;
}
