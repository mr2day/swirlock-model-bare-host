import { readFile } from 'node:fs/promises';
import http from 'node:http';
import ollama, { type ChatRequest, type Message } from 'ollama';
import { DEFAULT_MODEL_ID, getModelConfig, MODEL_CONFIGS, type ModelConfig } from './model-config.js';

const PORT = 3214;
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

let currentModelId = DEFAULT_MODEL_ID;
let modelSwitchInProgress = false;

type ChatRole = 'system' | 'user' | 'assistant';

type BrowserChatMessage = {
  role: ChatRole;
  content: string;
  images?: string[];
};

type ChatRequestBody = {
  messages: BrowserChatMessage[];
  options?: {
    responseFormat?: 'text' | 'json';
    thinking?: boolean;
    ollama?: {
      temperature?: number;
    };
  };
};

type SelectModelRequestBody = {
  modelId?: string;
};

type OllamaRunningModel = {
  name?: string;
  model?: string;
  size?: number;
  size_vram?: number;
  expires_at?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
};

type OllamaPsResponse = {
  models?: OllamaRunningModel[];
};

type OllamaStreamPart = {
  message?: {
    content?: string;
    thinking?: string;
  };
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

const sendSse = (response: http.ServerResponse, body: unknown): void => {
  response.write(`data: ${JSON.stringify(body)}\n\n`);
};

const normalizeBase64Image = (dataUrl: string): string => {
  const marker = 'base64,';
  const markerIndex = dataUrl.indexOf(marker);

  if (markerIndex === -1) {
    return dataUrl;
  }

  return dataUrl.slice(markerIndex + marker.length);
};

const getSelectedModelConfig = (): ModelConfig => {
  const selectedModelConfig = getModelConfig(currentModelId);
  const defaultModelConfig = getModelConfig(DEFAULT_MODEL_ID);

  if (selectedModelConfig) {
    return selectedModelConfig;
  }

  if (!defaultModelConfig) {
    throw new Error('Default model config is missing.');
  }

  return defaultModelConfig;
};

const unloadModel = async (modelId: string): Promise<void> => {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      prompt: '',
      stream: false,
      keep_alive: 0,
    }),
  });

  await response.text();
};

const preloadModel = async (modelId: string): Promise<void> => {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      prompt: '',
      stream: false,
      keep_alive: -1,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Could not load model ${modelId}. ${responseText}`);
  }
};

const getModelStatus = async (): Promise<{
  selectedModelId: string;
  selectedModel: ModelConfig;
  availableModels: ModelConfig[];
  loaded: boolean;
  ready: boolean;
  switching: boolean;
  loadedModels: OllamaRunningModel[];
  activeModel?: OllamaRunningModel;
}> => {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/ps`);

  if (!response.ok) {
    throw new Error(`Ollama status failed with status ${response.status}`);
  }

  const payload = (await response.json()) as OllamaPsResponse;
  const loadedModels = payload.models ?? [];
  const selectedModel = getSelectedModelConfig();

  const activeModel = loadedModels.find((model) => {
    return model.name === currentModelId || model.model === currentModelId;
  });

  return {
    selectedModelId: currentModelId,
    selectedModel,
    availableModels: MODEL_CONFIGS,
    loaded: Boolean(activeModel),
    ready: true,
    switching: modelSwitchInProgress,
    loadedModels,
    ...(activeModel ? { activeModel } : {}),
  };
};

const buildOllamaMessages = (
  messages: BrowserChatMessage[],
  selectedModel: ModelConfig,
): Message[] => {
  return messages.map((message) => {
    const ollamaMessage: Message = {
      role: message.role,
      content: message.content,
    };

    if (selectedModel.capabilities.images && message.images && message.images.length > 0) {
      ollamaMessage.images = message.images.map(normalizeBase64Image);
    }

    return ollamaMessage;
  });
};

const buildOllamaOptions = (
  body: ChatRequestBody,
): {
  temperature?: number;
} => {
  const ollamaOptions: {
    temperature?: number;
  } = {};

  const temperature = body.options?.ollama?.temperature;

  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    ollamaOptions.temperature = temperature;
  }

  return ollamaOptions;
};

