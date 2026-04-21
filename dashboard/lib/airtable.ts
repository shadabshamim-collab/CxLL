const BASE_URL = 'https://api.airtable.com/v0';

function getConfig() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) {
        throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set in .env');
    }
    return { apiKey, baseId };
}

export function isAirtableConfigured(): boolean {
    return !!(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID);
}

async function airtableFetch(path: string, init?: RequestInit): Promise<any> {
    const { apiKey, baseId } = getConfig();
    const url = `${BASE_URL}/${baseId}${path}`;

    const res = await fetch(url, {
        ...init,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });

    if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '30', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return airtableFetch(path, init);
    }

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Airtable ${res.status}: ${body}`);
    }

    if (res.status === 204) return null;
    return res.json();
}

export class AirtableTable<T extends Record<string, any>> {
    constructor(private tableName: string) {}

    private get encodedName() {
        return encodeURIComponent(this.tableName);
    }

    async list(options?: {
        filterByFormula?: string;
        sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
        maxRecords?: number;
        fields?: string[];
    }): Promise<Array<{ id: string; fields: T }>> {
        const params = new URLSearchParams();
        if (options?.filterByFormula) params.set('filterByFormula', options.filterByFormula);
        if (options?.maxRecords) params.set('maxRecords', String(options.maxRecords));
        if (options?.fields) {
            options.fields.forEach(f => params.append('fields[]', f));
        }
        if (options?.sort) {
            options.sort.forEach((s, i) => {
                params.set(`sort[${i}][field]`, s.field);
                if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
            });
        }

        const records: Array<{ id: string; fields: T }> = [];
        let offset: string | undefined;

        do {
            const p = new URLSearchParams(params);
            if (offset) p.set('offset', offset);
            const data = await airtableFetch(`/${this.encodedName}?${p}`);
            records.push(...data.records);
            offset = data.offset;
        } while (offset);

        return records;
    }

    async find(recordId: string): Promise<{ id: string; fields: T }> {
        return airtableFetch(`/${this.encodedName}/${recordId}`);
    }

    async findFirst(filterByFormula: string): Promise<{ id: string; fields: T } | null> {
        const results = await this.list({ filterByFormula, maxRecords: 1 });
        return results[0] || null;
    }

    async create(fields: Partial<T>): Promise<{ id: string; fields: T }> {
        return airtableFetch(`/${this.encodedName}`, {
            method: 'POST',
            body: JSON.stringify({ fields }),
        });
    }

    async createBatch(records: Array<{ fields: Partial<T> }>): Promise<Array<{ id: string; fields: T }>> {
        const results: Array<{ id: string; fields: T }> = [];
        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10);
            const data = await airtableFetch(`/${this.encodedName}`, {
                method: 'POST',
                body: JSON.stringify({ records: batch }),
            });
            results.push(...data.records);
        }
        return results;
    }

    async update(recordId: string, fields: Partial<T>): Promise<{ id: string; fields: T }> {
        return airtableFetch(`/${this.encodedName}/${recordId}`, {
            method: 'PATCH',
            body: JSON.stringify({ fields }),
        });
    }

    async updateBatch(records: Array<{ id: string; fields: Partial<T> }>): Promise<Array<{ id: string; fields: T }>> {
        const results: Array<{ id: string; fields: T }> = [];
        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10);
            const data = await airtableFetch(`/${this.encodedName}`, {
                method: 'PATCH',
                body: JSON.stringify({ records: batch }),
            });
            results.push(...data.records);
        }
        return results;
    }

    async destroy(recordId: string): Promise<void> {
        await airtableFetch(`/${this.encodedName}/${recordId}`, { method: 'DELETE' });
    }
}

// Pre-configured table instances
export const CallLogsTable = new AirtableTable<{
    call_id: string;
    campaign_id: string;
    campaign_name: string;
    phone_number: string;
    room_name: string;
    status: string;
    dispatched_at: string;
    connected_at: string;
    completed_at: string;
    duration_seconds: number;
    outcome: string;
    model_provider: string;
    voice_id: string;
    error: string;
    retry_count: number;
    scheduled_at: string;
}>('CallLogs');

export const CampaignsTable = new AirtableTable<{
    campaign_id: string;
    name: string;
    description: string;
    status: string;
    system_prompt: string;
    initial_greeting: string;
    fallback_greeting: string;
    model_provider: string;
    voice_id: string;
    language: string;
    transfer_number: string;
    current_version: number;
    created_at: string;
    updated_at: string;
}>('Campaigns');

export const CampaignVersionsTable = new AirtableTable<{
    campaign_id: string;
    version: number;
    system_prompt: string;
    initial_greeting: string;
    changed_by: string;
    changed_at: string;
    change_note: string;
}>('CampaignVersions');
