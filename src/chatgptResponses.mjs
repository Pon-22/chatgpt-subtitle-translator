import OpenAI from "openai";

import {
    getChatGPTAccessToken,
} from "./chatgptOAuth.mjs";


/**
 * Convert the Chat Completions-style messages currently used
 * by this project into Responses API input.
 *
 * System messages are moved to `instructions`, because
 * ChatGPT plan usage does not accept explicit system input items.
 *
 * @param {import("openai").OpenAI.Chat.ChatCompletionMessageParam[]} messages
 */
export function convertMessagesToResponsesInput(messages) {
    const instructions = [];
    const input = [];

    for (const message of messages) {
        if (message.role === "system") {
            if (typeof message.content === "string") {
                instructions.push(message.content);
            }

            continue;
        }

        if (
            message.role !== "user" &&
            message.role !== "assistant" &&
            message.role !== "developer"
        ) {
            throw new Error(
                `Unsupported message role for ChatGPT Responses API: ${message.role}`
            );
        }

        if (typeof message.content !== "string") {
            throw new Error(
                `Non-string message content is not supported yet (${message.role}).`
            );
        }

        input.push({
            role: message.role,
            content: message.content,
        });
    }

    return {
        instructions:
            instructions.length > 0
                ? instructions.join("\n\n")
                : undefined,

        input,
    };
}


/**
 * @typedef {Object} ChatGPTResponseResult
 * @property {string} text
 * @property {import("openai").OpenAI.Responses.Response | undefined} response
 * @property {AbortController} controller
 */


/**
 * Send one ChatGPT-plan Responses API request.
 *
 * @param {{
 *   model: string,
 *   messages: import("openai").OpenAI.Chat.ChatCompletionMessageParam[],
 *   textFormat?: object,
 *   onDelta?: (text: string) => void,
 *   shouldAbort?: (buffer: string) => string | boolean | null
 * }} options
 * @returns {Promise<ChatGPTResponseResult>}
 */
export async function createChatGPTResponse(options) {
    const accessToken =
        await getChatGPTAccessToken();

    const client =
        new OpenAI({
            apiKey: accessToken,
            baseURL:
                "https://api.openai.com/v1",
            maxRetries: 0,
        });

    const {
        instructions,
        input,
    } =
        convertMessagesToResponsesInput(
            options.messages
        );

    const controller =
        new AbortController();

    /** @type {any} */
    const stream =
    await client.responses.create(
        {
            model:
                options.model,

            input,

            store:
                false,

            stream:
                true,

            ...(instructions
                ? {
                    instructions,
                }
                : {}),

            ...(options.textFormat
                ? {
                    text: {
                        format:
                            options.textFormat,
                    },
                }
                : {}),
        },
        {
            signal:
                controller.signal,
        }
    );

    let text = "";
    let completedResponse;
    let completed = false;
    let repetitionPattern = null;

    for await (
        const event of stream
    ) {
        if (
            event.type ===
            "response.output_text.delta"
        ) {
            text += event.delta;

            options.onDelta?.(
                event.delta
            );

            if (
                options.shouldAbort
            ) {
                const detected =
                    options.shouldAbort(
                        text
                    );

                if (detected) {
                    repetitionPattern =
                        detected;

                    controller.abort();
                    break;
                }
            }

            continue;
        }

        if (
            event.type ===
            "response.failed"
        ) {
            const code =
                event.response
                    ?.error
                    ?.code ??
                "unknown_error";

            throw new Error(
                `ChatGPT Responses API failed: ${code}`
            );
        }

        if (
            event.type ===
            "response.incomplete"
        ) {
            throw new Error(
                "ChatGPT Responses API returned an incomplete response."
            );
        }

        if (
            event.type ===
            "response.completed"
        ) {
            completed = true;
            completedResponse =
                event.response;
        }
    }

    if (repetitionPattern) {
        throw new Error(
            `Repetition detected: ${repetitionPattern}`
        );
    }

    if (!completed) {
        throw new Error(
            "Response stream ended without response.completed."
        );
    }

    return {
        text,
        response:
            completedResponse,
        controller,
    };
}