# Changelog

## [Unreleased] — Voicebot Quality, Latency Dashboard & Observability (2026-04-26)

### Added

- **Live Call Monitor** (`/monitor`) — real-time transcript streaming page. Agent pushes transcript updates every 2 seconds via webhook; dashboard streams them to the browser over SSE. Left panel shows active calls with green pulse; right panel shows live 🤖/👤 transcript turns.
- **Pipeline Latency Breakdown** (`/analytics`) — per-call latency table showing Dial → EOU Wait → STT → LLM TTFT → TTS TTFB with colour-coded stacked mini-bars. Hover on LLM/TTS columns shows min/max range. Campaign-level aggregate averages table appears when 2+ campaigns have data.
- **Vobiz Webhook receiver** (`/api/vobiz/webhook`) — new endpoint to receive real-time SIP events from the Vobiz trunk (ringing, answered, ended, failed). Logs full payload for debugging. Accepts GET for liveness verification.
- **`Dialer Reject` status** — SIP 486 returned in <2 seconds is now classified as a trunk-level rejection (orange badge, no retry) rather than a missed call. Error message stored: `SIP 486: Trunk rejected call before ringing`.
- **ElevenLabs, Gemini, groq-fast LLM/TTS providers** — `_build_llm()` and `_build_tts()` extended with `elevenlabs`, `google/gemini`, and `groq-fast` (llama-3.1-8b-instant) options. Auto-detect Google TTS by voice name pattern (e.g. `hi-IN-Wavenet-A`).
- **Per-campaign Voice & Tuning controls** — campaign editor exposes sliders for VAD silence duration (0.3–1.0 s), LLM temperature (0.1–0.9), max completion tokens (200–2000), and STT language dropdown (en/hi/hi-en/auto). Values embedded in LiveKit metadata at dispatch and applied by the agent at call time — no restart needed.
- **Latency instrumentation in agent** — `conversation_item_added` event collects `stt_ms`, `eou_delay_ms`, `llm_ttft_ms`, `tts_ttfb_ms` per turn. `_dial_ms` times `create_sip_participant()`. `_ttfr_ms` times first `generate_reply()`. Avg/min/max aggregated and sent in post-call webhook as `latency` field.
- **STT/TTS/LLM provider selectors in dispatch UI** — `CallDispatcher` and `BulkDialer` expose explicit per-call provider overrides independent of campaign defaults.

### Changed

- **ElevenLabs Turbo v2.5 as default TTS** (`eleven_turbo_v2_5`) — ~300 ms TTFB vs ~800 ms for multilingual. Default voice changed to Anika (`jUjRbhZWoMK4aDciW36V`).
- **LLM defaults hardened** — `max_completion_tokens=1200`, `temperature=0.6` applied across all providers (Groq, OpenAI, Gemini). Prevents runaway long responses and reduces hallucination variance.
- **STRICT SCRIPT ADHERENCE guardrail** — top-of-prompt block instructs the LLM to never invent numbers, amounts, account IDs, or steps not in the script. Combined with lower temperature, eliminates arbitrary content hallucination.
- **Greeting prompt restructured** — `INITIAL_GREETING` and `fallback_greeting` now use `"Speak ONLY this sentence — nothing else"` directive. Fixes LLM speaking instruction text (e.g. "waiting for customer response") aloud to the customer.
- **Transcript modal trigger** — clicking the outcome badge (e.g. "payment committed") opens the transcript popup; clicking elsewhere on the row does nothing. Previously the entire row was clickable.
- **`CallLog` schema extended** — added `latency: LatencyData | null`, `transcript: string | null`, and `dialer_reject` to the status union. `updateCallByRoom` accepts these fields.
- **Webhook summary handler** — now stores `transcript` (full) and `latency` object from agent post-call payload, not just `transcript_preview`.

### Fixed

