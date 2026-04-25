import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST, GET } from '../app/api/campaigns/sheets-sync/route';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/campaigns');
vi.mock('@/lib/google-sheets');

// Prevent real Redis from being imported
vi.mock('@/lib/redis', () => ({
    getRedis: vi.fn().mockReturnValue({
        setex: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
    }),
}));

import { getCampaignById } from '@/lib/campaigns';
import {
    readSheetLeads,
    writeDispositionSentinel,
    storeSheetsMeta,
    isInDndWindow,
    isGoogleSheetsConfigured,
} from '@/lib/google-sheets';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
    lead_source: { type: 'google_sheets' as const, sheet_id: 'sheet-test-123', tab_name: 'Leads' },
    dnd_window_ist: { start_hour: 0, end_hour: 9 },
    max_concurrent_calls: 20,
    disposition_taxonomy: ['Verified', 'Not Verified', 'Callback Requested', 'Missed Call'],
};

const SAMPLE_LEADS = [
    {
        rowIndex: 2,
        urn: 'URN-000101',
        user_name: 'Shadab Shamim',
        secondary_mobile: '+917004378538',
        attempt_count: 0,
    },
    {
        rowIndex: 3,
        urn: 'URN-000102',
        user_name: 'Test User',
        secondary_mobile: '+919876543210',
        attempt_count: 0,
    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePostRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost:3000/api/campaigns/sheets-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function makeGetRequest(params: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
    const url = new URL('http://localhost:3000/api/campaigns/sheets-sync');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new Request(url.toString(), { method: 'GET', headers });
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();

    // Environment
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
    });
    delete process.env.SHEETS_SYNC_CRON_SECRET;
    process.env.REDIS_URL = ''; // disable Redis in enqueueCall

    // Default mock implementations
    vi.mocked(isGoogleSheetsConfigured).mockReturnValue(true);
    vi.mocked(getCampaignById).mockReturnValue(BASE_CAMPAIGN as any);
    vi.mocked(readSheetLeads).mockResolvedValue(SAMPLE_LEADS);
    vi.mocked(writeDispositionSentinel).mockResolvedValue(undefined);
    vi.mocked(storeSheetsMeta).mockResolvedValue(undefined);
    vi.mocked(isInDndWindow).mockReturnValue(false);

    // Stub global fetch for dispatch calls
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, roomName: 'call-123-test', mode: 'direct' }),
        text: async () => '',
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.SHEETS_SYNC_CRON_SECRET;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/campaigns/sheets-sync', () => {
    // TC-001: POST with valid config → 200, dispatched=2
    it('TC-001: returns 200 with dispatched=2 for a valid campaign and 2 fresh leads', async () => {
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.dispatched).toBe(2);
        expect(body.failed).toBe(0);
    });

    // TC-003: Campaign JSON has correct structure including disposition_taxonomy
    it('TC-003: response includes campaign name and sheet metadata', async () => {
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        const body = await res.json();
        expect(body.campaign).toBe('Primary Number Verification');
        expect(body.sheet_id).toBe('sheet-test-123');
        expect(body.tab).toBe('Leads');
    });

    // TC-011: 2 fresh leads → sentinel written for each before dispatch, dispatched=2
    it('TC-011: writeDispositionSentinel called once per lead before dispatch', async () => {
        await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        expect(vi.mocked(writeDispositionSentinel)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(writeDispositionSentinel)).toHaveBeenCalledWith(
            'sheet-test-123', 'Leads', 2, 1
        );
        expect(vi.mocked(writeDispositionSentinel)).toHaveBeenCalledWith(
            'sheet-test-123', 'Leads', 3, 1
        );
    });

    // TC-012: All leads have 'Dialing…' sentinel (readSheetLeads returns []) → dispatched=0
    it('TC-012: dispatched=0 when all leads are already sentineled', async () => {
        vi.mocked(readSheetLeads).mockResolvedValue([]);
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        const body = await res.json();
        expect(body.dispatched).toBe(0);
        expect(vi.mocked(writeDispositionSentinel)).not.toHaveBeenCalled();
    });

    // TC-013: readSheetLeads returns [] (all terminal) → dispatched=0, available_leads=0
    it('TC-013: available_leads=0 and dispatched=0 when no fresh leads returned', async () => {
        vi.mocked(readSheetLeads).mockResolvedValue([]);
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        const body = await res.json();
        expect(body.available_leads).toBe(0);
        expect(body.dispatched).toBe(0);
    });

    // TC-018: 25 leads, max_concurrent_calls=20 → only 20 dispatched
    it('TC-018: caps dispatched at max_concurrent_calls when leads exceed limit', async () => {
        const manyLeads = Array.from({ length: 25 }, (_, i) => ({
            rowIndex: i + 2,
            urn: `URN-${String(i).padStart(6, '0')}`,
            user_name: `User ${i}`,
            secondary_mobile: `+9190000${String(i).padStart(5, '0')}`,
            attempt_count: 0,
        }));
        vi.mocked(readSheetLeads).mockResolvedValue(manyLeads);

        // Campaign already has max_concurrent_calls: 20
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        const body = await res.json();
        expect(body.dispatched).toBe(20);
        expect(body.available_leads).toBe(25);
        expect(vi.mocked(writeDispositionSentinel)).toHaveBeenCalledTimes(20);
    });

    // TC-031: Sentinel written BEFORE dispatch fetch call (verify call order)
    it('TC-031: writeDispositionSentinel is called before the fetch dispatch for each lead', async () => {
        const callOrder: string[] = [];

        vi.mocked(writeDispositionSentinel).mockImplementation(async () => {
            callOrder.push('sentinel');
        });

        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
            if (String(url).includes('/api/dispatch')) {
                callOrder.push('dispatch');
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, roomName: 'call-order-test', mode: 'direct' }),
                text: async () => '',
            };
        }));

        await POST(makePostRequest({ campaignId: 'primary-number-verification' }));

        // For each lead, sentinel must come immediately before dispatch
        // The sequence should be: sentinel, dispatch, sentinel, dispatch
        expect(callOrder.length).toBe(4);
        expect(callOrder[0]).toBe('sentinel');
        expect(callOrder[1]).toBe('dispatch');
        expect(callOrder[2]).toBe('sentinel');
        expect(callOrder[3]).toBe('dispatch');
    });

    // TC-032: Second poll returns 0 leads because rows were sentineled
    it('TC-032: second POST call returns dispatched=0 when readSheetLeads returns empty (rows sentineled)', async () => {
        // First poll dispatches 2
        await POST(makePostRequest({ campaignId: 'primary-number-verification' }));

        // Second poll: rows were sentineled, readSheetLeads now returns empty
        vi.mocked(readSheetLeads).mockResolvedValue([]);
        const res2 = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        const body2 = await res2.json();
        expect(body2.dispatched).toBe(0);
    });

    // TC-081: isInDndWindow returns true → dispatched=0, message contains 'DND window active'
    it('TC-081: returns dispatched=0 and DND message when inside DND window', async () => {
        vi.mocked(isInDndWindow).mockReturnValue(true);
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        const body = await res.json();
        expect(body.dispatched).toBe(0);
        expect(body.message).toMatch(/DND window active/i);
        expect(vi.mocked(readSheetLeads)).not.toHaveBeenCalled();
    });

    // TC-082: isInDndWindow returns false → dispatch proceeds normally
    it('TC-082: proceeds with dispatch when outside DND window', async () => {
        vi.mocked(isInDndWindow).mockReturnValue(false);
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        const body = await res.json();
        expect(body.dispatched).toBe(2);
        expect(vi.mocked(readSheetLeads)).toHaveBeenCalled();
    });

    it('returns 400 if campaignId is missing', async () => {
        const res = await POST(makePostRequest({}));
        expect(res.status).toBe(400);
    });

    it('returns 404 if campaign does not exist', async () => {
        vi.mocked(getCampaignById).mockReturnValue(null);
        const res = await POST(makePostRequest({ campaignId: 'nonexistent' }));
        expect(res.status).toBe(404);
    });

    it('returns 503 when Google Sheets is not configured', async () => {
        vi.mocked(isGoogleSheetsConfigured).mockReturnValue(false);
        const res = await POST(makePostRequest({ campaignId: 'primary-number-verification' }));
        expect(res.status).toBe(503);
    });
});

