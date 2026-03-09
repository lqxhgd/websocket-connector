import { logger } from '../../utils/logger.js';

const log = logger.child('StreamParser');

/**
 * SSE 响应流中单个事件的结构。
 * OpenClaw Gateway 返回 OpenAI 兼容的 SSE 格式：
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 */
export interface SSEEvent {
  data: string;
  event?: string;
}

/**
 * 解析 SSE 文本流，逐事件回调。
 * 处理 "data: ..." 行，忽略注释和空行，遇到 "[DONE]" 标记结束。
 *
 * @param stream - fetch 返回的 ReadableStream<Uint8Array>
 * @param onEvent - 每解析出一个完整事件时的回调
 * @param onDone - 流结束时的回调
 */
export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 最后一个元素可能是不完整的行，保留到 buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            onDone();
            return;
          }
          onEvent({ data });
        }
      }
    }
    onDone();
  } catch (err) {
    log.error('SSE 流解析错误:', err);
    throw err;
  } finally {
    reader.releaseLock();
  }
}

/**
 * 从 SSE event 的 data JSON 中提取增量文本内容。
 * 兼容 OpenAI 格式：data.choices[0].delta.content
 * @returns 增量文本，无内容时返回空字符串
 */
export function extractDeltaContent(eventData: string): string {
  try {
    const parsed = JSON.parse(eventData);
    return parsed?.choices?.[0]?.delta?.content || '';
  } catch {
    return '';
  }
}
