import { NextResponse } from 'next/server';
import { updateCallByRoom, logCallDispatched } from '@/lib/call-logger';
import type { VerificationDisposition } from '@/lib/google-sheets';
import { getCampaignById } from '@/lib/campaigns';
import { adjustForDnd } from '@/lib/google-sheets';

async function tryTransitionState(room_name: string, status: string, extra?: any): Promise<boolean> {
    try {
        const { transitionCallState, CallStatus } = await import('@/lib/call-state');
        const statusMap: Record<string, any> = {
            connected: CallStatus.CONNECTED,
            completed: CallStatus.COMPLETED,
            failed: CallStatus.FAILED,
        };
        if (statusMap[status]) {
            await transitionCallState(room_name, statusMap[status], extra);
            return true;
        }
    } catch { /* Redis unavailable */ }
    return false;
}

async function tryScheduleRetry(
    phoneNumber: string,
    campaignId: string | undefined,
    delaySeconds: number,
    sheets_meta?: any
): Promise<boolean> {
    if (delaySeconds <= 0) return false;

    // Try BullMQ queue first
    try {
        if (process.env.REDIS_URL) {
            const { enqueueCall } = await import('@/lib/call-queue');
            const callId = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await enqueueCall({
                call_id: callId,
                phone_number: phoneNumber,
                room_name: '',
                campaign_id: campaignId || '',
                campaign_name: '',
                metadata: {},
                model_provider: '',
                voice_id: '',
                scheduled_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
                ...(sheets_meta ? { sheets_meta } : {}),
            });
            return true;
        }
    } catch { /* Redis/queue unavailable */ }

    // Fallback: schedule via dispatch API after delay using setTimeout
    setTimeout(async () => {
        try {
            const baseUrl = process.env.DASHBOARD_WEBHOOK_URL?.replace('/api/calls/webhook', '') || 'http://localhost:3000';
            await fetch(`${baseUrl}/api/dispatch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phoneNumber,
                    campaignId,
                }),
            });
        } catch (e) {
            console.error('[Webhook] Retry dispatch failed:', e);
        }
    }, delaySeconds * 1000);

    return true;
}

// ── Google Sheets helpers ─────────────────────────────────────────────────────

async function tryWriteSheetDisposition(
    roomName: string,
    disposition: string,
    details: { notes?: string; sentiment?: string; durationSeconds?: number; turnCount?: number }
): Promise<void> {
    try {
        const { getSheetsMeta, writeDisposition, isValidDisposition } = await import('@/lib/google-sheets');
        const meta = await getSheetsMeta(roomName);
        if (!meta) return; // not a sheets-backed call

        const safeDisp = isValidDisposition(disposition)
            ? disposition
            : 'Not Verified';

        if (!isValidDisposition(disposition)) {
            console.warn(`[Webhook] Unknown disposition "${disposition}" for ${roomName} — defaulting to "Not Verified"`);
        }

        await writeDisposition(meta.sheet_id, meta.tab_name, meta.row_index, safeDisp, roomName, details);
        console.log(`[Webhook] Sheet row ${meta.row_index} (URN ${meta.urn}) → ${safeDisp} | sentiment=${details.sentiment} duration=${details.durationSeconds}s turns=${details.turnCount}`);

        // If Missed Call, trigger retry ladder
        if (safeDisp === 'Missed Call') {
            await tryScheduleSheetsRetry(roomName, undefined, undefined, meta);
        }
    } catch (e) {
        console.error('[Webhook] Failed to write sheet disposition:', e);
    }
}

async function tryScheduleSheetsRetry(
    roomName: string,
    phoneNumber?: string,
    campaignId?: string,
    existingMeta?: any
): Promise<void> {
    try {
        const { getSheetsMeta, writeDispositionSentinel } = await import('@/lib/google-sheets');
        const meta = existingMeta || await getSheetsMeta(roomName);
        if (!meta) return;

        const campaign = getCampaignById(meta.campaign_id || campaignId || '');
        const retryLadder = campaign?.retry_ladder;
        const maxAttempts = retryLadder?.max_attempts || 4;

        if (meta.attempt_count >= maxAttempts) {
            console.log(`[Webhook] URN ${meta.urn} reached max attempts (${maxAttempts}). No more retries.`);
            return;
        }

        const stepIndex = meta.attempt_count - 1; // attempt 1 → step 0
        const step = retryLadder?.on_missed_call?.[stepIndex];
        const delayMinutes = step?.delay_minutes || 120;
        const rawTargetMs = Date.now() + delayMinutes * 60 * 1000;
        const dnd = campaign?.dnd_window_ist || { start_hour: 21, end_hour: 9 };
        const targetMs = adjustForDnd(rawTargetMs, dnd.start_hour, dnd.end_hour);
        const delaySeconds = Math.round((targetMs - Date.now()) / 1000);

        // Write sentinel for the next attempt immediately (so the cron doesn't re-pick it)
        const newAttemptCount = meta.attempt_count + 1;
        await writeDispositionSentinel(meta.sheet_id, meta.tab_name, meta.row_index, newAttemptCount);

        // Carry sheets_meta forward in the retry job
        const updatedMeta = { ...meta, attempt_count: newAttemptCount };
        const scheduled = await tryScheduleRetry(
            phoneNumber || meta.urn, // phone is not stored in meta; use URN as fallback id
            meta.campaign_id || campaignId,
            delaySeconds,
            updatedMeta
        );

        if (scheduled) {
            console.log(`[Webhook] Retry ${newAttemptCount}/${maxAttempts} scheduled for URN ${meta.urn} in ${Math.round(delaySeconds / 60)}m`);
        }
    } catch (e) {
        console.error('[Webhook] Failed to schedule sheets retry:', e);
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { room_name, status, duration_seconds, outcome, error,
                disposition, sentiment, transcript_preview, turn_count, notes,
                campaign_id, phone_number, sip_status, reason, retry_delay_seconds } = body;

        if (!room_name) {
            return NextResponse.json({ error: 'room_name is required' }, { status: 400 });
        }

        // Handle post-call summary from agent
        if (status === 'summary') {
            const summaryUpdate: Record<string, any> = {};
            if (outcome) summaryUpdate.outcome = outcome;
            if (disposition) summaryUpdate.disposition = disposition;
            if (sentiment) summaryUpdate.sentiment = sentiment;
            if (transcript_preview) summaryUpdate.transcript_preview = transcript_preview;
            if (turn_count !== undefined) summaryUpdate.turn_count = turn_count;

            const log = await updateCallByRoom(room_name, summaryUpdate);

            // ── Google Sheets write-back ──────────────────────────────
            if (disposition) {
                await tryWriteSheetDisposition(room_name, disposition, {
                    notes: transcript_preview || notes || '',
                    sentiment: sentiment || '',
                    durationSeconds: duration_seconds,
                    turnCount: turn_count,
                });
            }

            return NextResponse.json({ success: true, summary_saved: true, log });
        }

        // Handle Missed Call retry for sheets-backed campaigns
        if (status === 'missed_call_sheets') {
            await tryScheduleSheetsRetry(room_name, phone_number, campaign_id);
            return NextResponse.json({ success: true });
        }

        // Handle retry request from agent (busy, no answer, timeout)
        if (status === 'retry') {
            const retryReason = reason || 'unknown';
            const sipCode = sip_status || 0;
            const delay = retry_delay_seconds || 300;

            // Mark current call as the SIP failure reason
            await updateCallByRoom(room_name, {
                status: 'failed',
                completed_at: new Date().toISOString(),
                error: error || `SIP ${sipCode}: ${retryReason}`,
                outcome: retryReason,
            });
            await tryTransitionState(room_name, 'failed', { error: `SIP ${sipCode}` });

            // For sheet-backed calls: write Missed Call to sheet + use sheets retry ladder.
            // This clears "Dialing…" from Col D so the row doesn't get stuck.
            let retryScheduled = false;
            try {
                const { getSheetsMeta } = await import('@/lib/google-sheets');
                const sheetsMeta = await getSheetsMeta(room_name);
                if (sheetsMeta) {
                    console.log(`[Webhook] SIP ${sipCode} on sheet-backed call (URN ${sheetsMeta.urn}) — writing Missed Call and scheduling via sheets ladder`);
                    await tryWriteSheetDisposition(room_name, 'Missed Call', {
                        notes: `SIP ${sipCode}: ${retryReason}`,
                        durationSeconds: 0,
                    });
                    retryScheduled = true;
                }
            } catch { /* Redis unavailable — fall through to standard retry */ }

            // Standard SIP retry for non-sheet calls
            if (!retryScheduled && phone_number && retryReason !== 'declined' && delay > 0) {
                retryScheduled = await tryScheduleRetry(phone_number, campaign_id, delay);
            }

            console.log(`[Webhook] SIP ${sipCode} (${retryReason}) for ${phone_number} — retry ${retryScheduled ? 'scheduled' : 'skipped'}`);

            return NextResponse.json({
                success: true,
                sip_status: sipCode,
                reason: retryReason,
                retry_scheduled: retryScheduled,
            });
        }

        // Update Redis state machine (non-blocking if Redis down)
        const stateExtra: any = {};
        if (duration_seconds !== undefined) stateExtra.duration_seconds = duration_seconds;
        if (error) stateExtra.error = error;
        const stateTransitioned = await tryTransitionState(room_name, status, stateExtra);

        // Update persistence (Airtable or file)
        const update: Record<string, any> = {};
        if (status === 'connected') {
            update.status = 'connected';
            update.connected_at = new Date().toISOString();
        } else if (status === 'completed') {
            update.status = 'completed';
            update.completed_at = new Date().toISOString();
            if (duration_seconds !== undefined) update.duration_seconds = duration_seconds;
            if (outcome) update.outcome = outcome;
        } else if (status === 'failed') {
            update.status = 'failed';
            update.completed_at = new Date().toISOString();
            if (error) update.error = error;
        }

        const log = await updateCallByRoom(room_name, update);

        return NextResponse.json({
            success: true,
            state_transitioned: stateTransitioned,
            log,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
