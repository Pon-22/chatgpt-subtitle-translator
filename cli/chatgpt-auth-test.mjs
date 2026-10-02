import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
    createRemoteJWKSet,
    jwtVerify,
} from "jose";
import OpenAI from "openai";

const AUTHORIZE_URL =
    "https://auth.openai.com/api/accounts/authorize";

const TOKEN_URL =
    "https://auth.openai.com/api/accounts/oauth/token";

const JWKS_URL =
    "https://auth.openai.com/.well-known/jwks.json";

const RESOURCE =
    "https://api.openai.com/v1";

const SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    "chatgpt.tokens.use.direct",
].join(" ");

const APP_NAME = "ChatGPT Subtitle Translator";

/**
 * @typedef {Object} OAuthTokenResponse
 * @property {string} access_token
 * @property {string} [refresh_token]
 * @property {string} [id_token]
 * @property {string} [token_type]
 * @property {number} [expires_in]
 * @property {string} [scope]
 * @property {number} [earliest_refresh_at]
 */

const storageDir = path.join(
    process.env.LOCALAPPDATA ?? os.homedir(),
    "chatgpt-subtitle-translator"
);

const hostFile = path.join(storageDir, "chatgpt-host.json");

function base64url(buffer) {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function createRandomValue(bytes = 32) {
    return base64url(crypto.randomBytes(bytes));
}

function getHostId() {
    fs.mkdirSync(storageDir, { recursive: true });

    if (fs.existsSync(hostFile)) {
        const saved = JSON.parse(
            fs.readFileSync(hostFile, "utf8")
        );

        if (saved.ext_agent_host_id) {
            return saved.ext_agent_host_id;
        }
    }

    const hostId = `urn:uuid:${crypto.randomUUID()}`;

    fs.writeFileSync(
        hostFile,
        JSON.stringify(
            { ext_agent_host_id: hostId },
            null,
            2
        ),
        { encoding: "utf8", mode: 0o600 }
    );

    return hostId;
}

function openBrowser(url) {
    if (process.platform === "win32") {
        const child = spawn(
            "rundll32",
            ["url.dll,FileProtocolHandler", url],
            {
                detached: true,
                stdio: "ignore",
            }
        );

        child.unref();
        return;
    }

    if (process.platform === "darwin") {
        const child = spawn(
            "open",
            [url],
            {
                detached: true,
                stdio: "ignore",
            }
        );

        child.unref();
        return;
    }

    const child = spawn(
        "xdg-open",
        [url],
        {
            detached: true,
            stdio: "ignore",
        }
    );

    child.unref();
}



async function createCallbackListener(expectedState) {
    let callbackResolve;
    let callbackReject;

    const result = new Promise(
        (resolve, reject) => {
            callbackResolve = resolve;
            callbackReject = reject;
        }
    );

    const server = http.createServer((req, res) => {
        try {
            const requestUrl = new URL(
                req.url,
                `http://${req.headers.host}`
            );

            if (
                requestUrl.pathname !==
                "/auth/callback"
            ) {
                res.writeHead(404);
                res.end("Not found");
                return;
            }

            const state =
                requestUrl.searchParams.get("state");

            if (state !== expectedState) {
                res.writeHead(400, {
                    "Content-Type":
                        "text/plain; charset=utf-8",
                });

                res.end(
                    "OAuth state mismatch. You may close this window."
                );

                callbackReject(
                    new Error(
                        "OAuth state mismatch"
                    )
                );

                server.close();
                return;
            }

            const error =
                requestUrl.searchParams.get(
                    "error"
                );

            if (error) {
                const description =
                    requestUrl.searchParams.get(
                        "error_description"
                    );

                res.writeHead(400);
                res.end(
                    "Authorization was not completed."
                );

                callbackReject(
                    new Error(
                        `${error}: ${description ?? ""}`
                    )
                );

                server.close();
                return;
            }

            const code =
                requestUrl.searchParams.get("code");

            const clientId =
                requestUrl.searchParams.get(
                    "client_id"
                );

            const scope =
                requestUrl.searchParams.get(
                    "scope"
                );

            if (!code || !clientId) {
                res.writeHead(400);
                res.end(
                    "Missing authorization data."
                );

                callbackReject(
                    new Error(
                        "Missing code/client_id"
                    )
                );

                server.close();
                return;
            }

            res.writeHead(200, {
                "Content-Type":
                    "text/html; charset=utf-8",
            });

            res.end(`
                <!doctype html>
                <html>
                <body style="
                    font-family:sans-serif;
                    padding:40px
                ">
                    <h2>Connected to ChatGPT</h2>
                    <p>You can close this tab and return to the terminal.</p>
                </body>
                </html>
            `);

            callbackResolve({
                code,
                clientId,
                scope,
            });

            server.close();
        } catch (error) {
            callbackReject(error);
            server.close();
        }
    });

    await new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(
        {
            port: 0,
            host: "127.0.0.1",
        },
        () => resolve(undefined)
    );
    });

    const address = server.address();

    if (
        !address ||
        typeof address === "string"
    ) {
        throw new Error(
            "Unable to obtain callback port"
        );
    }

    return {
        redirectUri:
            `http://127.0.0.1:${address.port}/auth/callback`,
        result,
    };
}

async function exchangeCode({
    code,
    clientId,
    verifier,
    redirectUri,
}) {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: RESOURCE,
    });

    const response = await fetch(
        TOKEN_URL,
        {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded",
            },
            body,
        }
    );

    if (!response.ok) {
        const text = await response.text();

        throw new Error(
            `Token exchange failed (${response.status}): ${text}`
        );
    }

    return /** @type {OAuthTokenResponse} */ (
        await response.json()
    );
}

