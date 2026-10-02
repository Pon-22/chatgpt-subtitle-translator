import {
    NextResponse
} from "next/server";

import {
    listChatGPTModels,
} from "../../../../../../src/chatgptOAuth.mjs";


export const runtime =
    "nodejs";

export const dynamic =
    "force-dynamic";


export async function GET() {
    try {
        const models =
            await listChatGPTModels();

        return NextResponse.json({
            models:
                models.map(
                    model => ({
                        slug:
                            model.slug,

                        displayName:
                            model.display_name ??
                            model.slug,
                    })
                ),
        });
    }
    catch (error) {
        console.error(
            "[Web API] ChatGPT models:",
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
                status: 401,
            }
        );
    }
}