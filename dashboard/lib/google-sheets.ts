import { JWT } from 'google-auth-library';

// ── Configuration ─────────────────────────────────────────────────────────────

export function isGoogleSheetsConfigured(): boolean {
    return !!process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
}

function getJwtClient(): JWT {
    const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not set');
    const sa = JSON.parse(raw);
    return new JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

// Cache access tokens for up to 55 minutes (they expire at 60).
let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
        return _tokenCache.token;
    }
    const client = getJwtClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Failed to obtain Google access token');
    _tokenCache = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
    return token;
}

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function sheetsFetch(path: string, init?: RequestInit): Promise<any> {
    const token = await getAccessToken();
    const res = await fetch(`${SHEETS_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Sheets API ${res.status} on ${path}: ${body}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type VerificationDisposition =
    | 'Verified'
    | 'Not Verified'
    | 'Callback Requested'
    | 'Missed Call';

export const VALID_DISPOSITIONS: VerificationDisposition[] = [
    'Verified',
    'Not Verified',
    'Callback Requested',
    'Missed Call',
];

export function isValidDisposition(v: string): v is VerificationDisposition {
    return VALID_DISPOSITIONS.includes(v as VerificationDisposition);
}

export interface SheetLead {
    rowIndex: number;         // 1-based sheet row (row 1 = header, data starts at row 2)
    urn: string;              // Col A — idempotency key
    user_name: string;        // Col B
    secondary_mobile: string; // Col C, normalized to E.164
    attempt_count: number;    // Col E current value (0 if empty)
}

export interface SheetsMeta {
    urn: string;
    user_name: string;
    sheet_id: string;
    tab_name: string;
    row_index: number;
    attempt_count: number;
}

// ── Phone normalization ───────────────────────────────────────────────────────
// Supports: 10-digit (6–9 prefix), 91XXXXXXXXXX (12), +91XXXXXXXXXX (already E.164).

export function normalizeIndianMobile(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
        return `+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits[2])) {
        return `+${digits}`;
    }
    if (digits.length === 13 && digits.startsWith('091') && /^[6-9]/.test(digits[3])) {
        return `+91${digits.slice(3)}`;
    }
    return null;
}

export function maskMobile(phone: string): string {
    const s = phone.replace(/\D/g, '');
    return s.length >= 4 ? `****${s.slice(-4)}` : '****';
}

function nowIST(): string {
    // Returns ISO 8601 with IST offset (+05:30)
    const utcMs = Date.now();
    const istMs = utcMs + 5.5 * 60 * 60 * 1000;
    const d = new Date(istMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
        `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+05:30`
    );
}

// ── DND window helper (21:00–09:00 IST) ──────────────────────────────────────

export function getISTHour(): number {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
    return new Date(istMs).getUTCHours();
}

export function isInDndWindow(startHour = 21, endHour = 9): boolean {
    const h = getISTHour();
    return h >= startHour || h < endHour;
}

// Adjusts a target timestamp (UTC ms) to 09:05 IST if it falls inside the DND window.
export function adjustForDnd(targetMs: number, startHour = 21, endHour = 9): number {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const targetISTMs = targetMs + IST_OFFSET;
    const d = new Date(targetISTMs);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();

    const inDnd = h >= startHour || h < endHour || (h === endHour && m < 5);
    if (!inDnd) return targetMs;

    // Push to 09:05 IST same day or next day
    const morning = new Date(targetISTMs);
    morning.setUTCHours(endHour, 5, 0, 0);
    if (h >= startHour) {
        // After 21:00 IST → next calendar day 09:05
        morning.setUTCDate(morning.getUTCDate() + 1);
    }
    return morning.getTime() - IST_OFFSET;
}

// ── Lead reading ──────────────────────────────────────────────────────────────
// Only returns rows where: Col A is non-empty AND Col C is non-empty AND Col D is empty.

export async function readSheetLeads(sheetId: string, tabName: string): Promise<SheetLead[]> {
    const range = `${tabName}!A2:H`;
    const data = await sheetsFetch(`/${sheetId}/values/${encodeURIComponent(range)}`);
    const rows: string[][] = data.values || [];
    const leads: SheetLead[] = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const urn = (row[0] || '').trim();
        const user_name = (row[1] || '').trim();
        const rawMobile = (row[2] || '').trim();
        const disposition = (row[3] || '').trim(); // Col D

        if (!urn || !rawMobile) continue;
        // Non-empty Col D means dialing-in-progress, already completed, or skipped.
        if (disposition !== '') continue;

        const normalized = normalizeIndianMobile(rawMobile);
        if (!normalized) {
            console.warn(`[Sheets] Row ${i + 2}: skipping invalid mobile ${maskMobile(rawMobile)}`);
            continue;
        }

        const attemptCount = parseInt(row[4] || '0', 10) || 0;
        leads.push({ rowIndex: i + 2, urn, user_name, secondary_mobile: normalized, attempt_count: attemptCount });
    }

    return leads;
}

// ── Sentinel write (before dispatch, prevents double-dial) ───────────────────
// Writes "Dialing…" to Col D, new attempt count to Col E, timestamp to Col F.
// Never touches Col A, B, or C.

export async function writeDispositionSentinel(
    sheetId: string,
    tabName: string,
    rowIndex: number,
    newAttemptCount: number
): Promise<void> {
    await sheetsFetch(`/${sheetId}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: [
                { range: `${tabName}!D${rowIndex}`, values: [['Dialing…']] },
                { range: `${tabName}!E${rowIndex}`, values: [[newAttemptCount]] },
                { range: `${tabName}!F${rowIndex}`, values: [[nowIST()]] },
            ],
        }),
    });
}

// ── Final disposition write (after call completes) ───────────────────────────
// Overwrites "Dialing…" in Col D. Updates F (timestamp), G (Call SID), H (notes).
// Never touches Col A, B, or C.

export async function writeDisposition(
    sheetId: string,
    tabName: string,
    rowIndex: number,
    disposition: VerificationDisposition,
    callSid: string,
    notes = ''
): Promise<void> {
    const updates: Array<{ range: string; values: any[][] }> = [
        { range: `${tabName}!D${rowIndex}`, values: [[disposition]] },
        { range: `${tabName}!F${rowIndex}`, values: [[nowIST()]] },
        { range: `${tabName}!G${rowIndex}`, values: [[callSid]] },
    ];
    if (notes) {
        updates.push({ range: `${tabName}!H${rowIndex}`, values: [[notes]] });
    }
    await sheetsFetch(`/${sheetId}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
    });
}

// ── Redis meta store (room_name → sheet row context) ─────────────────────────

const META_PREFIX = 'sheets:call:';
const META_TTL_SECONDS = 48 * 3600; // 48 h covers up to 4 attempts (max ~25 h total)

export async function storeSheetsMeta(roomName: string, meta: SheetsMeta): Promise<void> {
    try {
        const { getRedis } = await import('./redis');
        const redis = getRedis();
        await redis.setex(`${META_PREFIX}${roomName}`, META_TTL_SECONDS, JSON.stringify(meta));
    } catch (e) {
        console.warn('[Sheets] Redis unavailable — SheetsMeta not stored for', roomName);
    }
}

export async function getSheetsMeta(roomName: string): Promise<SheetsMeta | null> {
    try {
        const { getRedis } = await import('./redis');
        const redis = getRedis();
        const raw = await redis.get(`${META_PREFIX}${roomName}`);
        return raw ? (JSON.parse(raw) as SheetsMeta) : null;
    } catch {
        return null;
    }
}