async function verifyIdToken(
    idToken,
    clientId,
    nonce
) {
    const jwks = createRemoteJWKSet(
        new URL(JWKS_URL)
    );

    const { payload } = await jwtVerify(
        idToken,
        jwks,
        {
            issuer: "https://auth.openai.com",
            audience: clientId,
        }
    );

    if (payload.nonce !== nonce) {
        throw new Error(
            "ID token nonce mismatch"
        );
    }

    return payload;
}

async function main() {
    const hostId = getHostId();

    const state = createRandomValue();
    const nonce = createRandomValue();

    const verifier = createRandomValue(64);

    const challenge = base64url(
        crypto
            .createHash("sha256")
            .update(verifier)
            .digest()
    );

    const listener =
        await createCallbackListener(state);

    const authUrl =
        new URL(AUTHORIZE_URL);

    authUrl.searchParams.set(
        "client_id",
        "dynamic_agent_client"
    );

    authUrl.searchParams.set(
        "response_type",
        "code"
    );

    authUrl.searchParams.set(
        "redirect_uri",
        listener.redirectUri
    );

    authUrl.searchParams.set(
        "scope",
        SCOPES
    );

    authUrl.searchParams.set(
        "resource",
        RESOURCE
    );

    authUrl.searchParams.set(
        "state",
        state
    );

    authUrl.searchParams.set(
        "nonce",
        nonce
    );

    authUrl.searchParams.set(
        "code_challenge",
        challenge
    );

    authUrl.searchParams.set(
        "code_challenge_method",
        "S256"
    );

    authUrl.searchParams.set(
        "agent_name_hint",
        APP_NAME
    );

    authUrl.searchParams.set(
        "ext_agent_host_id",
        hostId
    );

    console.log(
        "Opening ChatGPT authorization in your browser..."
    );

    console.log(
        "Callback:",
        listener.redirectUri
    );

    openBrowser(authUrl.toString());

    const callback =
        await listener.result;

    console.log(
        "Authorization code received."
    );

    const tokens =
        await exchangeCode({
            code: callback.code,
            clientId: callback.clientId,
            verifier,
            redirectUri:
                listener.redirectUri,
        });

    if (!tokens.id_token) {
        throw new Error(
            "OAuth token response did not contain an ID token"
        );
    }

    const identity =
        await verifyIdToken(
            tokens.id_token,
            callback.clientId,
            nonce
        );

    const grantedScopes =
        String(tokens.scope ?? callback.scope ?? "")
            .split(/\s+/)
            .filter(Boolean);

    if (
        !grantedScopes.includes(
            "chatgpt.tokens.use.direct"
        )
    ) {
        throw new Error(
            "ChatGPT plan usage was not granted."
        );
    }

    console.log("");
    console.log("ChatGPT OAuth success.");
    console.log(
        "Account:",
        identity.email ??
        identity.name ??
        identity.sub
    );

    console.log(
        "ChatGPT plan usage: enabled"
    );

    console.log(
        "OAuth access token received successfully."
    );

    console.log("");
    console.log("Fetching available ChatGPT models...");

    const modelsResponse = await fetch(
        "https://api.openai.com/v1/models",
        {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        }
    );

    if (!modelsResponse.ok) {
        const text = await modelsResponse.text();

        throw new Error(
            `Model list failed (${modelsResponse.status}): ${text}`
        );
    }

    /** @type {{models?: Array<{
     * slug: string,
     * display_name?: string,
     * visibility?: string
     * }>}} */
    const modelCatalog = await modelsResponse.json();

    const availableModels = (modelCatalog.models ?? [])
        .filter(
            (model) =>
                !model.visibility ||
                model.visibility === "list"
        );

    if (availableModels.length === 0) {
        throw new Error(
            "No ChatGPT models are available for this account."
        );
    }

    console.log("");
    console.log("Available models:");

    for (const model of availableModels) {
        console.log(
            `- ${model.display_name ?? model.slug} (${model.slug})`
        );
    }

    const selectedModel = availableModels[0].slug;

    console.log("");
    console.log(
        `Testing Responses API with: ${selectedModel}`
    );

    const client = new OpenAI({
        apiKey: tokens.access_token,
        baseURL: "https://api.openai.com/v1",
        maxRetries: 0,
    });

    const stream = await client.responses.create({
        model: selectedModel,
        input: [
            {
                role: "user",
                content:
                    "Reply with exactly: ChatGPT OAuth works!",
            },
        ],
        store: false,
        stream: true,
    });

    let completed = false;

    console.log("");
    console.log("Response:");
    process.stdout.write("> ");

    for await (const event of stream) {
        if (
            event.type ===
            "response.output_text.delta"
        ) {
            process.stdout.write(event.delta);
        }

        if (event.type === "response.failed") {
            throw new Error(
                `Responses API failed: ${
                    event.response?.error?.code ??
                    "unknown_error"
                }`
            );
        }

        if (
            event.type ===
            "response.completed"
        ) {
            completed = true;
        }
    }

    console.log("");

    if (!completed) {
        throw new Error(
            "Response stream ended without response.completed."
        );
    }

    console.log("");
    console.log(
        "ChatGPT plan inference succeeded."
    );

    console.log(
        "Token is intentionally NOT printed or saved by this test."
    );
}

main().catch((error) => {
    console.error("");
    console.error(
        "ChatGPT OAuth failed:"
    );
    console.error(error);
    process.exitCode = 1;
});