# swirlock-model-bare-host

Barebone local model host for Swirlock agents.

This server exposes a minimal streaming API for a locally running Ollama model. It is intentionally small and does not manage agent context, tools, files, memory, planning, or repository analysis.

The first target use case is a VS Code coding agent that communicates with a local `qwen2.5-coder:14b` model through this host.

## Responsibilities

This server only does the following:

- starts a local HTTP server
- exposes a browser test page
- accepts chat messages through `POST /api/chat`
- forwards the messages to Ollama
- streams the model response back to the caller

The agent is responsible for:

- reading files
- managing context
- deciding what to send to the model
- handling tool calls
- editing code
- storing conversation state

## Requirements

- Node.js
- npm
- Ollama
- `qwen2.5-coder:14b` pulled locally

Install the Ollama model:

```powershell
ollama pull qwen2.5-coder:14b


Priority    -> kept in UI, sent to server, but ignored by the bare host
Temperature -> passed to Ollama
Format      -> text/json, passed to Ollama
Thinking    -> supported only if Ollama/model emits thinking
Images      -> UI kept; works only with vision-capable models, not qwen2.5-coder:14b
Status bar  -> restored through GET /api/status


## Connecting from another local app

Any app running on the same computer can connect to this server through `http://localhost:3214` or `http://127.0.0.1:3214`.

The main streaming endpoint is `POST /api/chat`.

Full URL:

`http://localhost:3214/api/chat`

The request body must contain a `messages` array using the usual chat format: `system`, `user`, and `assistant` messages.

Example request shape:

`{ "messages": [{ "role": "user", "content": "Write a TypeScript function that adds two numbers." }] }`

Optional settings can be sent through the `options` object. The browser test page currently sends `responseFormat` and `temperature`.

Example optional settings shape:

`{ "options": { "responseFormat": "text", "ollama": { "temperature": 0.2 } } }`

The response is streamed as SSE-style HTTP chunks. Each event starts with `data:` and contains a JSON object.

The server may send these event types:

`started` means the request reached the model host.

`chunk` contains generated text. The consuming app should append `data.text` to the current assistant response.

`thinking` contains thinking text if the model and Ollama response expose it.

`done` means the model finished responding.

`error` means the request failed after streaming had already started.

Example streamed response shape:

`data: {"type":"started","data":{"modelId":"qwen2.5-coder:14b"}}`

`data: {"type":"chunk","data":{"text":"function add"}}`

`data: {"type":"done","data":{"finishReason":"stop"}}`

A consuming app should read the HTTP response body as a stream, split events by blank lines, parse the `data:` lines as JSON, and append text from `chunk` events.

The model status endpoint is `GET /api/status`.

Full URL:

`http://localhost:3214/api/status`

It returns information about the configured Ollama model and whether it is currently loaded.

This server is intended for local same-machine access. The VS Code extension agent should call `http://localhost:3214/api/chat` directly.