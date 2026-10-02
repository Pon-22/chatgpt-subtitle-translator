import { NextResponse } from "next/server";
import { OpenAI } from "openai";

import {
    TranslatorStructuredArray,
    CooldownContext,
} from "../../../../../src/browser.mjs";

import {
    getChatGPTAccessToken,
} from "../../../../../src/chatgptOAuth.mjs";

import {
    createChatGPTResponse,
} from "../../../../../src/chatgptResponses.mjs";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";


function jsonError(message, status = 400) {
    return NextResponse.json(
        {
            error: message,
        },
        {
            status,
        }
    );
}


export async function POST(request) {
    /** @type {TranslatorStructuredArray | null} */
    let translator = null;

    const abortTranslator = () => {
        try {
            translator?.abort();
        }
        catch {
            // Ignore abort cleanup errors.
        }
    };

    request.signal.addEventListener(
        "abort",
        abortTranslator,
        {
            once: true,
        }
    );

    try {
        const body = await request.json();

        const lines =
            Array.isArray(body.lines)
                ? body.lines.map(line => String(line))
                : [];

        const fromLanguage =
            typeof body.fromLanguage === "string"
                ? body.fromLanguage
                : "";

        const toLanguage =
            typeof body.toLanguage === "string" &&
            body.toLanguage.trim()
                ? body.toLanguage.trim()
                : "English";

        const systemInstruction =
            typeof body.systemInstruction === "string"
                ? body.systemInstruction.trim()
                : "";

        const model =
            typeof body.model === "string"
                ? body.model.trim()
                : "";

        const rawBatchSizes =
            Array.isArray(body.batchSizes)
                ? body.batchSizes
                : undefined;

        const batchSizes =
            rawBatchSizes
                ?.map(value => Number(value))
                .filter(
                    value =>
                        Number.isFinite(value) &&
                        value > 0
                );

        const requestedRateLimit =
            Number(body.rateLimit ?? 60);

        const rateLimit =
            Number.isFinite(requestedRateLimit)
                ? Math.min(
                    500,
                    Math.max(
                        1,
                        Math.floor(requestedRateLimit)
                    )
                )
                : 60;

        if (lines.length === 0) {
            return jsonError(
                "No subtitle lines were provided."
            );
        }

        if (!model) {
            return jsonError(
                "No ChatGPT model was selected."
            );
        }

        const accessToken =
            await getChatGPTAccessToken();

        const openai =
            new OpenAI({
                apiKey:
                    accessToken,

                baseURL:
                    "https://api.openai.com/v1",

                maxRetries:
                    0,
            });

        const cooler =
            new CooldownContext(
                rateLimit,
                60000,
                "ChatGPTAPI"
            );

        const services = {
            openai,

            chatgptResponse:
                createChatGPTResponse,

            cooler,

            // Responses API streaming happens on the server.
            // The first Web version returns the completed batch
            // as JSON rather than forwarding individual deltas.
            onStreamChunk:
                () => {},

            onStreamEnd:
                () => {},

            onClearLine:
                () => {},
        };

        const options = {
            useModerator:
                false,

            structuredMode:
                "array",

            useFullContext:
                2000,

            guardRepetition:
                10,

            ...(
                batchSizes &&
                batchSizes.length > 0
                    ? {
                        batchSizes,
                    }
                    : {}
            ),

            createChatCompletionRequest: {
                model,

                // ChatGPT plan Responses API requires
                // streaming. Unsupported Chat Completions
                // sampling fields are intentionally omitted.
                stream:
                    true,
            },
        };

        translator =
            new TranslatorStructuredArray(
                {
                    from:
                        fromLanguage,

                    to:
                        toLanguage,
                },
                services,
                options
            );

        if (systemInstruction) {
            translator.systemInstruction =
                systemInstruction;
        }

        const outputs = [];

        for await (
            const output of
            translator.translateLines(lines)
        ) {
            if (request.signal.aborted) {
                abortTranslator();

                return jsonError(
                    "Translation was aborted.",
                    499
                );
            }

            outputs.push(
                output.finalTransform
            );
        }

        if (
            outputs.length !==
            lines.length
        ) {
            return jsonError(
                `Translation line count mismatch: expected ${lines.length}, got ${outputs.length}.`,
                500
            );
        }

        return NextResponse.json({
            outputs,

            usage:
                translator.usage,

            rpm:
                translator.services
                    .cooler
                    ?.rate ??
                0,
        });
    }
    catch (error) {
        if (
            request.signal.aborted ||
            error?.name ===
                "AbortError"
        ) {
            return jsonError(
                "Translation was aborted.",
                499
            );
        }

        const errorMessage =
            error instanceof Error
                ? error.message
                : String(error);

        const errorCode =
            error?.code ??
            error?.error?.code ??
            error?.cause?.code;

        if (
            errorCode ===
                "subscription_sharing_usage_limit_exceeded" ||
            errorMessage.includes(
                "subscription_sharing_usage_limit_exceeded"
            )
        ) {
            return NextResponse.json(
                {
                    error:
                        "ChatGPT usage limit reached. Review your ChatGPT usage settings and try again after access is available.",

                    code:
                        "subscription_sharing_usage_limit_exceeded",

                    manageUsageUrl:
                        "https://chatgpt.com/settings/usage",
                },
                {
                    status: 429,
                }
            );
        }

        console.error(
            "[Web API] Translation:",
            error
        );

        return NextResponse.json(
            {
                error:
                    errorMessage,
            },
            {
                status: 500,
            }
        );
    }
    finally {
        request.signal.removeEventListener(
            "abort",
            abortTranslator
        );
    }
}