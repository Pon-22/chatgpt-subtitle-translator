#!/usr/bin/env node

import {
    loginChatGPT,
    logoutChatGPT,
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


        case "logout": {
            const result =
                await logoutChatGPT();

            if (
                result.alreadySignedOut
            ) {
                console.log(
                    "ChatGPT is already signed out."
                );

                break;
            }

            console.log(
                "ChatGPT signed out locally."
            );

            if (
                result.remoteRevocationConfirmed
            ) {
                console.log(
                    "Remote OAuth session revoked."
                );
            }
            else {
                console.warn(
                    "Remote OAuth revocation could not be confirmed."
                );

                if (result.warning) {
                    console.warn(
                        result.warning
                    );
                }
            }

            break;
        }


        case "status": {
            const profile =
                loadChatGPTProfile();

            if (!profile) {
                console.log(
                    "ChatGPT has never been connected."
                );

                break;
            }

            console.log(
                "Account:",
                profile.email ??
                profile.subject
            );

            console.log(
                "Client ID:",
                profile.client_id
            );

            const connected =
                Boolean(
                    profile.access_token &&
                    profile.refresh_token
                );

            if (!connected) {
                console.log(
                    "Status: signed out"
                );

                console.log(
                    "Registration retained: yes"
                );

                break;
            }

            console.log(
                "Status: connected"
            );

            console.log(
                "Plan usage:",
                profile.scopes.includes(
                    "chatgpt.tokens.use.direct"
                )
                    ? "enabled"
                    : "disabled"
            );

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
                    const expiresAt =
                        savedAt +
                        profile.expires_in *
                            1000;

                    const remainingSeconds =
                        Math.max(
                            0,
                            Math.floor(
                                (
                                    expiresAt -
                                    Date.now()
                                ) / 1000
                            )
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
                }
            }

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
                "  node cli/chatgpt-auth.mjs logout"
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

    console.error(
        error instanceof Error
            ? error.message
            : error
    );

    process.exitCode = 1;
}