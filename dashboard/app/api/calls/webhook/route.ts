import { NextResponse } from 'next/server';
import { updateCallByRoom, logCallDispatched } from '@/lib/call-logger';

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

async function tryScheduleRetry(phoneNumber: string, campaignId: string | undefined, delaySeconds: number): Promise<boolean> {
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

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { room_name, status, duration_seconds, outcome, error,
                disposition, sentiment, transcript_preview, turn_count,
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
            return NextResponse.json({ success: true, summary_saved: true, log });
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

            // Schedule retry if not "declined"
            let retryScheduled = false;
            if (phone_number && retryReason !== 'declined' && delay > 0) {
                retryScheduled = await tryScheduleRetry(phone_number, campaign_id, delay);
            }

            console.log(`[Webhook] SIP ${sipCode} (${retryReason}) for ${phone_number} — retry ${retryScheduled ? `in ${delay}s` : 'skipped'}`);

            return NextResponse.json({
                success: true,
                sip_status: sipCode,
                reason: retryReason,
                retry_scheduled: retryScheduled,
                retry_delay_seconds: retryScheduled ? delay : 0,
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
