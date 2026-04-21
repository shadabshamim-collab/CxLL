import { NextResponse } from 'next/server';
import { getCampaignById } from '@/lib/campaigns';
import { enqueueCall } from '@/lib/call-queue';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phoneNumber, campaignId, modelProvider, voice, scheduledAt } = body;

        if (!phoneNumber) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }
        if (!scheduledAt) {
            return NextResponse.json({ error: 'scheduledAt (ISO timestamp) is required' }, { status: 400 });
        }

        const scheduledTime = new Date(scheduledAt);
        if (isNaN(scheduledTime.getTime())) {
            return NextResponse.json({ error: 'Invalid scheduledAt timestamp' }, { status: 400 });
        }
        if (scheduledTime.getTime() < Date.now()) {
            return NextResponse.json({ error: 'scheduledAt must be in the future' }, { status: 400 });
        }

        const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const roomName = `call-${phoneNumber.replace(/\+/g, '')}-${Math.floor(Math.random() * 10000)}`;

        let metadata: Record<string, string> = { phone_number: phoneNumber };
        let campaignName = 'Custom (No Campaign)';

        if (campaignId) {
            const campaign = getCampaignById(campaignId);
            if (!campaign) {
                return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
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
                model_provider: modelProvider || 'groq',
                voice_id: voice || 'aura-asteria-en',
            };
        }

        const jobId = await enqueueCall({
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

        return NextResponse.json({
            success: true,
            callId,
            jobId,
            scheduledAt,
            phoneNumber,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
