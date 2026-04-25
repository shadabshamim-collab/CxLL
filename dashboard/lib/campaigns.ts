import fs from 'fs';
import path from 'path';

export interface CampaignVersion {
    version: number;
    system_prompt: string;
    initial_greeting: string;
    changed_by: string;
    changed_at: string;
    change_note: string;
}

export interface CampaignLeadSource {
    type: 'google_sheets' | 'csv' | 'api';
    sheet_id?: string;
    tab_name?: string;
    poll_interval_seconds?: number;
}

export interface RetryLadderStep {
    delay_minutes: number;
}

export interface CampaignRetryLadder {
    on_missed_call: RetryLadderStep[];
    max_attempts: number;
}

export interface Campaign {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'inactive';
    system_prompt: string;
    initial_greeting: string;
    fallback_greeting: string;
    model_provider: string;
    voice_id: string;
    language: string;
    transfer_number: string;
    created_at: string;
    updated_at: string;
    current_version: number;
    versions: CampaignVersion[];
    // Voice & Tuning — per-campaign quality controls
    vad_min_silence_duration?: number;  // 0.3 – 1.0s; how long agent waits after customer stops
    llm_temperature?: number;           // 0.1 – 0.9; lower = more scripted
    max_completion_tokens?: number;     // 200 – 2000; caps response length
    stt_language?: string;              // "en" | "hi" | "hi-en" | "auto"
    // Optional — only present on campaigns using Google Sheets as lead source
    lead_source?: CampaignLeadSource;
    retry_ladder?: CampaignRetryLadder;
    dnd_window_ist?: { start_hour: number; end_hour: number };
    max_concurrent_calls?: number;
    disposition_taxonomy?: string[];
}

const CAMPAIGNS_DIR = path.join(process.cwd(), '..', 'agent', 'campaigns');

function ensureDir() {
    if (!fs.existsSync(CAMPAIGNS_DIR)) {
        fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });
    }
}

function readCampaignFile(filePath: string): Campaign | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as Campaign;
    } catch {
        return null;
    }
}

function writeCampaignFile(campaign: Campaign) {
    ensureDir();
    const filePath = path.join(CAMPAIGNS_DIR, `${campaign.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(campaign, null, 2), 'utf-8');
}

export function getAllCampaigns(status?: string): Campaign[] {
    ensureDir();
    const files = fs.readdirSync(CAMPAIGNS_DIR).filter(f => f.endsWith('.json'));
    const campaigns: Campaign[] = [];

    for (const file of files) {
        const campaign = readCampaignFile(path.join(CAMPAIGNS_DIR, file));
        if (campaign) {
            if (status && campaign.status !== status) continue;
            campaigns.push(campaign);
        }
    }

    return campaigns.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCampaignById(id: string): Campaign | null {
    const filePath = path.join(CAMPAIGNS_DIR, `${id}.json`);
    return readCampaignFile(filePath);
}

function generateId(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 64);
}

function ensureUniqueId(baseId: string): string {
    let id = baseId;
    let counter = 1;
    while (fs.existsSync(path.join(CAMPAIGNS_DIR, `${id}.json`))) {
        id = `${baseId}-${counter}`;
        counter++;
    }
    return id;
}

export function createCampaign(data: {
    name: string;
    description: string;
    system_prompt: string;
    initial_greeting: string;
    fallback_greeting: string;
    model_provider: string;
    voice_id: string;
    language: string;
    transfer_number?: string;
    changed_by?: string;
}): Campaign {
    const now = new Date().toISOString();
    const id = ensureUniqueId(generateId(data.name));

    const campaign: Campaign = {
        id,
        name: data.name,
        description: data.description,
        status: 'active',
        system_prompt: data.system_prompt,
        initial_greeting: data.initial_greeting,
        fallback_greeting: data.fallback_greeting,
        model_provider: data.model_provider,
        voice_id: data.voice_id,
        language: data.language,
        transfer_number: data.transfer_number || '',
        created_at: now,
        updated_at: now,
        current_version: 1,
        versions: [
            {
                version: 1,
                system_prompt: data.system_prompt,
                initial_greeting: data.initial_greeting,
                changed_by: data.changed_by || 'system',
                changed_at: now,
                change_note: 'Initial version',
            },
        ],
    };

    writeCampaignFile(campaign);
    return campaign;
}

export function updateCampaign(
    id: string,
    data: Partial<Omit<Campaign, 'id' | 'created_at' | 'versions' | 'current_version'>>,
    changeNote?: string,
    changedBy?: string
): Campaign | null {
    const campaign = getCampaignById(id);
    if (!campaign) return null;

    const promptChanged =
        (data.system_prompt && data.system_prompt !== campaign.system_prompt) ||
        (data.initial_greeting && data.initial_greeting !== campaign.initial_greeting);

    if (promptChanged) {
        campaign.versions.push({
            version: campaign.current_version + 1,
            system_prompt: data.system_prompt || campaign.system_prompt,
            initial_greeting: data.initial_greeting || campaign.initial_greeting,
            changed_by: changedBy || 'system',
            changed_at: new Date().toISOString(),
            change_note: changeNote || 'Updated prompt',
        });
        campaign.current_version += 1;
    }

    Object.assign(campaign, data, { updated_at: new Date().toISOString() });
    writeCampaignFile(campaign);
    return campaign;
}

export function deleteCampaign(id: string): boolean {
    const campaign = getCampaignById(id);
    if (!campaign) return false;

    campaign.status = 'inactive';
    campaign.updated_at = new Date().toISOString();
    writeCampaignFile(campaign);
    return true;
}

export function duplicateCampaign(id: string, newName: string): Campaign | null {
    const source = getCampaignById(id);
    if (!source) return null;

    return createCampaign({
        name: newName,
        description: source.description,
        system_prompt: source.system_prompt,
        initial_greeting: source.initial_greeting,
        fallback_greeting: source.fallback_greeting,
        model_provider: source.model_provider,
        voice_id: source.voice_id,
        language: source.language,
        transfer_number: source.transfer_number,
        changed_by: 'system',
    });
}

export function restoreVersion(id: string, version: number): Campaign | null {
    const campaign = getCampaignById(id);
    if (!campaign) return null;

    const target = campaign.versions.find(v => v.version === version);
    if (!target) return null;

    return updateCampaign(
        id,
        {
            system_prompt: target.system_prompt,
            initial_greeting: target.initial_greeting,
        },
        `Restored from version ${version}`,
        'system'
    );
}
