import { NextResponse } from 'next/server';
import { agentDispatch } from '@/lib/server-utils';
import { getCampaignById } from '@/lib/campaigns';
import { logCallDispatched } from '@/lib/call-logger';

async function tryBulkEnqueue(jobs: any[], rate: number): Promise<string[] | null> {
    if (!process.env.REDIS_URL) return null;
    try {
        const { isRedisAvailable } = await import('@/lib/redis');
        if (!isRedisAvailable()) return null;
        const { enqueueBulk } = await import('@/lib/call-queue');
        return await enqueueBulk(jobs, rate);
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { numbers, prompt, campaignId, modelProvider, voice, ttsProvider, sttProvider, ratePerSecond } = body;

        if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
            return NextResponse.json({ error: 'List of phone numbers is required' }, { status: 400 });
        }

        let campaign = null;
        if (campaignId) {
            campaign = getCampaignById(campaignId);
            if (!campaign) {
                return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
            }
            if (campaign.status !== 'active') {
                return NextResponse.json({ error: 'Campaign is inactive' }, { status: 400 });
            }
        }

        // Build job data for each number
        const jobs = numbers.map((phoneNumber: string) => {
            const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const roomName = `call-${phoneNumber.replace(/\+/g, '')}-${Math.floor(Math.random() * 10000)}`;

            let metadata: Record<string, string> = { phone_number: phoneNumber };
            if (campaign) {
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
            if (ttsProvider) metadata.tts_provider = ttsProvider;
            if (sttProvider) metadata.stt_provider = sttProvider;

            return {
                call_id: callId,
                phone_number: phoneNumber,
                room_name: roomName,
                campaign_id: campaignId || 'custom',
                campaign_name: campaign?.name || 'Custom (No Campaign)',
                metadata,
                model_provider: metadata.model_provider || 'groq',
                voice_id: metadata.voice_id || 'aura-asteria-en',
            };
        });

        // Try BullMQ (requires Redis)
        const jobIds = await tryBulkEnqueue(jobs, ratePerSecond || 10);

        if (jobIds) {
            console.log(`[Queue] Enqueued ${jobs.length} calls via BullMQ`);
            return NextResponse.json({
                success: true,
                message: `Enqueued ${numbers.length} calls`,
                mode: 'queued',
                campaignId: campaignId || null,
                jobIds,
            });
        }

        // Fallback: direct sequential dispatch
        console.log(`[Queue] Direct dispatch for ${jobs.length} calls (Redis unavailable)`);
        const results = [];

        for (const job of jobs) {
            try {
                const dispatch = await agentDispatch.createDispatch(job.room_name, 'outbound-caller', {
                    metadata: JSON.stringify(job.metadata),
                });

                logCallDispatched({
                    campaign_id: job.campaign_id,
                    campaign_name: job.campaign_name,
                    phone_number: job.phone_number,
                    room_name: job.room_name,
                    model_provider: job.model_provider,
                    voice_id: job.voice_id,
                });

                results.push({ phoneNumber: job.phone_number, status: 'dispatched', id: dispatch.id });
                await new Promise(r => setTimeout(r, 200));
            } catch (e: any) {
                results.push({ phoneNumber: job.phone_number, status: 'failed', error: e.message });
            }
        }

        return NextResponse.json({
            success: true,
            message: `Processed ${numbers.length} numbers`,
            mode: 'direct',
            campaignId: campaignId || null,
            results,
        });

    } catch (error: any) {
        console.error('[Queue] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
