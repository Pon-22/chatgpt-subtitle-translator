import {
    NextResponse
} from "next/server";

import {
    logoutChatGPT,
} from "../../../../../../src/chatgptOAuth.mjs";


export const runtime =
    "nodejs";

export const dynamic =
    "force-dynamic";


export async function POST() {
    try {
        const result =
            await logoutChatGPT();

        return NextResponse.json({
            success: true,

            alreadySignedOut:
                result.alreadySignedOut,

            remoteRevocationConfirmed:
                result
                    .remoteRevocationConfirmed,

            warning:
                result.warning ??
                null,
        });
    }
    catch (error) {
        console.error(
            "[Web API] ChatGPT logout:",
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