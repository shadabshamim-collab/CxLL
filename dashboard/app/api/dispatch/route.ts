import { NextResponse } from 'next/server';
import { sipClient, agentDispatch } from '@/lib/server-utils';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phoneNumber, prompt, modelProvider, voice } = body;

        if (!phoneNumber) {
            return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
        }

        const trunkId = process.env.VOBIZ_SIP_TRUNK_ID;
        if (!trunkId) {
            console.error("VOBIZ_SIP_TRUNK_ID is missing in env");
            return NextResponse.json({ error: "SIP Trunk not configured" }, { status: 500 });
        }

        const roomName = `call-${phoneNumber.replace(/\+/g, '')}-${Math.floor(Math.random() * 10000)}`;

        console.log(`Dispatching call to ${phoneNumber} in room ${roomName} via trunk ${trunkId}`);

        const metadata = JSON.stringify({
            phone_number: phoneNumber,
            user_prompt: prompt || "",
            model_provider: modelProvider || "groq",
            voice_id: voice || "aura-asteria-en"
        });

        // 1. Dispatch the agent to the room (agent will join and handle the call)
        const dispatch = await agentDispatch.createDispatch(roomName, "outbound-caller", {
            metadata,
        });

        return NextResponse.json({
            success: true,
            roomName,
            dispatchId: dispatch.id
        });

    } catch (error: any) {
        console.error("Error dispatching call:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
