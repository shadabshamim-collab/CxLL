import { NextResponse } from 'next/server';
import { agentDispatch } from '@/lib/server-utils';
import { getCampaignById } from '@/lib/campaigns';
import { logCallDispatched } from '@/lib/call-logger';

async function tryEnqueue(data: any): Promise<{ jobId: string } | null> {
    if (!process.env.REDIS_URL) return null;
    try {
        const { isRedisAvailable } = await import('@/lib/redis');
        if (!isRedisAvailable()) return null;
        const { enqueueCall } = await import('@/lib/call-queue');
        const jobId = await enqueueCall(data);
        return { jobId };
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phoneNumber, prompt, modelProvider, voice, campaignId, scheduledAt } = body;

        if (!phoneNumber) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }

        const trunkId = process.env.VOBIZ_SIP_TRUNK_ID;
        if (!trunkId) {
            return NextResponse.json({ error: 'SIP Trunk not configured' }, { status: 500 });
        }

        const roomName = `call-${phoneNumber.replace(/\+/g, '')}-${Math.floor(Math.random() * 10000)}`;

        let metadata: Record<string, string> = { phone_number: phoneNumber };
        let campaignName = 'Custom (No Campaign)';

        if (campaignId) {
            const campaign = getCampaignById(campaignId);
            if (!campaign) {
                return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
            }
            if (campaign.status !== 'active') {
                return NextResponse.json({ error: 'Campaign is inactive' }, { status: 400 });
            }
            campaignName = campaign.name;
            metadata = {
                ...metadata,
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                system_prompt: campaign.system_prompt,
                initial_greeting: campaign.initial_greeting,
                fallback_greeting: campaign.fallback_greeting,
                model_provider: modelProvider || campaign.model_provider,
                voice_id: voice || campaign.voice_id,
            };
        } else {
            metadata = {
                ...metadata,
                user_prompt: prompt || '',
                model_provider: modelProvider || 'groq',
                voice_id: voice || 'aura-asteria-en',
            };
        }

        // Try BullMQ queue (requires Redis)
        const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const queued = await tryEnqueue({
            call_id: callId,
            phone_number: phoneNumber,
            room_name: roomName,
            campaign_id: campaignId || 'custom',
            campaign_name: campaignName,
            metadata,
            model_provider: metadata.model_provider || 'groq',
            voice_id: metadata.voice_id || 'aura-asteria-en',
            scheduled_at: scheduledAt,
        });

        if (queued) {
            console.log(`[Dispatch] Enqueued call to ${phoneNumber} via BullMQ`);
            return NextResponse.json({
                success: true,
                callId,
                roomName,
                jobId: queued.jobId,
                mode: 'queued',
                campaignId: campaignId || null,
            });
        }

        // Fallback: direct LiveKit dispatch (no Redis)
        console.log(`[Dispatch] Direct dispatch to ${phoneNumber} (Redis unavailable)`);

        const dispatch = await agentDispatch.createDispatch(roomName, 'outbound-caller', {
            metadata: JSON.stringify(metadata),
        });

        logCallDispatched({
            campaign_id: campaignId || 'custom',
            campaign_name: campaignName,
            phone_number: phoneNumber,
            room_name: roomName,
            model_provider: metadata.model_provider || 'groq',
            voice_id: metadata.voice_id || 'aura-asteria-en',
        });

        return NextResponse.json({
            success: true,
            roomName,
            dispatchId: dispatch.id,
            mode: 'direct',
            campaignId: campaignId || null,
        });

    } catch (error: any) {
        console.error('[Dispatch] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
