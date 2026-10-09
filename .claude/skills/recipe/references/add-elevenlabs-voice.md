# Recipe: Add ElevenLabs Voice Agent

Add a conversational AI voice interface to an AppyStack app using ElevenLabs Conversational AI. The voice agent connects **directly from the browser to ElevenLabs via WebRTC** — your AppyStack server provides only a single token endpoint. Socket.io plays no role in voice communication.

---

## Architecture — Read This First

This is the most important thing to understand before writing any code:

```
Browser <──── WebRTC ────> ElevenLabs Cloud
   |
   |  (client tools — browser JS functions)
   |
   +── fetch -> Your AppyStack server (localhost:PORT/api/...)
   +── fetch -> Any other localhost API
```

**Your server's only job:**
```
POST /api/voice/token  ->  calls ElevenLabs API  ->  returns a short-lived WebRTC token
```

**Socket.io is not involved.** The ElevenLabs WebRTC connection is a completely separate channel from your app's Socket.io. Do not route audio or voice events through Socket.io — it adds failure points and fights the SDK.

**Client tools** are plain async browser functions that `fetch()` your APIs. They are registered when the session starts and called by the ElevenLabs agent during conversation. They run entirely in the browser.

---

## Recipe Anatomy

**Intent**
Add voice conversation to an existing AppyStack app with minimal server changes. The agent can query your app's data via client tools you define.

**Type**: Additive. Safe to apply to any AppyStack app. Does not touch existing routes, Socket.io, or shared types.

**Stack Assumptions**
- AppyStack RVETS template (Express 5, TypeScript, React 19)
- An ElevenLabs account with a configured Conversational AI agent
- Microphone access available in the browser

**Idempotency Check**
Does `server/src/routes/voice.ts` exist? If yes, token endpoint already installed.
Does `client/src/hooks/useVoiceAgent.ts` exist? If yes, hook already installed.

**Does Not Touch**
- `server/src/index.ts` Socket.io setup
- `shared/src/types.ts` (no shared types needed for voice)
- Any existing routes or socket handlers
- The AppyStack Socket.io singleton

**Composes With**
- Any data recipe — client tools can call any of your app's APIs
- `nav-shell` — add a Voice tab to the sidebar

---

## Step 0: ElevenLabs Dashboard Setup (Do This Before Writing Code)

Configuration mistakes cause silent disconnections that look like code bugs. Set these up first, verify once, then touch the codebase.

**In your ElevenLabs agent settings:**

1. **Security tab -> Allowlist** — add your client URL, e.g. `http://localhost:5500`. Without this the browser connection is rejected. For production add your domain.

2. **Security tab -> Overrides** — enable "First message" and "System prompt" overrides. Without this the agent may connect and then immediately disconnect with a generic "interruption" message. This is the single most common cause of unexplained disconnections.

3. **Tools tab** — for each client tool you register, mark it as **blocking** (the agent waits for the result before speaking). If not blocking, the agent speaks before the data arrives.

4. **Call History** — after any test connection, check here for specific error messages. The browser console shows generic disconnect events; the dashboard shows the actual reason.

**Environment variables you need:**
```bash
ELEVENLABS_API_KEY=sk_...         # 64 chars, starts with sk_
ELEVENLABS_AGENT_ID=agent_...     # from your agent's Settings page
```

---

## Step 1: Install Dependencies

**Server workspace:** `@elevenlabs/elevenlabs-js`

**Client workspace:** `@elevenlabs/react` — always install `@latest` explicitly. The ElevenLabs SDK moves fast — v0.12.2 fixed a WebSocket race condition, v0.14.0 reduced audio latency from 250ms to 100ms. A pinned old version misses months of stability fixes.

---

## Step 2: Environment

Add `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` to `server/.env`, `server/.env.example`, and the Zod schema in `server/src/config/env.ts`.

