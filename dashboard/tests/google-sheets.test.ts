import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    normalizeIndianMobile,
    isInDndWindow,
    adjustForDnd,
    isValidDisposition,
    VALID_DISPOSITIONS,
    maskMobile,
    readSheetLeads,
    writeDispositionSentinel,
    writeDisposition,
} from '../lib/google-sheets';

// ── E.164 normalization ───────────────────────────────────────────────────────

describe('normalizeIndianMobile', () => {
    it('converts 10-digit numbers starting 6–9', () => {
        expect(normalizeIndianMobile('9876543210')).toBe('+919876543210');
        expect(normalizeIndianMobile('6123456789')).toBe('+916123456789');
    });

    it('passes through already-E.164 +91 numbers', () => {
        expect(normalizeIndianMobile('+919876543210')).toBe('+919876543210');
    });

    it('handles 91XXXXXXXXXX 12-digit format', () => {
        expect(normalizeIndianMobile('919876543210')).toBe('+919876543210');
    });

    it('handles 091XXXXXXXXXX 13-digit format', () => {
        expect(normalizeIndianMobile('0919876543210')).toBe('+919876543210');
    });

    it('returns null for landlines / short numbers', () => {
        expect(normalizeIndianMobile('044123456')).toBeNull();
        expect(normalizeIndianMobile('1234567890')).toBeNull(); // starts with 1
    });

    it('strips spaces and dashes', () => {
        expect(normalizeIndianMobile('98765 43210')).toBe('+919876543210');
        expect(normalizeIndianMobile('+91-98765-43210')).toBe('+919876543210');
    });

    it('returns null for completely invalid input', () => {
        expect(normalizeIndianMobile('abc')).toBeNull();
        expect(normalizeIndianMobile('')).toBeNull();
    });

    // TC-025: 0-prefix 11-digit number (leading 0 before 10-digit mobile)
    it('TC-025: handles 0XXXXXXXXXX 11-digit format (0-prefix mobile)', () => {
        expect(normalizeIndianMobile('09876543210')).toBe('+919876543210');
    });

    // TC-026: 9-digit number — too short, must return null
    it('TC-026: returns null for 9-digit number', () => {
        expect(normalizeIndianMobile('987654321')).toBeNull();
    });

    // TC-027: 11-digit number not starting with 0 or 91 — invalid
    it('TC-027: returns null for 11-digit number not starting with 0 or 91', () => {
        expect(normalizeIndianMobile('98765432101')).toBeNull();
    });

    // TC-028: non-Indian E.164 numbers — must return null
    it('TC-028: returns null for non-Indian E.164 numbers (US/UK)', () => {
        expect(normalizeIndianMobile('+14155551234')).toBeNull();   // US
        expect(normalizeIndianMobile('+447911123456')).toBeNull();  // UK
    });

    // TC-029: alphanumeric garbage — must return null
    it('TC-029: returns null for alphanumeric input', () => {
        expect(normalizeIndianMobile('abc1234567')).toBeNull();
    });
});

// ── maskMobile ────────────────────────────────────────────────────────────────

describe('maskMobile', () => {
    it('masks all but last 4 digits', () => {
        expect(maskMobile('+919876543210')).toBe('****3210');
    });
});

// ── DND window ────────────────────────────────────────────────────────────────

describe('isInDndWindow', () => {
    const realDateNow = Date.now;

    afterEach(() => {
        vi.restoreAllMocks();
        Date.now = realDateNow;
    });

    function setISTHour(hour: number) {
        // Reverse: given IST hour, compute UTC epoch
        const now = new Date();
        now.setUTCHours(hour - 6, 30, 0, 0); // IST = UTC+5:30, so UTC = IST - 5:30 = (hour-6):30
        vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
    }

    it('is active at 22:00 IST (night)', () => {
        setISTHour(22);
        expect(isInDndWindow()).toBe(true);
    });

    it('is active at 08:00 IST (early morning)', () => {
        setISTHour(8);
        expect(isInDndWindow()).toBe(true);
    });

    it('is inactive at 10:00 IST (working hours)', () => {
        setISTHour(10);
        expect(isInDndWindow()).toBe(false);
    });

    it('is inactive at 18:00 IST', () => {
        setISTHour(18);
        expect(isInDndWindow()).toBe(false);
    });
});

// ── adjustForDnd ──────────────────────────────────────────────────────────────

