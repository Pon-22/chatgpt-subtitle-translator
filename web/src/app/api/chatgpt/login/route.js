import {
    NextResponse
} from "next/server";

import {
    loginChatGPT,
} from "../../../../../../src/chatgptOAuth.mjs";


export const runtime =
    "nodejs";

export const dynamic =
    "force-dynamic";


export async function POST() {
    try {
        const profile =
            await loginChatGPT();

        return NextResponse.json({
            connected: true,

            email:
                profile.email ??
                null,

            planUsage:
                profile.scopes.includes(
                    "chatgpt.tokens.use.direct"
                ),
        });
    }
    catch (error) {
        console.error(
            "[Web API] ChatGPT login:",
            error
        );

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            {
                status: 500,
            }
        );
    }
}