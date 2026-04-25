import { NextResponse } from 'next/server';
import { updateCallByRoom } from '@/lib/call-logger';

// Vobiz sends events for SIP call lifecycle. Log everything for debugging,
// and map known events to call state updates.
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const raw = body || {};

        // Log the full payload so we can see exactly what Vobiz sends
        console.log('[Vobiz Webhook] Received event:', JSON.stringify(raw, null, 2));

        // Vobiz event fields (field names may vary — adjust once you see real payloads)
        const eventType: string  = raw.event || raw.event_type || raw.type || '';
        const callId: string     = raw.call_id || raw.callId || raw.id || '';
        const from: string       = raw.from || raw.caller || raw.from_number || '';
        const to: string         = raw.to   || raw.callee || raw.to_number   || '';
        const sipCode: number    = parseInt(raw.sip_code || raw.sip_status || raw.response_code || '0', 10);
        const reason: string     = raw.reason || raw.sip_reason || raw.hangup_cause || '';
        const duration: number   = parseInt(raw.duration || raw.call_duration || '0', 10);

        // Try to match to a room by the "to" number (outbound calls dial out to `to`)
        // Room names follow the pattern call-<number>-<rand>
        const phoneDigits = to.replace(/\D/g, '');

        // Build status update based on event type
        const evt = eventType.toLowerCase();

        if (evt.includes('answer') || evt.includes('connected') || evt.includes('progress')) {
            // Call was answered — mark connected
            if (phoneDigits) {
                // Find the most recent call log for this number via the room name pattern
                console.log(`[Vobiz] Call answered: ${from} → ${to}`);
            }
        } else if (evt.includes('hangup') || evt.includes('ended') || evt.includes('complete')) {
            console.log(`[Vobiz] Call ended: ${from} → ${to}, SIP ${sipCode}, reason: ${reason}, duration: ${duration}s`);
        } else if (evt.includes('fail') || evt.includes('reject') || evt.includes('busy')) {
            console.log(`[Vobiz] Call failed: ${from} → ${to}, SIP ${sipCode}, reason: ${reason}`);
        } else if (evt.includes('ring') || evt.includes('ringing')) {
            console.log(`[Vobiz] Ringing: ${from} → ${to}`);
        }

        // Always return 200 so Vobiz doesn't retry
        return NextResponse.json({
            received: true,
            event: eventType,
            sip_code: sipCode,
        });

    } catch (error: any) {
        console.error('[Vobiz Webhook] Error:', error.message);
        return NextResponse.json({ received: true }, { status: 200 }); // Always 200 to Vobiz
    }
}

// Vobiz may also send GET to verify the endpoint is live
export async function GET() {
    return NextResponse.json({ status: 'ok', endpoint: 'vobiz-webhook' });
}
