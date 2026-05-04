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