- **Transcript extraction SDK compatibility** — `_get_history_items()` helper handles `session.history` and `ChatContext.items` as either properties or callable methods, fixing `'method' object is not iterable` warning on SDK 1.5.6.
- **`max_tokens` constructor error** — removed invalid `max_tokens` kwarg (not accepted by LiveKit `openai.LLM`); replaced with `max_completion_tokens` throughout.
- **Monitor page crash** — `maskPhone()` called with undefined `phone_number` on SSE connect; fixed with optional param and null guard.
- **Agent port conflict** — added `lsof -ti :8081 | xargs kill` to startup flow; clears stale worker from previous session before binding.

---

## [Unreleased] — Google Sheets Lead Source + Primary Number Verification (2026-04-24)

### Added
- **Google Sheets adapter** (`dashboard/lib/google-sheets.ts`) — bidirectional adapter using `google-auth-library` JWT + raw Sheets REST API. Reads undialed leads (Col D empty), writes `Dialing…` sentinel before dispatch, writes final disposition after call. Never touches Col A/B/C.
- **Primary Number Verification campaign** (`agent/campaigns/primary-number-verification.json`) — K2R use case: Hinglish (Sarvam Anushka + Groq), 4-disposition taxonomy (Verified / Not Verified / Callback Requested / Missed Call), 3-step retry ladder (+2 h / +6 h / +16 h), DND 21:00–09:00 IST.
- **Sheets sync cron** (`/api/campaigns/sheets-sync`) — polls sheet, writes sentinels, dispatches calls with `{{user_name}}` substitution. Secured with bearer token.
- **Unit tests** (`dashboard/tests/google-sheets.test.ts`) — 20+ Vitest tests covering E.164 normalization, DND adjustment, disposition taxonomy, sentinel/write API calls, and row-skipping logic.

### Modified
- `agent/agent.py` — `_analyze_verification_call()` with tie-breaker rules per §6.3; routes to it when `campaign_id == "primary-number-verification"`; no-transcript → Missed Call for verification calls.
- `dashboard/app/api/calls/webhook/route.ts` — writes disposition to sheet row after call; schedules DND-aware retries via BullMQ for Missed Call.
- `dashboard/app/api/dispatch/route.ts` — accepts `sheets_meta` + prompt overrides from cron.
- `dashboard/lib/call-queue.ts` — `CallJobData` carries optional `sheets_meta`; worker stores Redis key.
- `dashboard/lib/campaigns.ts` — `Campaign` interface extended with `lead_source`, `retry_ladder`, `dnd_window_ist`, `disposition_taxonomy`.
- `dashboard/app/campaigns/page.tsx` — Sheets badge on sheet-backed campaigns.
- `dashboard/components/CallDispatcher.tsx` — informational banner when selected campaign uses Sheets.
- `k8s/secrets.yaml` — added `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_DEFAULT_SHEET_ID`, `SHEETS_SYNC_CRON_SECRET` placeholders.

### Design decisions
- **`google-auth-library` only** (not `googleapis`) — mirrors `airtable.ts` raw-fetch pattern; 21 packages vs ~200.
- **Sentinel before dispatch** — simplest double-dispatch prevention without distributed locks.
- **`sheets_meta` in Redis** — keeps LiveKit metadata lean; 48 h TTL covers all 4 retry cycles.
- **Retry via existing BullMQ** — no new infrastructure; `sheets_meta` travels in job payload.

---

## v2.0.0 — Platform Upgrade (2026-04-22)

Major upgrade from a single-agent demo to a production-grade multi-campaign calling platform.

---

### Project Restructure: `agent/` + `dashboard/` Separation

**What changed:** All Python calling files moved into `agent/` directory. SIP tools moved to `agent/tools/`. Dashboard stays in `dashboard/`.

**Why:** The previous flat structure mixed calling engine code (Python) with web dashboard code (Next.js) at the root level. A bug fix in the dashboard could accidentally break the agent, and vice versa. Deployments were coupled — updating the UI meant redeploying everything.

**Benefits:**
- Independent deployment: agent and dashboard can be built, tested, and deployed separately
- Clear ownership: calling reliability is isolated from UI changes
- Safer CI/CD: a frontend CSS change cannot break an active call
- Docker builds are scoped — `agent/Dockerfile` only includes calling code

---

### Multi-Campaign System