describe('adjustForDnd', () => {
    it('defers 22:30 IST to 09:05 IST next day', () => {
        // 22:30 IST = 17:00 UTC on the same day
        const IST_OFFSET = 5.5 * 60 * 60 * 1000;
        const base = new Date('2026-04-24T17:00:00Z').getTime(); // 22:30 IST
        const adjusted = adjustForDnd(base);
        const adjIST = new Date(adjusted + IST_OFFSET);
        expect(adjIST.getUTCHours()).toBe(9);
        expect(adjIST.getUTCMinutes()).toBe(5);
        // Should be next calendar day
        expect(adjIST.getUTCDate()).toBe(25);
    });

    it('defers 08:00 IST (pre-9 AM) to 09:05 IST same day', () => {
        const IST_OFFSET = 5.5 * 60 * 60 * 1000;
        const base = new Date('2026-04-24T02:30:00Z').getTime(); // 08:00 IST
        const adjusted = adjustForDnd(base);
        const adjIST = new Date(adjusted + IST_OFFSET);
        expect(adjIST.getUTCHours()).toBe(9);
        expect(adjIST.getUTCMinutes()).toBe(5);
        expect(adjIST.getUTCDate()).toBe(24);
    });

    it('does not adjust a timestamp already in working hours', () => {
        const base = new Date('2026-04-24T06:00:00Z').getTime(); // 11:30 IST
        expect(adjustForDnd(base)).toBe(base);
    });
});

// ── Disposition taxonomy ──────────────────────────────────────────────────────

describe('isValidDisposition', () => {
    it('accepts the 4 valid values', () => {
        for (const d of VALID_DISPOSITIONS) {
            expect(isValidDisposition(d)).toBe(true);
        }
    });

    it('rejects unknown strings', () => {
        expect(isValidDisposition('payment_committed')).toBe(false);
        expect(isValidDisposition('')).toBe(false);
        expect(isValidDisposition('verified')).toBe(false); // case-sensitive
    });
});

// ── Google Sheets API calls (mocked) ─────────────────────────────────────────

// Mock google-auth-library + fetch so tests never touch the real API.
vi.mock('google-auth-library', () => {
    class MockJWT {
        constructor(_opts: any) {}
        async getAccessToken() { return { token: 'fake-token-for-tests' }; }
    }
    return { JWT: MockJWT };
});

function mockSheetsFetch(rows: string[][]): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ values: rows }),
        text: async () => '',
    }));
}

function mockSheetsFetchWrite(): ReturnType<typeof vi.fn> {
    const mockFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
    });
    vi.stubGlobal('fetch', mockFn);
    return mockFn;
}

beforeEach(() => {
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('readSheetLeads', () => {
    it('skips rows with non-empty Col D (existing disposition)', async () => {
        mockSheetsFetch([
            ['URN001', 'Alice', '9876543210', '',        '0', '', '', ''], // Col D empty → included
            ['URN002', 'Bob',   '9876543211', 'Verified', '1', '', '', ''], // Col D = "Verified" → skipped
            ['URN003', 'Carol', '9876543212', 'Dialing…', '1', '', '', ''], // Col D = sentinel → skipped
        ]);

        const leads = await readSheetLeads('sheet123', 'Leads');
        expect(leads).toHaveLength(1);
        expect(leads[0].urn).toBe('URN001');
    });

    it('skips rows with missing URN or mobile', async () => {
        mockSheetsFetch([
            ['', 'Alice', '9876543210', '', '0'],     // no URN
            ['URN001', 'Bob', '', '', '0'],             // no mobile
            ['URN002', 'Carol', '9876543212', '', '0'], // valid
        ]);

        const leads = await readSheetLeads('sheet123', 'Leads');
        expect(leads).toHaveLength(1);
        expect(leads[0].urn).toBe('URN002');
    });

    it('normalizes 10-digit mobile to E.164', async () => {
        mockSheetsFetch([['URN001', 'Dave', '9876543210', '', '0']]);
        const leads = await readSheetLeads('sheet123', 'Leads');
        expect(leads[0].secondary_mobile).toBe('+919876543210');
    });

    it('skips rows with invalid mobile and logs warning', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockSheetsFetch([['URN001', 'Eve', '1234', '', '0']]);
        const leads = await readSheetLeads('sheet123', 'Leads');
        expect(leads).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipping invalid mobile'));
    });

    it('returns correct rowIndex (1-based, accounting for header)', async () => {
        mockSheetsFetch([
            ['URN001', 'Alice', '9876543210', '', '0'], // row 2 in sheet
            ['URN002', 'Bob',   '9876543211', '', '0'], // row 3 in sheet
        ]);
        const leads = await readSheetLeads('sheet123', 'Leads');
        expect(leads[0].rowIndex).toBe(2);
        expect(leads[1].rowIndex).toBe(3);
    });

    // TC-014: row with empty user_name (Col B) is skipped with a console.warn
    it('TC-014: skips row with empty user_name and logs warning containing "missing user name"', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockSheetsFetch([
            ['URN001', '',      '9876543210', '', '0'], // Col B empty → skipped
            ['URN002', 'Frank', '9876543211', '', '0'], // valid
        ]);
        const leads = await readSheetLeads('sheet123', 'Leads');
        expect(leads).toHaveLength(1);
        expect(leads[0].urn).toBe('URN002');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing user name'));
    });

    // TC-017: duplicate URN — only first row returned, error logged
    it('TC-017: returns only first row for duplicate URNs and logs error containing "duplicate URN"', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSheetsFetch([
            ['URN-DUP', 'Alice', '9876543210', '', '0'], // first → included
            ['URN-DUP', 'Bob',   '9876543211', '', '1'], // duplicate → skipped
        ]);
        const leads = await readSheetLeads('sheet123', 'Leads');
        expect(leads).toHaveLength(1);
        expect(leads[0].user_name).toBe('Alice');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate URN'));
    });
});

