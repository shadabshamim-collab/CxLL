import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../app/api/calls/webhook/route';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/call-logger');
vi.mock('@/lib/campaigns');
vi.mock('@/lib/google-sheets');
vi.mock('@/lib/call-state', () => ({
    transitionCallState: vi.fn(),
    CallStatus: { CONNECTED: 'connected', COMPLETED: 'completed', FAILED: 'failed' },
}));
vi.mock('@/lib/call-queue', () => ({
    enqueueCall: vi.fn().mockResolvedValue('job-123'),
}));

// Prevent real Redis from being imported
vi.mock('@/lib/redis', () => ({
    getRedis: vi.fn().mockReturnValue({
        setex: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
    }),
    createRedisConnection: vi.fn(),
}));

import { updateCallByRoom } from '@/lib/call-logger';
import { getCampaignById } from '@/lib/campaigns';
import {
    getSheetsMeta,
    writeDisposition,
    writeDispositionSentinel,
    isValidDisposition,
    adjustForDnd,
} from '@/lib/google-sheets';
import { transitionCallState } from '@/lib/call-state';
import { enqueueCall } from '@/lib/call-queue';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_SHEETS_META = {
    urn: 'URN-000101',
    user_name: 'Shadab Shamim',
    sheet_id: 'sheet-test-123',
    tab_name: 'Leads',
    row_index: 2,
    attempt_count: 1,
};