describe('GET /api/campaigns/sheets-sync', () => {
    // TC-005: GET without x-sync-secret header → 401 when SHEETS_SYNC_CRON_SECRET is set
    it('TC-005a: returns 401 when SHEETS_SYNC_CRON_SECRET is set and header is missing', async () => {
        process.env.SHEETS_SYNC_CRON_SECRET = 'super-secret-token';
        const res = await GET(makeGetRequest({ campaign: 'primary-number-verification' }));
        expect(res.status).toBe(401);
    });

    it('TC-005b: returns 401 when wrong secret is provided', async () => {
        process.env.SHEETS_SYNC_CRON_SECRET = 'super-secret-token';
        const res = await GET(
            makeGetRequest(
                { campaign: 'primary-number-verification' },
                { 'x-sync-secret': 'wrong-secret' }
            )
        );
        expect(res.status).toBe(401);
    });

    it('TC-005c: passes through sync logic when correct x-sync-secret header is provided', async () => {
        process.env.SHEETS_SYNC_CRON_SECRET = 'super-secret-token';
        const res = await GET(
            makeGetRequest(
                { campaign: 'primary-number-verification' },
                { 'x-sync-secret': 'super-secret-token' }
            )
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.dispatched).toBe(2);
    });

    it('TC-005d: passes through when no SHEETS_SYNC_CRON_SECRET is set (open endpoint)', async () => {
        delete process.env.SHEETS_SYNC_CRON_SECRET;
        const res = await GET(makeGetRequest({ campaign: 'primary-number-verification' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.dispatched).toBe(2);
    });

    it('accepts Authorization: Bearer token as alternative to x-sync-secret header', async () => {
        process.env.SHEETS_SYNC_CRON_SECRET = 'bearer-token-123';
        const res = await GET(
            makeGetRequest(
                { campaign: 'primary-number-verification' },
                { 'Authorization': 'Bearer bearer-token-123' }
            )
        );
        expect(res.status).toBe(200);
    });
});
