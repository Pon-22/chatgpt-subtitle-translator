#!/usr/bin/env node

import {
    createChatGPTResponse,
} from "../src/chatgptResponses.mjs";

import {
    listChatGPTModels,
} from "../src/chatgptOAuth.mjs";


const models =
    await listChatGPTModels();

if (models.length === 0) {
    throw new Error(
        "No ChatGPT models available."
    );
}

const preferredModel =
    process.argv[2] ??
    "gpt-5.6-sol";

const selected =
    models.find(
        model =>
            model.slug ===
            preferredModel
    );

if (!selected) {
    throw new Error(
        `Model ${preferredModel} is not available for this account.`
    );
}


const inputLines = [
    "今日はいい天気ですね。",
    "次の曲に行きたいと思います。",
    "本当にありがとうございます。",
];


/** @type {import("openai").OpenAI.Chat.ChatCompletionMessageParam[]} */
const messages = [
    {
        role: "system",
        content:
            "Translate Japanese to Traditional Chinese. " +
            "Preserve the meaning and natural spoken tone. " +
            "Return one translated output for each input.",
    },

    {
        role: "user",
        content:
            JSON.stringify({
                inputs:
                    inputLines,
            }),
    },
];

const translationFormat = {
    type: "json_schema",

    name:
        "translation_array",

    strict: true,

    schema: {
        type: "object",

        properties: {
            outputs: {
                type: "array",

                items: {
                    type: "string",
                },
            },
        },

        required: [
            "outputs",
        ],

        additionalProperties:
            false,
    },
};


console.log(
    `Model: ${selected.slug}`
);

console.log(
    "Sending structured translation..."
);

console.log("");


const result =
    await createChatGPTResponse({
        model:
            selected.slug,

        messages,

        textFormat:
            translationFormat,

        onDelta(text) {
            process.stdout.write(
                text
            );
        },
    });


console.log("");
console.log("");


const parsed =
    JSON.parse(
        result.text
    );


if (
    !Array.isArray(
        parsed.outputs
    )
) {
    throw new Error(
        "Structured response does not contain outputs[]."
    );
}


if (
    parsed.outputs.length !==
    inputLines.length
) {
    throw new Error(
        `Line mismatch: input=${inputLines.length}, output=${parsed.outputs.length}`
    );
}


console.log(
    "Parsed translations:"
);

for (
    let i = 0;
    i < inputLines.length;
    i++
) {
    console.log(
        `[${i + 1}]`
    );

    console.log(
        `JA: ${inputLines[i]}`
    );

    console.log(
        `ZH: ${parsed.outputs[i]}`
    );

    console.log("");
}


console.log(
    "Structured ChatGPT translation succeeded."
);