describe('writeDispositionSentinel', () => {
    it('writes Dialing… to Col D, attempt count to Col E, and IST timestamp to Col F', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDispositionSentinel('sheet123', 'Leads', 5, 2);

        const body = JSON.parse(fetchMock.mock.lastCall![1].body);
        const ranges = body.data.map((d: any) => d.range);
        expect(ranges).toContain('Leads!D5');
        expect(ranges).toContain('Leads!E5');
        expect(ranges).toContain('Leads!F5');

        const dUpdate = body.data.find((d: any) => d.range === 'Leads!D5');
        expect(dUpdate.values[0][0]).toBe('Dialing…');

        const eUpdate = body.data.find((d: any) => d.range === 'Leads!E5');
        expect(eUpdate.values[0][0]).toBe(2);
    });

    it('never touches Col A, B, or C', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDispositionSentinel('sheet123', 'Leads', 5, 1);
        const body = JSON.parse(fetchMock.mock.lastCall![1].body);
        const writtenCols = body.data.map((d: any) => d.range.replace(/^Leads!/, '').charAt(0));
        expect(writtenCols).not.toContain('A');
        expect(writtenCols).not.toContain('B');
        expect(writtenCols).not.toContain('C');
    });
});

describe('writeDisposition', () => {
    it('writes final disposition to Col D, call SID to Col G', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDisposition('sheet123', 'Leads', 7, 'Verified', 'call-123456-abc', '');

        const body = JSON.parse(fetchMock.mock.lastCall![1].body);
        const dUpdate = body.data.find((d: any) => d.range === 'Leads!D7');
        expect(dUpdate.values[0][0]).toBe('Verified');

        const gUpdate = body.data.find((d: any) => d.range === 'Leads!G7');
        expect(gUpdate.values[0][0]).toBe('call-123456-abc');
    });

    it('preserves columns A, B, and C (never writes to them)', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDisposition('sheet123', 'Leads', 7, 'Not Verified', 'room-x', 'denied being customer');
        const body = JSON.parse(fetchMock.mock.lastCall![1].body);
        const writtenCols = body.data.map((d: any) => d.range.replace(/^Leads!/, '').charAt(0));
        expect(writtenCols).not.toContain('A');
        expect(writtenCols).not.toContain('B');
        expect(writtenCols).not.toContain('C');
    });

    it('includes Notes in Col H when provided', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDisposition('sheet123', 'Leads', 3, 'Callback Requested', 'room-y', 'call back tomorrow 10am');
        const body = JSON.parse(fetchMock.mock.lastCall![1].body);
        const hUpdate = body.data.find((d: any) => d.range === 'Leads!H3');
        expect(hUpdate.values[0][0]).toBe('call back tomorrow 10am');
    });

    it('omits Col H when notes is empty', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDisposition('sheet123', 'Leads', 3, 'Missed Call', 'room-z', '');
        const body = JSON.parse(fetchMock.mock.lastCall![1].body);
        const hUpdate = body.data.find((d: any) => d.range === 'Leads!H3');
        expect(hUpdate).toBeUndefined();
    });

    // TC-063: passing { attemptCount: 2 } in details → Col E written with value 2
    it('TC-063: writes attemptCount to Col E when provided in details object', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDisposition('sheet123', 'Leads', 4, 'Verified', 'room-attempt', { attemptCount: 2 });
        const body = JSON.parse(fetchMock.mock.lastCall![1].body);
        const eUpdate = body.data.find((d: any) => d.range === 'Leads!E4');
        expect(eUpdate).toBeDefined();
        expect(eUpdate.values[0][0]).toBe(2);
    });

    // TC-066: full details object → Cols H, I, J, K all written correctly
    it('TC-066: writes summary/sentiment/durationSeconds/transcript to Cols H/I/J/K', async () => {
        const fetchMock = mockSheetsFetchWrite();
        await writeDisposition('sheet123', 'Leads', 5, 'Verified', 'room-full', {
            summary: 'customer confirmed identity',
            sentiment: 'positive',
            durationSeconds: 28,
            transcript: 'Agent: Hello\nCustomer: Yes I confirm',
        });
        const body = JSON.parse(fetchMock.mock.lastCall![1].body);

        const hUpdate = body.data.find((d: any) => d.range === 'Leads!H5');
        expect(hUpdate?.values[0][0]).toBe('customer confirmed identity');

        const iUpdate = body.data.find((d: any) => d.range === 'Leads!I5');
        expect(iUpdate?.values[0][0]).toBe('positive');

        const jUpdate = body.data.find((d: any) => d.range === 'Leads!J5');
        expect(jUpdate?.values[0][0]).toBe(28);

        const kUpdate = body.data.find((d: any) => d.range === 'Leads!K5');
        expect(kUpdate?.values[0][0]).toBe('Agent: Hello\nCustomer: Yes I confirm');
    });
});
