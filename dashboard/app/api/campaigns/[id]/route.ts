import { NextResponse } from 'next/server';
import { getCampaignById, updateCampaign, deleteCampaign, restoreVersion } from '@/lib/campaigns';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const campaign = getCampaignById(id);
        if (!campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        }
        return NextResponse.json({ campaign });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await request.json();

        if (body.restore_version) {
            const campaign = restoreVersion(id, body.restore_version);
            if (!campaign) {
                return NextResponse.json({ error: 'Campaign or version not found' }, { status: 404 });
            }
            return NextResponse.json({ campaign });
        }

        const { change_note, changed_by, ...data } = body;
        const campaign = updateCampaign(id, data, change_note, changed_by);
        if (!campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        }
        return NextResponse.json({ campaign });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const success = deleteCampaign(id);
        if (!success) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, message: 'Campaign set to inactive' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
