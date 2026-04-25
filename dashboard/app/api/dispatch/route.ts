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
        const {
            phoneNumber, prompt, modelProvider, voice, campaignId, scheduledAt,
            ttsProvider,          // optional: explicit TTS provider override (elevenlabs, sarvam, deepgram, openai)
            sttProvider,          // optional: explicit STT provider override (deepgram, elevenlabs)
            sheets_meta,          // optional: SheetsMeta from sheets-sync cron
            overrideSystemPrompt, // optional: {{user_name}}-substituted prompt
            overrideGreeting,     // optional: {{user_name}}-substituted greeting
        } = body;

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

            // Warn loudly if a Google Sheets campaign is dispatched without sheets_meta —
            // the call will go through but the sheet row will never be updated.
            const leadSource = (campaign as any).lead_source;
            if (leadSource?.type === 'google_sheets' && !sheets_meta) {
                console.warn(
                    `[Dispatch] WARNING: campaign "${campaign.id}" uses Google Sheets but sheets_meta` +
                    ` is missing. Sheet row will NOT be updated after this call. Use the sheets-sync` +
                    ` cron/UI to dispatch sheet-backed campaigns.`
                );
            }

            metadata = {
                ...metadata,
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                // Allow cron to pass {{user_name}}-substituted overrides
                system_prompt: overrideSystemPrompt || campaign.system_prompt,
                initial_greeting: overrideGreeting || campaign.initial_greeting,
                fallback_greeting: campaign.fallback_greeting,
                model_provider: modelProvider || campaign.model_provider,
                voice_id: voice || campaign.voice_id,
                // Voice & Tuning — per-campaign quality controls set in the campaign editor
                ...(campaign.vad_min_silence_duration != null ? { vad_min_silence_duration: campaign.vad_min_silence_duration } : {}),
                ...(campaign.llm_temperature != null ? { llm_temperature: campaign.llm_temperature } : {}),
                ...(campaign.max_completion_tokens != null ? { max_completion_tokens: campaign.max_completion_tokens } : {}),
                ...(campaign.stt_language ? { stt_language: campaign.stt_language } : {}),
                // Pass user_name so agent can reference it in post-call analysis
                ...(sheets_meta?.user_name ? { user_name: sheets_meta.user_name } : {}),
                // Embed sheets_meta in LiveKit metadata so agent echoes it back in every
                // webhook call — makes disposition write-back stateless (no Redis needed)
                ...(sheets_meta ? { sheets_meta: JSON.stringify(sheets_meta) } : {}),
            };
        } else {
            metadata = {
                ...metadata,
                user_prompt: prompt || '',
                model_provider: modelProvider || 'groq',
                voice_id: voice || 'aura-asteria-en',
                ...(ttsProvider ? { tts_provider: ttsProvider } : {}),
                ...(sttProvider ? { stt_provider: sttProvider } : {}),
            };
        }

        // For campaign dispatches, allow per-call TTS/STT overrides from the UI
        if (campaignId && (ttsProvider || sttProvider)) {
            if (ttsProvider) metadata.tts_provider = ttsProvider;
            if (sttProvider) metadata.stt_provider = sttProvider;
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

        // Store sheets_meta in Redis so the webhook can write the disposition back.
        if (sheets_meta) {
            try {
                const { storeSheetsMeta } = await import('@/lib/google-sheets');
                await storeSheetsMeta(roomName, sheets_meta);
            } catch { /* Redis unavailable — sheets disposition write will be skipped */ }
        }

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
