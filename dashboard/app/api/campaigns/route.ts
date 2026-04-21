import { NextResponse } from 'next/server';
import { getAllCampaigns, createCampaign } from '@/lib/campaigns';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || undefined;
        const campaigns = getAllCampaigns(status);
        return NextResponse.json({ campaigns });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, description, system_prompt, initial_greeting, fallback_greeting, model_provider, voice_id, language, transfer_number, changed_by } = body;

        if (!name || !system_prompt) {
            return NextResponse.json({ error: 'Name and system_prompt are required' }, { status: 400 });
        }

        const campaign = createCampaign({
            name,
            description: description || '',
            system_prompt,
            initial_greeting: initial_greeting || '',
            fallback_greeting: fallback_greeting || '',
            model_provider: model_provider || 'groq',
            voice_id: voice_id || 'aura-asteria-en',
            language: language || 'en',
            transfer_number: transfer_number || '',
            changed_by: changed_by || 'system',
        });

        return NextResponse.json({ campaign }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