**Validation rules:**
- `ELEVENLABS_API_KEY` — 64 characters, starts with `sk_`. Validate this in the Zod schema with a `.refine()`.
- `ELEVENLABS_AGENT_ID` — non-empty string.

**Use `dotenv.config({ override: true })`** in your env loader. Without `override: true`, dotenv silently keeps a previously-set shell variable and you get a clipped or wrong key, which produces a 401 from ElevenLabs with no obvious cause.

---

## Step 3: Server — Token Endpoint

**Contract:**

| | |
|---|---|
| **File** | `server/src/routes/voice.ts` |
| **Method** | `POST /api/voice/token` |
| **Purpose** | Fetch a short-lived WebRTC token from ElevenLabs so the browser can connect directly. The API key never leaves the server. |
| **Upstream API** | `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id={AGENT_ID}` with header `xi-api-key` |
| **Success response** | `{ token: string }` |
| **Error response** | `500 { error: "Failed to generate voice token" }` — log the upstream error server-side |
| **Env vars used** | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` |

Mount this router at `/api/voice` in `server/src/index.ts`.

**Endpoint note:** The correct ElevenLabs endpoint is `GET /v1/convai/conversation/token?agent_id=...`, not a POST to `/get_signed_url`. Earlier docs showed a different endpoint — the token endpoint above is current.

---

## Step 4: Client Tools

Client tools are browser functions the ElevenLabs agent calls during conversation. Define them in a dedicated file (e.g. `client/src/voice/clientTools.ts`).

**Contract:**

| Property | Rule |
|---|---|
| **Shape** | An object where each key is a tool name and each value is an async function |
| **Return type** | Every tool must return `Promise<string>` — use `JSON.stringify()` on your data |
| **Parameters** | Each tool receives a params object matching its dashboard configuration |
| **Registration** | Pass the tools object to `startSession()` — they are registered at session start |
| **Dashboard match** | Tool names must exactly match what you configure in the ElevenLabs dashboard |

**Tool design rules:**
- Return `JSON.stringify(result)` not raw objects. The SDK expects strings.
- Keep results concise — the agent reads them aloud. Don't return large arrays.
- Mark each tool as **blocking** in the dashboard or the agent speaks before data arrives.

---

## Step 5: Client Hook — Voice Agent State Machine

Create a hook (e.g. `client/src/hooks/useVoiceAgent.ts`) that wraps the `useConversation` hook from `@elevenlabs/react`.

**States:**

| State | Meaning | Transitions to |
|---|---|---|
| `idle` | Initial state, page just loaded | `connecting` (on start) |
| `connecting` | Requesting mic + fetching token + starting session | `connected` (success) or `error` (failure) |
| `connected` | WebRTC session established | `listening`, `speaking`, `disconnected` |
| `listening` | Agent is listening to user speech | `speaking`, `disconnected` |
| `speaking` | Agent is speaking a response | `listening`, `disconnected` |
| `disconnected` | Session ended normally | `connecting` (on restart) |
| `error` | Something failed — stores error message | `connecting` (on retry) |

**What the hook exposes:**

| Return value | Type | Purpose |
|---|---|---|
| `status` | The state machine value above | Drive UI state |
| `messages` | Array of `{ id, text, role: 'user' \| 'agent' }` | Display conversation transcript |
| `error` | `string \| null` | Show error messages |
| `start()` | async function | Request mic (with echo cancellation + noise suppression), fetch token from your server, start WebRTC session |
| `stop()` | async function | End session, return to idle |

**Start sequence** (order matters):
1. Set status to `connecting`, clear previous errors and messages
2. Request microphone with `echoCancellation`, `noiseSuppression`, `autoGainControl`
3. POST to `/api/voice/token` to get the WebRTC token
4. Call `conversation.startSession()` with `conversationToken`, `connectionType: 'webrtc'`, and `clientTools`

**SDK callbacks to handle:** `onConnect`, `onDisconnect`, `onMessage`, `onModeChange` (speaking/listening), `onError`.

---

## Step 6: Voice UI Component

Create a component (e.g. `client/src/components/VoiceAgent.tsx`) that consumes the voice agent hook.

**Capabilities:**

| Element | Behavior |
|---|---|
| **Status display** | Shows current state from the hook |
| **Error display** | Visible only when error is non-null |
| **Start button** | Disabled when `connecting`, `connected`, `listening`, or `speaking`. Enabled when `idle`, `disconnected`, or `error`. Label changes to "Connecting..." during `connecting` state. |
| **Stop button** | Disabled when not in an active session. Enabled when `connected`, `listening`, or `speaking`. |
| **Message list** | Renders each message with role label (user vs agent) |

**Button state rule:** Start must NOT be disabled on `idle` — that is the default state on page load.

---

## Files Created by This Recipe

```
project-root/
+-- server/src/routes/
|   +-- voice.ts              <- token endpoint (mount in index.ts)
+-- client/src/
    +-- voice/
    |   +-- clientTools.ts    <- browser tool functions
    +-- hooks/
    |   +-- useVoiceAgent.ts  <- conversation state + session management
    +-- components/
        +-- VoiceAgent.tsx    <- UI (replace with your design)