const BASE_CAMPAIGN = {
    id: 'primary-number-verification',
    name: 'Primary Number Verification',
    status: 'active' as const,
    description: 'Verify primary mobile numbers',
    system_prompt: 'You are verifying {{user_name}}.',
    initial_greeting: 'Namaste, kya main {{user_name}} se baat kar rahi hoon?',
    fallback_greeting: 'Namaste...',
    model_provider: 'groq',
    voice_id: 'anushka',
    language: 'hi-IN',
    transfer_number: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    current_version: 1,
    versions: [],
    dnd_window_ist: { start_hour: 21, end_hour: 9 },
    retry_ladder: {
        max_attempts: 4,
        on_missed_call: [
            { delay_minutes: 120 },
            { delay_minutes: 240 },
            { delay_minutes: 480 },
        ],
    },
    lead_source: { type: 'google_sheets' as const, sheet_id: 'sheet-test-123', tab_name: 'Leads' },
    max_concurrent_calls: 20,
    disposition_taxonomy: ['Verified', 'Not Verified', 'Callback Requested', 'Missed Call'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWebhookRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost:3000/api/calls/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function sheetsMetaStr(overrides: Partial<typeof SAMPLE_SHEETS_META> = {}): string {
    return JSON.stringify({ ...SAMPLE_SHEETS_META, ...overrides });
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();

    process.env.REDIS_URL = ''; // disable Redis path in enqueueCall

    // Default mocks
    vi.mocked(updateCallByRoom).mockResolvedValue(null);
    vi.mocked(getCampaignById).mockReturnValue(BASE_CAMPAIGN as any);
    vi.mocked(getSheetsMeta).mockResolvedValue(SAMPLE_SHEETS_META);
    vi.mocked(writeDisposition).mockResolvedValue(undefined);
    vi.mocked(writeDispositionSentinel).mockResolvedValue(undefined);
    vi.mocked(transitionCallState).mockResolvedValue(undefined as any);
    vi.mocked(enqueueCall).mockResolvedValue('job-123');

    // isValidDisposition: use the real logic (simple passthrough mock)
    vi.mocked(isValidDisposition).mockImplementation((v: string) =>
        ['Verified', 'Not Verified', 'Callback Requested', 'Missed Call'].includes(v)
    );

    // adjustForDnd: pass through by default (no DND adjustment)
    vi.mocked(adjustForDnd).mockImplementation((ms: number) => ms);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ── status=summary tests ──────────────────────────────────────────────────────

describe('POST /api/calls/webhook — status=summary', () => {
    // TC-062: disposition=Verified → writeDisposition called with 'Verified'
    it('TC-062: calls writeDisposition with "Verified" disposition', async () => {
        const res = await POST(makeWebhookRequest({
            room_name: 'room-abc-001',
            status: 'summary',
            disposition: 'Verified',
            sheets_meta: sheetsMetaStr(),
        }));
        expect(res.status).toBe(200);
        expect(vi.mocked(writeDisposition)).toHaveBeenCalledWith(
            'sheet-test-123',
            'Leads',
            2,
            'Verified',
            'room-abc-001',
            expect.any(Object)
        );
    });

    // TC-063: sheets_meta has attempt_count:2 → writeDisposition called with details containing attemptCount:2
    it('TC-063: passes attemptCount from sheets_meta into writeDisposition details', async () => {
        const res = await POST(makeWebhookRequest({
            room_name: 'room-abc-002',
            status: 'summary',
            disposition: 'Verified',
            sheets_meta: sheetsMetaStr({ attempt_count: 2 }),
        }));
        expect(res.status).toBe(200);
        const callArgs = vi.mocked(writeDisposition).mock.calls[0];
        const details = callArgs[5] as any;
        expect(details.attemptCount).toBe(2);
    });

    // TC-064: writeDisposition called — just verify it's called (timestamp correctness is tested in google-sheets.test.ts)
    it('TC-064: writeDisposition is called (timestamp written as IST ISO string, verified in google-sheets tests)', async () => {
        await POST(makeWebhookRequest({
            room_name: 'room-abc-003',
            status: 'summary',
            disposition: 'Verified',
            sheets_meta: sheetsMetaStr(),
        }));
        expect(vi.mocked(writeDisposition)).toHaveBeenCalledTimes(1);
    });

    // TC-065: writeDisposition called with roomName as callSid arg
    it('TC-065: passes room_name as the callSid argument to writeDisposition', async () => {
        const roomName = 'room-sid-test-999';
        await POST(makeWebhookRequest({
            room_name: roomName,
            status: 'summary',
            disposition: 'Verified',
            sheets_meta: sheetsMetaStr(),
        }));
        const callArgs = vi.mocked(writeDisposition).mock.calls[0];
        expect(callArgs[4]).toBe(roomName);
    });

    // TC-066: sentiment/duration_seconds/transcript → writeDisposition details includes all three
    it('TC-066: passes sentiment, durationSeconds, and transcript in writeDisposition details', async () => {
        await POST(makeWebhookRequest({
            room_name: 'room-abc-066',
            status: 'summary',
            disposition: 'Verified',
            sentiment: 'positive',
            duration_seconds: 28,
            transcript: 'Agent: Hello\nCustomer: Yes',
            sheets_meta: sheetsMetaStr(),
        }));
        const callArgs = vi.mocked(writeDisposition).mock.calls[0];
        const details = callArgs[5] as any;
        expect(details.sentiment).toBe('positive');
        expect(details.durationSeconds).toBe(28);
        expect(details.transcript).toBe('Agent: Hello\nCustomer: Yes');
    });

    // TC-061/TC-067: writeDisposition NOT called for Cols A/B/C — the lib handles that guard.
    // Here we verify writeDisposition was called with the correct disposition only.
    it('TC-061/TC-067: writeDisposition called with correct disposition (col guards are lib-level)', async () => {
        await POST(makeWebhookRequest({
            room_name: 'room-col-guard',
            status: 'summary',
            disposition: 'Not Verified',
            sheets_meta: sheetsMetaStr(),
        }));
        const callArgs = vi.mocked(writeDisposition).mock.calls[0];
        // disposition is the 4th arg (index 3)
        expect(callArgs[3]).toBe('Not Verified');
    });

    // TC-075: disposition=Verified, attempt_count=1 → writeDisposition called with Verified; no retry
    it('TC-075: Verified disposition → writeDisposition called, no sentinel or enqueueCall for retry', async () => {
        await POST(makeWebhookRequest({
            room_name: 'room-abc-075',
            status: 'summary',
            disposition: 'Verified',
            sheets_meta: sheetsMetaStr({ attempt_count: 1 }),
        }));
        expect(vi.mocked(writeDisposition)).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.any(Number),
            'Verified',
            expect.any(String),
            expect.any(Object)
        );
        // Verified is not Missed Call, so no retry should be scheduled
        expect(vi.mocked(writeDispositionSentinel)).not.toHaveBeenCalled();
        expect(vi.mocked(enqueueCall)).not.toHaveBeenCalled();
    });

    // TC-091: same summary webhook delivered twice → writeDisposition called twice (idempotent)
    it('TC-091: writeDisposition called twice on duplicate summary webhook (current behavior)', async () => {
        const reqBody = {
            room_name: 'room-idempotent-091',
            status: 'summary',
            disposition: 'Verified',
            sheets_meta: sheetsMetaStr(),
        };
        await POST(makeWebhookRequest(reqBody));
        await POST(makeWebhookRequest(reqBody));
        expect(vi.mocked(writeDisposition)).toHaveBeenCalledTimes(2);
    });

    // TC-0510: invalid disposition → falls back to 'Not Verified'
    it('TC-0510: unknown disposition "Probably Verified" → writeDisposition called with "Not Verified"', async () => {
        vi.mocked(isValidDisposition).mockImplementation((v: string) =>
            ['Verified', 'Not Verified', 'Callback Requested', 'Missed Call'].includes(v)
        );
        await POST(makeWebhookRequest({
            room_name: 'room-fallback-0510',
            status: 'summary',
            disposition: 'Probably Verified',
            sheets_meta: sheetsMetaStr(),
        }));
        const callArgs = vi.mocked(writeDisposition).mock.calls[0];
        expect(callArgs[3]).toBe('Not Verified');
    });

    // TC-096 (P1): getSheetsMeta throws → webhook returns 200 anyway (graceful degradation)
    it('TC-096: returns 200 even when getSheetsMeta throws (graceful degradation)', async () => {
        // Omit sheets_meta from the request body so the code tries getSheetsMeta
        // and then simulate it throwing
        vi.mocked(getSheetsMeta).mockRejectedValue(new Error('Redis connection refused'));
        const res = await POST(makeWebhookRequest({
            room_name: 'room-graceful-096',
            status: 'summary',
            disposition: 'Verified',
            // No sheets_meta in body — forces getSheetsMeta call
        }));
        expect(res.status).toBe(200);
    });
});

// ── status=retry tests ────────────────────────────────────────────────────────

describe('POST /api/calls/webhook — status=retry', () => {
    // TC-071: missed_call + sheets_meta → writeDisposition 'Missed Call' + sentinel + enqueueCall
    it('TC-071: missed_call with sheets_meta → writes "Missed Call", schedules sentinel and retry', async () => {
        process.env.REDIS_URL = 'redis://localhost:6379'; // enable Redis path for enqueueCall

        await POST(makeWebhookRequest({
            room_name: 'room-retry-071',
            status: 'retry',
            reason: 'missed_call',
            sip_status: 486,
            phone_number: '+917004378538',
            campaign_id: 'primary-number-verification',
            sheets_meta: sheetsMetaStr({ attempt_count: 1 }),
        }));

        // writeDisposition called with 'Missed Call'
        expect(vi.mocked(writeDisposition)).toHaveBeenCalledWith(
            'sheet-test-123',
            'Leads',
            2,
            'Missed Call',
            'room-retry-071',
            expect.any(Object)
        );

        // Retry ladder: sentinel written for next attempt
        expect(vi.mocked(writeDispositionSentinel)).toHaveBeenCalled();

        // enqueueCall called for the retry
        expect(vi.mocked(enqueueCall)).toHaveBeenCalled();

        // Verify the scheduled_at is approximately 120 min from now (attempt_count=1 → step 0 = 120min)
        const enqueueArgs = vi.mocked(enqueueCall).mock.calls[0][0];
        const scheduledAt = new Date(enqueueArgs.scheduled_at!).getTime();
        const expectedMs = Date.now() + 120 * 60 * 1000;
        // Allow ±30 seconds of test execution slack
        expect(Math.abs(scheduledAt - expectedMs)).toBeLessThan(30_000);
    });

    // TC-074: attempt_count=4 (max) → no sentinel write, no enqueueCall
    it('TC-074: no retry scheduled when attempt_count equals max_attempts', async () => {
        process.env.REDIS_URL = 'redis://localhost:6379';

        await POST(makeWebhookRequest({
            room_name: 'room-maxattempts-074',
            status: 'retry',
            reason: 'missed_call',
            sip_status: 486,
            phone_number: '+917004378538',
            campaign_id: 'primary-number-verification',
            sheets_meta: sheetsMetaStr({ attempt_count: 4 }),
        }));

        // Missed Call is written (via tryWriteSheetDisposition)
        expect(vi.mocked(writeDisposition)).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.any(Number),
            'Missed Call',
            expect.any(String),
            expect.any(Object)
        );

        // But no sentinel and no retry enqueue (max attempts reached)
        expect(vi.mocked(writeDispositionSentinel)).not.toHaveBeenCalled();
        expect(vi.mocked(enqueueCall)).not.toHaveBeenCalled();
    });

    // TC-078: DND deferral — retry lands inside DND → adjustForDnd pushes to 09:05 IST next morning
    it('TC-078: adjustForDnd defers retry into next morning when ladder target lands inside DND window', async () => {
        process.env.REDIS_URL = 'redis://localhost:6379';

        // Mock adjustForDnd to simulate a DND push (adds ~10h to simulate 22:30→09:05 shift)
        const TEN_HOURS_MS = 10 * 60 * 60 * 1000;
        vi.mocked(adjustForDnd).mockImplementation((ms: number) => ms + TEN_HOURS_MS);

        await POST(makeWebhookRequest({
            room_name: 'room-dnd-078',
            status: 'retry',
            reason: 'missed_call',
            sip_status: 486,
            phone_number: '+917004378538',
            campaign_id: 'primary-number-verification',
            sheets_meta: sheetsMetaStr({ attempt_count: 1 }),
        }));

        expect(vi.mocked(enqueueCall)).toHaveBeenCalled();
        const enqueueArgs = vi.mocked(enqueueCall).mock.calls[0][0];
        const scheduledAt = new Date(enqueueArgs.scheduled_at!).getTime();
        // Expected: ~120min ladder delay + 10h DND shift
        const expectedBase = Date.now() + 120 * 60 * 1000 + TEN_HOURS_MS;
        expect(Math.abs(scheduledAt - expectedBase)).toBeLessThan(30_000);
    });

    it('returns 200 for a valid retry request', async () => {
        const res = await POST(makeWebhookRequest({
            room_name: 'room-retry-200',
            status: 'retry',
            reason: 'missed_call',
            sip_status: 486,
            phone_number: '+917004378538',
        }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
    });
});

// ── status=missed_call_sheets tests ──────────────────────────────────────────

describe('POST /api/calls/webhook — status=missed_call_sheets', () => {
    it('returns 200 and triggers sheets retry scheduling', async () => {
        process.env.REDIS_URL = 'redis://localhost:6379';

        const res = await POST(makeWebhookRequest({
            room_name: 'room-missed-sheets',
            status: 'missed_call_sheets',
            phone_number: '+917004378538',
            campaign_id: 'primary-number-verification',
        }));
        expect(res.status).toBe(200);
        expect((await res.json()).success).toBe(true);
    });
});

// ── General webhook tests ─────────────────────────────────────────────────────

describe('POST /api/calls/webhook — general', () => {
    it('returns 400 when room_name is missing', async () => {
        const res = await POST(makeWebhookRequest({
            status: 'summary',
            disposition: 'Verified',
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('room_name is required');
    });

    it('handles connected status and updates call log', async () => {
        const res = await POST(makeWebhookRequest({
            room_name: 'room-connected-001',
            status: 'connected',
        }));
        expect(res.status).toBe(200);
        expect(vi.mocked(updateCallByRoom)).toHaveBeenCalledWith(
            'room-connected-001',
            expect.objectContaining({ status: 'connected' })
        );
    });

    it('handles completed status and updates call log with duration', async () => {
        const res = await POST(makeWebhookRequest({
            room_name: 'room-completed-001',
            status: 'completed',
            duration_seconds: 45,
            outcome: 'answered',
        }));
        expect(res.status).toBe(200);
        expect(vi.mocked(updateCallByRoom)).toHaveBeenCalledWith(
            'room-completed-001',
            expect.objectContaining({
                status: 'completed',
                duration_seconds: 45,
                outcome: 'answered',
            })
        );
    });

    it('handles failed status and updates call log with error', async () => {
        const res = await POST(makeWebhookRequest({
            room_name: 'room-failed-001',
            status: 'failed',
            error: 'SIP 500 Internal Server Error',
        }));
        expect(res.status).toBe(200);
        expect(vi.mocked(updateCallByRoom)).toHaveBeenCalledWith(
            'room-failed-001',
            expect.objectContaining({
                status: 'failed',
                error: 'SIP 500 Internal Server Error',
            })
        );
    });
});
