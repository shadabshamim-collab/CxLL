/**
 * One-time script: initialises the Leads sheet with headers and a sample row.
 * Run: npx tsx scripts/setup-sheet.ts
 * Requires GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON in dashboard/.env
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { JWT } from 'google-auth-library';

// Load .env manually (no dotenv dependency)
const envPath = resolve(__dirname, '../.env');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] ??= m[2].trim();
}

const SHEET_ID = process.env.GOOGLE_SHEETS_DEFAULT_SHEET_ID || '108ksoVbG9vvTJ00wLLXEN29G7SMz5RwKxvl9FQKiigQ';
const TAB_NAME = 'Leads';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function getToken(): Promise<string> {
    const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not set in .env');
    const sa = JSON.parse(raw);
    const client = new JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Could not get access token');
    return token;
}

async function writeRange(token: string, range: string, values: (string | number)[][]): Promise<void> {
    const url = `${SHEETS_API}/${SHEET_ID}/values:batchUpdate`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: [{ range, values }],
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Sheets API ${res.status}: ${body}`);
    }
}

async function main() {
    console.log(`Setting up sheet: ${SHEET_ID} / tab: ${TAB_NAME}`);
    const token = await getToken();
    console.log('✓ Access token obtained');

    // Row 1: headers
    await writeRange(token, `${TAB_NAME}!A1:K1`, [[
        'URN', 'User Name', 'Secondary Mobile', 'Disposition',
        'Attempt Count', 'Last Call Timestamp (IST)', 'Call SID', 'Notes',
        'Sentiment', 'Duration (s)', 'Turn Count',
    ]]);
    console.log('✓ Headers written to row 1');

    // Row 2: sample lead (Disposition empty = undialed)
    await writeRange(token, `${TAB_NAME}!A2:C2`, [[
        'USER178791469848G8X1', 'Shadab Shamim', '+917004378538',
    ]]);
    console.log('✓ Sample lead written to row 2');

    console.log('\nSheet is ready. Trigger a sync with:');
    console.log(`  curl -H "x-sync-secret: ${process.env.SHEETS_SYNC_CRON_SECRET || 'ssCxLL2026K2RSync!'}" \\`);
    console.log(`       "http://localhost:3000/api/campaigns/sheets-sync?campaign=primary-number-verification"`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
