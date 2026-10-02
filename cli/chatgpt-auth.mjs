#!/usr/bin/env node

import {
    loginChatGPT,
    loadChatGPTProfile,
    listChatGPTModels,
    CHATGPT_PROFILE_FILE,
} from "../src/chatgptOAuth.mjs";


const command =
    process.argv[2] ?? "status";


try {
    switch (command) {
        case "login": {
            const profile =
                await loginChatGPT();

            console.log("");
            console.log(
                "ChatGPT connected."
            );

            console.log(
                "Account:",
                profile.email ??
                profile.subject
            );

            console.log(
                "Plan usage: enabled"
            );

            console.log(
                "Credentials saved to:",
                CHATGPT_PROFILE_FILE
            );

            break;
        }

        case "status": {
            const profile =
                loadChatGPTProfile();

            const savedAt =
                Date.parse(profile.saved_at);

            const expiresAt =
                savedAt +
                profile.expires_in * 1000;

            const remainingSeconds =
                Math.max(
                    0,
                    Math.floor(
                        (expiresAt - Date.now()) / 1000
                    )
                );

            if (!profile) {
                console.log(
                    "ChatGPT is not connected."
                );
                break;
            }

            console.log(
                "ChatGPT connected."
            );

            console.log(
                "Account:",
                profile.email ??
                profile.subject
            );

            console.log(
                "Client ID:",
                profile.client_id
            );

            console.log(
                "Plan usage:",
                profile.scopes.includes(
                    "chatgpt.tokens.use.direct"
                )
                    ? "enabled"
                    : "disabled"
            );

            console.log(
                "Access token expires in:",
                `${remainingSeconds}s`
            );

            console.log(
                "Access token expires at:",
                new Date(
                    expiresAt
                ).toLocaleString()
            );

            break;
        }

        case "models": {
            const models =
                await listChatGPTModels();

            console.log(
                "Available ChatGPT models:"
            );

            for (
                const model of models
            ) {
                console.log(
                    `- ${
                        model.display_name ??
                        model.slug
                    } (${model.slug})`
                );
            }

            break;
        }

        default:
            console.error(
                "Usage:"
            );

            console.error(
                "  node cli/chatgpt-auth.mjs login"
            );

            console.error(
                "  node cli/chatgpt-auth.mjs status"
            );

            console.error(
                "  node cli/chatgpt-auth.mjs models"
            );

            process.exitCode = 1;
    }
}
catch (error) {
    console.error("");

    console.error(
        "ChatGPT authentication error:"
    );

    console.error(error);

    process.exitCode = 1;
}