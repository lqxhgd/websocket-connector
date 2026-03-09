import { config } from '../../config.js';
import { parseSSEStream, extractDeltaContent } from './StreamParser.js';
import { gatewayError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { IGatewayClient, ChatMessage } from '../../types.js';

const log = logger.child('Gateway');

/**
 * OpenClaw Gateway HTTP 客户端。
 * 封装与 OpenClaw Gateway 的 /v1/chat/completions 通信，
 * 支持流式（SSE）和非流式两种模式。
 */
export class OpenClawClient implements IGatewayClient {
  /**
   * 发送流式对话请求。
   * 通过 HTTP SSE 逐块获取 AI 回复，每收到一个 chunk 调用 onChunk，
   * 全部完成后调用 onDone 传入完整内容，出错时调用 onError。
   *
   * @param messages - 对话消息列表（含历史上下文）
   * @param sessionKey - 会话标识，Gateway 用于维持多轮对话
   * @param onChunk - 每收到一个增量文本片段时的回调
   * @param onDone - 流式响应完成时的回调，参数为拼接后的完整内容
   * @param onError - 出错时的回调
   */
  async streamChat(
    messages: ChatMessage[],
    sessionKey: string,
    onChunk: (chunk: string) => void,
    onDone: (fullContent: string) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    try {
      const response = await this.doRequest(messages, sessionKey, true);
      if (!response.body) throw gatewayError('Gateway 响应无 body');

      let fullContent = '';
      await parseSSEStream(
        response.body,
        (event) => {
          const text = extractDeltaContent(event.data);
          if (text) {
            fullContent += text;
            onChunk(text);
          }
        },
        () => onDone(fullContent),
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('流式请求失败:', error.message);
      onError(error);
    }
  }

  /**
   * 发送非流式对话请求，等待完整响应后一次性返回。
   * 适用于不需要流式展示的场景（如任务处理）。
   */
  async chat(messages: ChatMessage[], sessionKey: string): Promise<string> {
    const response = await this.doRequest(messages, sessionKey, false);
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * 向 Gateway 发送 HTTP 请求的底层方法。
   * 构造 OpenAI 兼容的请求格式，携带认证头和会话标识。
   */
  private async doRequest(
    messages: ChatMessage[],
    sessionKey: string,
    stream: boolean,
  ): Promise<Response> {
    const url = `${config.gatewayUrl}/v1/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const auth = config.gatewayAuth;
    if (auth) {
      headers['Authorization'] = `Bearer ${auth}`;
    }
    headers['X-OpenClaw-Agent-Id'] = 'websocket-connector';

    const body = JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
      user: sessionKey,
    });

    log.debug(`请求 Gateway: stream=${stream}, messages=${messages.length}`);

    const response = await fetch(url, { method: 'POST', headers, body });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw gatewayError(`Gateway 返回 ${response.status}: ${text}`);
    }
    return response;
  }
}
