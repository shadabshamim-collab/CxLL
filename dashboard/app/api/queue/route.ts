import { NextResponse } from 'next/server';
import { agentDispatch } from '@/lib/server-utils';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { numbers, prompt } = body;

        if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
            return NextResponse.json({ error: "List of phone numbers is required" }, { status: 400 });
        }

        const results = [];

        for (const phoneNumber of numbers) {
            try {
                const roomName = `call-${phoneNumber.replace(/\+/g, '')}-${Math.floor(Math.random() * 10000)}`;

                const metadata = JSON.stringify({
                    phone_number: phoneNumber,
                    user_prompt: prompt || ""
                });

                const dispatch = await agentDispatch.createDispatch(roomName, "outbound-caller", {
                    metadata,
                });

                results.push({ phoneNumber, status: 'dispatched', id: dispatch.id });

                await new Promise(r => setTimeout(r, 200));

            } catch (e: any) {
                console.error(`Failed to dispatch ${phoneNumber}:`, e);
                results.push({ phoneNumber, status: 'failed', error: e.message });
            }
        }

        return NextResponse.json({
            success: true,
            message: `Processed ${numbers.length} numbers`,
            results
        });

    } catch (error: any) {
        console.error("Queue error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