**What changed:** Added campaign CRUD API (`/api/campaigns`), campaign editor UI (`/campaigns`), campaign JSON storage with version history, and campaign selector in both single and bulk dispatch flows.

**Why:** Every call was using the same hardcoded Anushka/XYZ Finance prompt. Running loan collection, insurance renewal, and sales calls simultaneously required switching config.py manually — impossible at scale with 10-15 campaigns.

**Benefits:**
- Run multiple campaigns simultaneously, each with its own prompt, voice, and model
- Version history tracks every prompt change with timestamps and change notes — rollback instantly
- Campaign config is embedded in LiveKit metadata at dispatch time, so in-progress calls keep their prompt even if the campaign is edited
- No agent restart needed to change campaign behavior

---

### Call State Machine + BullMQ Queue

**What changed:** Added Redis-backed call state machine (QUEUED → DIALING → RINGING → CONNECTED → COMPLETED/FAILED), BullMQ job queue with rate limiting, DND enforcement (9 PM–9 AM IST), and retry logic with exponential backoff.

**Why:** Direct dispatch has no flow control. At 3,000 concurrent calls, there's no way to rate-limit, schedule, retry failed calls, or enforce regulatory DND windows. Calls were fire-and-forget with no status tracking.

**Benefits:**
- DND compliance: calls outside 9 AM–9 PM IST are automatically delayed to the next allowed window
- Rate limiting: prevents overwhelming the SIP trunk or LLM provider
- Retry: failed calls are automatically re-queued with configurable backoff
- Real-time stats: O(1) active call counts from Redis counters instead of scanning logs
- Graceful degradation: everything works without Redis (falls back to direct dispatch)

---

### SIP Error Handling + Auto-Retry

**What changed:** Agent now parses SIP status codes from LiveKit TwirpErrors. Busy (486), no answer (480), and timeout (408) trigger automatic retry via the dashboard webhook. Declined (603) is never retried.

**Why:** A "Busy Here" error was being treated identically to a fatal failure. The customer was simply on another call — retrying in 5 minutes would likely succeed. Without this, busy numbers were permanently marked as failed.

**Benefits:**
- SIP 486 (Busy): auto-retry in 5 minutes — catches customers between calls
- SIP 480 (No Answer): auto-retry in 10 minutes — gives time for customer to become available
- SIP 408 (Timeout): auto-retry in 2 minutes — network glitch recovery
- SIP 603 (Declined): no retry — respects customer's explicit rejection
- Failed calls now show the specific SIP reason (not a generic error) in analytics

---

### Post-Call Analytics (LLM-Powered)

**What changed:** After every call, the agent extracts the conversation transcript from the session, sends it to a lightweight LLM (Llama 3.1 8B Instant), and classifies the call outcome, customer sentiment, and disposition. Results are stored alongside call logs.

**Why:** Without post-call analysis, there was no way to know what happened on a call without listening to a recording. At 3,000 calls/day, manual review is impossible. Campaign managers need aggregate outcome data to optimize prompts.

**Benefits:**
- Automatic outcome classification: payment_committed, callback_scheduled, transferred, refused, incomplete
- Customer sentiment tracking: positive, neutral, negative, frustrated
- Disposition summary: one-line human-readable call summary
- Turn count: conversation depth metric
- Uses the 8B model (100 req/min) instead of 70B (30 req/min) to avoid rate limits

---

### Voice Reliability Fixes

**What changed:** Added `ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)` before any room operations. Added `_safe_generate_reply()` with retry logic. Tuned Silero VAD for Indian telecom. Removed `close_on_disconnect=True`. Added stabilization delays before greeting.

**Why:** Three critical voice issues: (1) agent sometimes didn't speak at all after customer picked up, (2) agent dropped after the greeting, (3) agent went silent after a few conversation turns. Root causes: missing room connection, unhandled TTS/LLM failures, aggressive VAD thresholds, and premature session closure on network blips.

**Benefits:**
- `ctx.connect()` ensures audio pipeline is ready before dialing — eliminates silent calls
- Retry wrapper catches transient LLM/TTS failures instead of killing the session
- VAD tuned for Indian telecom: higher silence threshold (0.8s) prevents cutting off customers mid-pause, lower activation threshold (0.45) catches softer speech on phone networks
- Sessions survive transient network disconnects instead of terminating

