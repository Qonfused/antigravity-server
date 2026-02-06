# Antigravity Server

OpenAI-compatible proxy server for Google Antigravity (Code Assist) API.

[Overview](#overview) |
[Project Structure](#project-structure) |
[API Endpoints](#api-endpoints) |
[Setup](#setup) |
[Usage](#usage) |
[License](#license)

## Overview

Antigravity Server acts as a translation layer between the OpenAI Chat Completions API and Google's internal Antigravity (Code Assist) service. This enables any tool that supports the OpenAI API (VSCode extensions, LangChain, custom scripts) to use Gemini and Claude models available through Antigravity.

**Key Features:**
- **OpenAI-compatible:** Drop-in replacement for OpenAI SDK with `base_url` override
- **Streaming support:** Full SSE streaming for real-time responses
- **Tool/Function calling:** Transforms OpenAI tool schemas to Antigravity format
- **Thinking models:** Automatic thinking configuration for Gemini 3, Gemini 2.5, and Claude Opus
- **Soft quota protection:** Blocks requests at 90% quota to prevent rate limit penalties
- **Multi-model support:** Access Gemini 2.5, Gemini 3, Claude Sonnet 4.5, and Claude Opus 4.5

## Project Structure

```sh
.
├── src/
│   ├── server.ts             # HTTP server entry point (Hono framework)
│   ├── constants.ts          # API endpoints, OAuth credentials, headers
│   ├── types.ts              # Shared TypeScript types
│   │
│   ├── auth/                 # Authentication
│   │   ├── oauth.ts          # PKCE OAuth flow for Google
│   │   ├── token.ts          # Token refresh logic
│   │   └── storage.ts        # Credential storage (~/.config/antigravity-server/)
│   │
│   ├── api/                  # Antigravity API client
│   │   ├── client.ts         # Request handling with endpoint fallback
│   │   ├── quota.ts          # Quota fetching and display
│   │   └── quota-protection.ts # Soft quota enforcement
│   │
│   ├── routes/               # HTTP routes
│   │   ├── chat.ts           # POST /v1/chat/completions
│   │   ├── models.ts         # GET /v1/models
│   │   ├── quota.ts          # GET /v1/quota
│   │   └── tools.ts          # POST /v1/tools/{search,analyze-url}
│   │
│   ├── transform/            # Request/Response transformation
│   │   ├── openai-to-gemini.ts  # OpenAI → Antigravity request
│   │   ├── gemini-to-openai.ts  # Antigravity → OpenAI response
│   │   ├── streaming.ts         # SSE parsing and transformation
│   │   ├── schema-cleaner.ts    # JSON Schema → Gemini format
│   │   └── types.ts             # OpenAI/Antigravity type definitions
│   │
│   ├── tools/                # Built-in tools
│   │   ├── google-search.ts  # Google Search grounding
│   │   └── url-context.ts    # URL content fetching
│   │
│   └── cli/                  # CLI commands
│       ├── auth.ts           # bun run auth
│       └── quota.ts          # bun run quota
│
├── .editorconfig             # Editor settings (2-space indent)
├── .prettierrc               # Code formatting rules
├── package.json
└── tsconfig.json
```

## API Endpoints

### `POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint with streaming support.

#### Request

```http
POST http://localhost:8080/v1/chat/completions
Content-Type: application/json
Authorization: Bearer dummy
```

```json
{
  "model": "gemini-3-pro",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": true,
  "max_tokens": 4096,
  "temperature": 0.7
}
```

#### Available Models

| Model ID | Description |
|----------|-------------|
| `gemini-2.5-flash` | Fast, efficient Gemini model |
| `gemini-2.5-pro` | High-capability Gemini with thinking |
| `gemini-3-flash` | Next-gen fast Gemini |
| `gemini-3-pro` | Next-gen high-capability Gemini (maps to `gemini-3-pro-high`) |
| `claude-sonnet-4.5` | Claude Sonnet 4.5 |
| `claude-opus-4.5` | Claude Opus 4.5 with thinking |

#### Response (Streaming)

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0,"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}

data: [DONE]
```

#### Error Response

```json
{
  "error": {
    "message": "Model gemini-2.5-pro is over soft quota threshold (0% remaining). Resets in 3h 21m.",
    "type": "soft_quota_protection",
    "code": "rate_limit_exceeded"
  }
}
```

---

### `GET /v1/models`

List available models in OpenAI format.

#### Response

```json
{
  "object": "list",
  "data": [
    {"id": "gemini-3-pro", "object": "model", "created": 1738732800, "owned_by": "google"},
    {"id": "claude-sonnet-4.5-20250514", "object": "model", "created": 1738732800, "owned_by": "anthropic"}
  ]
}
```

---

### `GET /v1/quota`

Get quota information for all models.

#### Response

```json
{
  "models": [
    {"modelId": "gemini-3-pro", "displayName": "Gemini 3 Pro", "remainingFraction": 0.8, "resetTime": "1h 22m"},
    {"modelId": "gemini-2.5-pro", "displayName": "Gemini 2.5 Pro", "remainingFraction": 0, "resetTime": "3h 21m"}
  ]
}
```

---

### `GET /health`

Health check endpoint.

#### Response

```json
{"status": "healthy"}
```

## Setup

### Prerequisites

**Bun** (recommended) or Node.js 20+ is required.

<details>
<summary><strong>Install Bun</strong></summary>

```bash
# Linux/macOS
curl -fsSL https://bun.sh/install | bash

# Windows (via PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

</details>

<details>
<summary><strong>Install Node.js (alternative)</strong></summary>

If you prefer Node.js, use [fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm):

```bash
fnm install 20
fnm use 20
```

Then use `npm` instead of `bun` for all commands below.

</details>

### Clone and Install

```bash
git clone https://github.com/videre-project/antigravity-server.git
cd antigravity-server
bun install
```

### Authenticate with Google

Antigravity Server uses Google OAuth to authenticate with the Antigravity API. You must have access to Google Code Assist (Gemini for Google Cloud) through your Google account.

```bash
bun run auth
```

This will:
1. Start a local callback server on port 51121
2. Open your browser to Google's OAuth consent screen
3. After you authorize, save tokens to `~/.config/antigravity-server/tokens.json`

> [!NOTE]
> Tokens automatically refresh when expired. You only need to re-authenticate if you revoke access or tokens become invalid.

#### Auth Subcommands

```bash
bun run auth           # Login (default)
bun run auth status    # Show current token status
bun run auth refresh   # Force token refresh
bun run auth logout    # Clear stored tokens
```

### Verify Access

Check your quota to verify authentication is working:

```bash
bun run quota
```

Example output:

```
📧 Account: user@example.com
📁 Project: cloud-code-assist-project

📊 Model Quota
────────────────────────────────────────
Gemini 3 Pro          ████████░░  80%   (resets in 1h 22m)
Gemini 2.5 Pro        ██████████ 100%
Gemini 2.5 Flash      ██████████ 100%
Claude Sonnet 4.5     ██████████ 100%
────────────────────────────────────────
```

### Start the Server

```bash
# Development mode (hot reload)
bun run dev

# Production mode
bun run serve
```

The server starts on `http://localhost:8080` by default.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `HOST` | `0.0.0.0` | Bind address |

Example:

```bash
PORT=3000 bun run serve
```

---

## Usage

Once the server is running, configure your client to use `http://localhost:8080/v1` as the base URL with any dummy API key (authentication is handled via OAuth tokens).

### Quick Test

```bash
curl http://localhost:8080/v1/models
```

If successful, you'll see a list of available models.

### OpenAI Python SDK

```bash
pip install openai
```

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="dummy"  # Not validated; auth via OAuth tokens
)

# Non-streaming
response = client.chat.completions.create(
    model="gemini-3-pro",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain quantum computing in simple terms."}
    ]
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gemini-3-pro",
    messages=[{"role": "user", "content": "Write a haiku about coding."}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

### OpenAI Node.js SDK

```bash
npm install openai
```

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8080/v1",
  apiKey: "dummy",
});

// Non-streaming
const response = await client.chat.completions.create({
  model: "gemini-3-pro",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: "gemini-3-pro",
  messages: [{ role: "user", content: "Tell me a joke." }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

### Tool/Function Calling

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8080/v1", api_key="dummy")

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
                },
                "required": ["location"]
            }
        }
    }
]

response = client.chat.completions.create(
    model="gemini-3-pro",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=tools,
    tool_choice="auto"
)

# Handle tool calls
if response.choices[0].message.tool_calls:
    for call in response.choices[0].message.tool_calls:
        print(f"Tool: {call.function.name}")
        print(f"Args: {call.function.arguments}")
```

### Continue (VSCode Extension)

[Continue](https://continue.dev) is an open-source AI coding assistant. Add to `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "Antigravity (Gemini 3 Pro)",
      "provider": "openai",
      "model": "gemini-3-pro",
      "apiBase": "http://localhost:8080/v1",
      "apiKey": "dummy"
    },
    {
      "title": "Antigravity (Claude Sonnet)",
      "provider": "openai",
      "model": "claude-sonnet-4.5",
      "apiBase": "http://localhost:8080/v1",
      "apiKey": "dummy"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Antigravity (Flash)",
    "provider": "openai",
    "model": "gemini-2.5-flash",
    "apiBase": "http://localhost:8080/v1",
    "apiKey": "dummy"
  }
}
```

### cURL Examples

**Simple completion:**

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-pro",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**Streaming:**

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-pro",
    "messages": [{"role": "user", "content": "Count to 10"}],
    "stream": true
  }'
```

