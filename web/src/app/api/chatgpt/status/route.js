import {
    NextResponse
} from "next/server";

import {
    loadChatGPTProfile,
} from "../../../../../../src/chatgptOAuth.mjs";


export const runtime =
    "nodejs";

export const dynamic =
    "force-dynamic";


export async function GET() {
    try {
        const profile =
            loadChatGPTProfile();

        if (!profile) {
            return NextResponse.json({
                connected: false,
                registered: false,
                email: null,
                planUsage: false,
                expiresAt: null,
                expiresInSeconds: null,
            });
        }

        const connected =
            Boolean(
                profile.access_token &&
                profile.refresh_token
            );

        const planUsage =
            profile.scopes?.includes(
                "chatgpt.tokens.use.direct"
            ) ?? false;

        let expiresAt = null;
        let expiresInSeconds = null;

        if (
            profile.saved_at &&
            typeof profile.expires_in ===
                "number"
        ) {
            const savedAt =
                Date.parse(
                    profile.saved_at
                );

            if (
                Number.isFinite(
                    savedAt
                )
            ) {
                const expiresAtMs =
                    savedAt +
                    profile.expires_in *
                        1000;

                expiresAt =
                    new Date(
                        expiresAtMs
                    ).toISOString();

                expiresInSeconds =
                    Math.max(
                        0,
                        Math.floor(
                            (
                                expiresAtMs -
                                Date.now()
                            ) / 1000
                        )
                    );
            }
        }

        return NextResponse.json({
            connected,
            registered:
                Boolean(
                    profile.client_id
                ),

            email:
                profile.email ??
                null,

            planUsage,

            expiresAt,
            expiresInSeconds,
        });
    }
    catch (error) {
        console.error(
            "[Web API] ChatGPT status:",
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