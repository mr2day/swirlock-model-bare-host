import { readFile } from 'node:fs/promises';
import http from 'node:http';
import ollama from 'ollama';

const PORT = 3214;
const MODEL = 'qwen2.5-coder:14b';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatRequestBody = {
  messages: ChatMessage[];
};

const readRequestBody = async (request: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8');
};

const sendJson = (
  response: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });

  response.end(JSON.stringify(body));
};

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    try {
      const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf-8');

      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
      });

      response.end(html);
    } catch {
      sendJson(response, 500, { error: 'Could not load test page.' });
    }

    return;
  }

  if (request.method === 'POST' && request.url === '/api/chat') {
    try {
      const rawBody = await readRequestBody(request);
      const body = JSON.parse(rawBody) as ChatRequestBody;

      if (!Array.isArray(body.messages)) {
        sendJson(response, 400, { error: 'Request body must contain a messages array.' });
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const stream = await ollama.chat({
        model: MODEL,
        messages: body.messages,
        stream: true,
        keep_alive: -1,
      });

      for await (const part of stream) {
        const content = part.message?.content ?? '';

        if (content) {
          response.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      response.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      response.end();
    } catch (error) {
      console.error(error);

      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Model request failed.' });
        return;
      }

      response.write(`data: ${JSON.stringify({ error: 'Model request failed.' })}\n\n`);
      response.end();
    }

    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
});

server.listen(PORT, () => {
  console.log(`swirlock-model-bare-host running on http://localhost:${PORT}`);
});