---

### Enhanced Analytics Dashboard

**What changed:** New analytics page with 8 stat cards (total, dispatched, connected, completed, failed, pickup rate, completion rate, avg duration), campaign performance table, and call history with outcome/sentiment/turn count columns.

**Why:** The original dashboard only showed dispatch status. There was no way to see how campaigns were performing, which calls failed, or what the pickup rate was.

**Benefits:**
- Campaign comparison: see which campaigns have the highest success rate at a glance
- Outcome tracking: know how many calls resulted in payment commitments vs. refusals
- Auto-refresh: live data with 5-second polling
- Phone number masking: last 6 digits hidden for privacy compliance
- Copyable error messages: one-click copy for debugging SIP errors

---

### Live Activity Feed (SSE)

**What changed:** Added `/api/calls/stream` Server-Sent Events endpoint and `LiveActivity` component on the main page showing real-time call stats and recent calls.

**Why:** The main dispatch page had no visibility into what was happening after calls were dispatched. Operators had to switch to the analytics page to see results.

**Benefits:**
- Real-time visibility: see active, completed, and failed call counts without leaving the dispatch page
- SSE streaming: single persistent connection instead of polling (falls back to polling if SSE fails)
- Recent calls feed: last 5 calls with status, campaign, and time-ago display

---

### CSV Upload for Bulk Campaigns

**What changed:** BulkDialer component now supports CSV/TXT file upload. Parses phone numbers from any column, validates format (10-15 digits with optional + prefix).

**Why:** Entering 500+ phone numbers manually into a textarea is impractical. Campaign managers have phone lists in spreadsheets.

**Benefits:**
- Upload any CSV/TXT file — phone numbers are auto-extracted from all columns
- Validation: only numbers matching `+?\\d{10,15}` are accepted
- Append mode: uploaded numbers are added to existing numbers in the textarea
- Shows live count of parsed numbers

---

### Kubernetes Manifests (AWS EKS)

**What changed:** Added complete K8s manifests: namespace, secrets, configmap, Redis deployment, agent deployment with HPA (3→50 pods), dashboard deployment with ALB ingress.

**Why:** Docker Compose works for development but cannot scale to 3,000 concurrent calls. Need auto-scaling, health checks, and managed infrastructure.

**Benefits:**
- HPA scales agent pods from 3 to 50 based on CPU (60%) and memory (70%)
- Fast scale-up: 5 pods per 60 seconds. Slow scale-down: 2 pods per 120 seconds (protects active calls)
- Redis deployed in-cluster with 512MB maxmemory and LRU eviction
- Health endpoint (`/api/health`) checks Redis, Airtable, LiveKit, and SIP trunk availability
- ALB ingress with HTTPS termination for dashboard

---

### Graceful Degradation Architecture

**What changed:** All Redis and Airtable integrations are optional. The system detects availability at runtime and falls back gracefully.

**Why:** During development and small deployments, requiring Redis and Airtable adds unnecessary complexity. The system should work out of the box and gain capabilities as infrastructure is added.

**Benefits:**
- **No Redis**: Direct dispatch + file-based logging. Works immediately.
- **With Redis**: Gains BullMQ queue, call state machine, real-time stats, DND enforcement.
- **With Airtable**: Gains persistent cloud storage with search and filtering.
- Redis client stops retrying after 3 failed attempts (no log spam).
- Health endpoint reports degraded status (not failure) when optional services are unavailable.

---

### Branding: Rapid X AI → CxLL

**What changed:** All "Rapid X AI" references replaced with "CxLL" across layout, page titles, nav bar, footer, and config header.

---

## v1.0.0 — Initial Release

- Single voice agent with hardcoded Anushka/XYZ Finance prompt
- Groq LLM + Deepgram STT + Sarvam/Deepgram TTS
- Basic Next.js dashboard with single call dispatch and bulk dialer
- SIP trunk tools (create, setup, list)
- Docker Compose for local deployment