**Check quota:**

```bash
curl http://localhost:8080/v1/quota
```

---

## Maintenance

### Updating Constants

Antigravity Server relies on internal constants (Client ID, Secret, API Version, Endpoints) extracted from the official Antigravity binary. If the official client updates and the server stops working, you can update these constants automatically:

```bash
bun run update-constants
```

This script will:
1. Fetch the latest Antigravity version info.
2. Download the corresponding binary.
3. Extract `main.js` and scan for updated constants.
4. Update `src/constants.ts` with any changes (including API version `v1internal` etc.).

It is recommended to run this script if you encounter authentication errors or if Google pushes a breaking change to the internal API.

---

## Troubleshooting

### Authentication

**Token refresh fails or "Not authenticated" error:**
- Re-authenticate with `bun run auth`
- Check that your Google account has access to Google Code Assist
- Verify tokens exist at `~/.config/antigravity-server/tokens.json`

**OAuth callback never completes:**
- Ensure port 51121 is not blocked by a firewall
- Try manually opening the authorization URL printed in the terminal
- If port 51121 is in use, kill the existing process: `lsof -i :51121 | awk 'NR>1 {print $2}' | xargs kill`

### Quota & Rate Limits

**"Model is over soft quota threshold" (HTTP 429):**

This is intentional. The server blocks requests at 90% quota usage to prevent hitting 0%, which can trigger stricter rate limits from Google. Options:
- Wait for quota reset (check `bun run quota` for reset time)
- Switch to a different model with available quota
- Adjust the threshold in `src/constants.ts` (not recommended)

**All models show 0% quota:**

Quota resets on a rolling window (typically 1-4 hours). If all models are exhausted:
- Wait for the reset period shown in `bun run quota`
- Check if your account has usage restrictions

### API Compatibility

**Tool calls return unexpected format:**

The server transforms OpenAI tool schemas to Antigravity's format. Some complex schemas may not translate perfectly:
- Avoid deeply nested `$ref` definitions
- Use simple `object` types with explicit `properties`
- Check server logs for schema transformation warnings

**Streaming chunks are malformed:**

Some clients expect specific chunk formatting. Ensure your client handles:
- Empty `content` fields (normal during tool calls)
- `finish_reason: "tool_calls"` instead of `"stop"`


## License

This project is licensed under the Apache-2.0 License. See the [LICENSE](/LICENSE) file for more details.
