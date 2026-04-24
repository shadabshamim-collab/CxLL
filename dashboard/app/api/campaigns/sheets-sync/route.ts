import { NextResponse } from 'next/server';
import { getCampaignById } from '@/lib/campaigns';
import {
    isGoogleSheetsConfigured,
    readSheetLeads,
    writeDispositionSentinel,
    storeSheetsMeta,
    isInDndWindow,
} from '@/lib/google-sheets';

// ── Shared sync logic ─────────────────────────────────────────────────────────

async function runSync(campaignId: string | null): Promise<NextResponse> {
    if (!isGoogleSheetsConfigured()) {
        return NextResponse.json({ error: 'GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON not configured' }, { status: 503 });
    }
    if (!campaignId) {
        return NextResponse.json({ error: 'campaign is required' }, { status: 400 });
    }

    const campaign = getCampaignById(campaignId);
    if (!campaign) {
        return NextResponse.json({ error: `Campaign "${campaignId}" not found` }, { status: 404 });
    }
    if (campaign.status !== 'active') {
        return NextResponse.json({ error: 'Campaign is inactive' }, { status: 400 });
    }
    const leadSource = (campaign as any).lead_source;
    if (!leadSource || leadSource.type !== 'google_sheets') {
        return NextResponse.json({ error: 'Campaign does not use Google Sheets as lead source' }, { status: 400 });
    }

    const sheetId: string = leadSource.sheet_id || process.env.GOOGLE_SHEETS_DEFAULT_SHEET_ID || '';
    const tabName: string = leadSource.tab_name || 'Leads';

    if (!sheetId) {
        return NextResponse.json({ error: 'sheet_id not set in campaign or GOOGLE_SHEETS_DEFAULT_SHEET_ID env' }, { status: 400 });
    }

    // ── DND window guard ─────────────────────────────────────────────
    const dnd = (campaign as any).dnd_window_ist || { start_hour: 21, end_hour: 9 };
    if (isInDndWindow(dnd.start_hour, dnd.end_hour)) {
        return NextResponse.json({
            dispatched: 0,
            skipped: 0,
            message: 'DND window active — no calls dispatched',
        });
    }

    // ── Read and dispatch leads ───────────────────────────────────────
    const leads = await readSheetLeads(sheetId, tabName);
    const maxConcurrent = (campaign as any).max_concurrent_calls || 20;
    const batch = leads.slice(0, maxConcurrent);

    const baseUrl =
        process.env.DASHBOARD_URL ||
        process.env.NEXTAUTH_URL ||
        'http://localhost:3000';

    let dispatched = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const lead of batch) {
        try {
            const userNameSafe = lead.user_name.replace(/['"<>]/g, '');
            const greeting = campaign.initial_greeting.replace(/\{\{user_name\}\}/g, userNameSafe);
            const systemPrompt = campaign.system_prompt.replace(/\{\{user_name\}\}/g, userNameSafe);

            const newAttemptCount = lead.attempt_count + 1;

            // Write sentinel BEFORE dispatching (prevents double-dial on overlapping polls)
            await writeDispositionSentinel(sheetId, tabName, lead.rowIndex, newAttemptCount);

            const dispatchRes = await fetch(`${baseUrl}/api/dispatch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phoneNumber: lead.secondary_mobile,
                    campaignId: campaign.id,
                    overrideSystemPrompt: systemPrompt,
                    overrideGreeting: greeting,
                    sheets_meta: {
                        urn: lead.urn,
                        user_name: lead.user_name,
                        sheet_id: sheetId,
                        tab_name: tabName,
                        row_index: lead.rowIndex,
                        attempt_count: newAttemptCount,
                    },
                }),
            });

            if (!dispatchRes.ok) {
                const err = await dispatchRes.json().catch(() => ({ error: 'unknown' }));
                throw new Error(err.error || `HTTP ${dispatchRes.status}`);
            }

            const { roomName } = await dispatchRes.json();

            if (roomName) {
                await storeSheetsMeta(roomName, {
                    urn: lead.urn,
                    user_name: lead.user_name,
                    sheet_id: sheetId,
                    tab_name: tabName,
                    row_index: lead.rowIndex,
                    attempt_count: newAttemptCount,
                });
            }

            dispatched++;
        } catch (e: any) {
            failed++;
            errors.push(`URN ${lead.urn}: ${e.message}`);
            console.error(`[SheetsSync] Failed to dispatch URN ${lead.urn}:`, e.message);
        }
    }

    return NextResponse.json({
        campaign: campaign.name,
        sheet_id: sheetId,
        tab: tabName,
        available_leads: leads.length,
        dispatched,
        failed,
        ...(errors.length ? { errors } : {}),
    });
}

// ── GET — external cron (requires x-sync-secret or Authorization: Bearer) ────

export async function GET(request: Request) {
    const secret = process.env.SHEETS_SYNC_CRON_SECRET;
    if (secret) {
        const provided =
            request.headers.get('x-sync-secret') ||
            request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        if (provided !== secret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }
    const { searchParams } = new URL(request.url);
    return runSync(searchParams.get('campaign'));
}

// ── POST — dashboard UI (no secret required; same-origin internal call) ───────

export async function POST(request: Request) {
    const { campaignId } = await request.json().catch(() => ({}));
    return runSync(campaignId ?? null);
}