```

---

## Anti-Patterns (From Real Production Experience)

**Never relay audio through Socket.io.**
The WebRTC connection handles audio directly. Routing voice through your app's Socket.io adds complexity, failure points, and disables the SDK's built-in echo cancellation. This was the central mistake in the FliVoice build.

**Never create a server-side Conversation instance.**
The server fetches a token only. The browser drives the entire conversation via WebRTC. Do not use `ElevenLabsClient.conversationalAI.createConversation()` for browser-based apps.

**Never use shell aliases inside exec() for server-side tool calls.**
Aliases don't exist in child processes. Use absolute paths.

**Always use `connectionType: 'webrtc'`.**
Without this, echo cancellation is disabled and the agent hears itself speak.

**Always return `JSON.stringify()` from client tools.**
The SDK expects string return values, not objects.

**Never pin to an old SDK version.**
Always install `@elevenlabs/react@latest`. Older versions have known WebSocket race conditions.

---

## Debugging Checklist

When the agent connects then immediately disconnects:

1. **Dashboard -> Security -> Overrides** — are "First message" and "System prompt" overrides enabled? This is the #1 cause of immediate silent disconnection.
2. **Dashboard -> Tools** — is each client tool marked as **blocking**?
3. **Dashboard -> Security -> Allowlist** — is your client URL listed (e.g. `http://localhost:5500`)?
4. **Dashboard -> Call History** — check here for the actual error reason. Browser console shows generic events only.
5. **SDK version** — run `npm list @elevenlabs/react`. If below 0.12.0, upgrade.
6. **API key length** — log `ELEVENLABS_API_KEY.length` on server start. Should be 64. If shorter, dotenv is picking up a shell variable — add `override: true` to `dotenv.config()`.
7. **CORS** — is `CLIENT_URL` set correctly in server env? The token endpoint needs CORS allowed for your client origin.

---

## When to Use This Recipe

- You want users to talk to your app instead of (or alongside) clicking buttons
- You want an AI agent that can query your app's data via spoken questions
- You are building a voice-controlled dashboard, assistant, or kiosk interface
- You want to add voice to an existing AppyStack app without restructuring it

**Not appropriate for:**
- Real-time transcription only (use Whisper or ElevenLabs STT API directly)
- Push-to-talk with no AI conversation (simpler microphone + STT setup)
- Server-side speech synthesis without conversation (use ElevenLabs TTS API directly)

---

## What to Collect Before Building

1. **ElevenLabs agent ID** — from the agent's Settings page in the dashboard
2. **Client tools** — what can the agent do? List each tool: name, parameters, which API it calls
3. **Tool data shape** — what does each API return? The agent summarises it verbally, so keep results concise
4. **Voice persona** — what is the agent's name and personality? Configured in dashboard, not in code