const createOllamaChatRequest = (
  body: ChatRequestBody,
  selectedModel: ModelConfig,
): ChatRequest & { stream: true } => {
  const ollamaMessages = buildOllamaMessages(body.messages, selectedModel);
  const ollamaOptions = buildOllamaOptions(body);

  const chatRequest: ChatRequest & { stream: true } = {
    model: selectedModel.id,
    messages: ollamaMessages,
    stream: true,
    keep_alive: -1,
  };

  if (selectedModel.capabilities.thinking && body.options?.thinking) {
    chatRequest.think = true;
  }

  if (body.options?.responseFormat === 'json') {
    chatRequest.format = 'json';
  }

  if (Object.keys(ollamaOptions).length > 0) {
    chatRequest.options = ollamaOptions;
  }

  return chatRequest;
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

  if (request.method === 'GET' && request.url === '/api/status') {
    try {
      sendJson(response, 200, {
        data: await getModelStatus(),
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Status unavailable.',
      });
    }

    return;
  }

  if (request.method === 'POST' && request.url === '/api/model/select') {
    if (modelSwitchInProgress) {
      sendJson(response, 409, { error: 'A model switch is already in progress.' });
      return;
    }

    try {
      const rawBody = await readRequestBody(request);
      const body = JSON.parse(rawBody) as SelectModelRequestBody;

      if (!body.modelId) {
        sendJson(response, 400, { error: 'Request body must contain modelId.' });
        return;
      }

      const selectedModel = getModelConfig(body.modelId);

      if (!selectedModel) {
        sendJson(response, 400, { error: `Unknown model: ${body.modelId}` });
        return;
      }

      const previousModelId = currentModelId;

      if (previousModelId !== selectedModel.id) {
        modelSwitchInProgress = true;

        await preloadModel(selectedModel.id);

        currentModelId = selectedModel.id;

        unloadModel(previousModelId).catch((error) => {
          console.warn(`Could not unload previous model ${previousModelId}:`, error);
        });
      }

      sendJson(response, 200, {
        data: await getModelStatus(),
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Could not switch model.',
      });
    } finally {
      modelSwitchInProgress = false;
    }

    return;
  }

  if (request.method === 'POST' && request.url === '/api/chat') {
    if (modelSwitchInProgress) {
      sendJson(response, 409, { error: 'Model switch in progress.' });
      return;
    }

    try {
      const rawBody = await readRequestBody(request);
      const body = JSON.parse(rawBody) as ChatRequestBody;

      if (!Array.isArray(body.messages)) {
        sendJson(response, 400, { error: 'Request body must contain a messages array.' });
        return;
      }

      const selectedModel = getSelectedModelConfig();

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      sendSse(response, {
        type: 'started',
        data: {
          modelId: selectedModel.id,
          capabilities: selectedModel.capabilities,
        },
      });

      const chatRequest = createOllamaChatRequest(body, selectedModel);
      const stream = await ollama.chat(chatRequest);

      for await (const part of stream) {
        const streamPart = part as OllamaStreamPart;
        const thinking = streamPart.message?.thinking ?? '';
        const content = streamPart.message?.content ?? '';

        if (thinking) {
          sendSse(response, {
            type: 'thinking',
            data: {
              text: thinking,
            },
          });
        }

        if (content) {
          sendSse(response, {
            type: 'chunk',
            data: {
              text: content,
            },
          });
        }
      }

      sendSse(response, {
        type: 'done',
        data: {
          finishReason: 'stop',
        },
      });

      response.end();
    } catch (error) {
      console.error(error);

      const message = error instanceof Error ? error.message : 'Model request failed.';

      if (!response.headersSent) {
        sendJson(response, 500, { error: message });
        return;
      }

      sendSse(response, {
        type: 'error',
        error: {
          message,
        },
      });

      response.end();
    }

    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
});

server.listen(PORT, () => {
  console.log(`swirlock-model-bare-host running on http://localhost:${PORT}`);
});