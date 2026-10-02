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


const AUTHORIZE_URL =
    "https://auth.openai.com/api/accounts/authorize";

const TOKEN_URL =
    "https://auth.openai.com/api/accounts/oauth/token";

const JWKS_URL =
    "https://auth.openai.com/.well-known/jwks.json";

export const CHATGPT_RESOURCE =
    "https://api.openai.com/v1";

const SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    "chatgpt.tokens.use.direct",
].join(" ");

const APP_NAME =
    "ChatGPT Subtitle Translator";

export const CHATGPT_STORAGE_DIR = path.join(
    process.env.LOCALAPPDATA ?? os.homedir(),
    "chatgpt-subtitle-translator"
);

export const CHATGPT_HOST_FILE = path.join(
    CHATGPT_STORAGE_DIR,
    "chatgpt-host.json"
);

export const CHATGPT_PROFILE_FILE = path.join(
    CHATGPT_STORAGE_DIR,
    "chatgpt-profile.json"
);


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

/**
 * @typedef {Object} OAuthCallback
 * @property {string} code
 * @property {string | undefined} clientId
 * @property {string | undefined} scope
 */

/**
 * @typedef {Object} ChatGPTProfile
 * @property {string | undefined} email
 * @property {string} issuer
 * @property {string} subject
 * @property {string} client_id
 * @property {string} ext_agent_host_id
 * @property {string} id_token
 * @property {string} access_token
 * @property {string | undefined} refresh_token
 * @property {string} token_type
 * @property {number} expires_in
 * @property {number | undefined} earliest_refresh_at
 * @property {string[]} scopes
 * @property {string} saved_at
 */


function base64url(buffer) {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}


function randomValue(bytes = 32) {
    return base64url(
        crypto.randomBytes(bytes)
    );
}


function ensureStorageDir() {
    fs.mkdirSync(
        CHATGPT_STORAGE_DIR,
        { recursive: true }
    );
}


function writeJson(file, data) {
    ensureStorageDir();

    const temp =
        `${file}.${process.pid}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify(data, null, 2),
        {
            encoding: "utf8",
            mode: 0o600,
        }
    );

    try {
        fs.renameSync(temp, file);
    }
    catch {
        if (fs.existsSync(file)) {
            fs.rmSync(file);
        }

        fs.renameSync(temp, file);
    }
}


export function getOrCreateHostId() {
    ensureStorageDir();

    if (fs.existsSync(CHATGPT_HOST_FILE)) {
        const data = JSON.parse(
            fs.readFileSync(
                CHATGPT_HOST_FILE,
                "utf8"
            )
        );

        if (data.ext_agent_host_id) {
            return data.ext_agent_host_id;
        }
    }

    const hostId =
        `urn:uuid:${crypto.randomUUID()}`;

    writeJson(
        CHATGPT_HOST_FILE,
        {
            ext_agent_host_id: hostId,
        }
    );

    return hostId;
}


/**
 * @returns {ChatGPTProfile | null}
 */
export function loadChatGPTProfile() {
    if (!fs.existsSync(CHATGPT_PROFILE_FILE)) {
        return null;
    }

    return /** @type {ChatGPTProfile} */ (
        JSON.parse(
            fs.readFileSync(
                CHATGPT_PROFILE_FILE,
                "utf8"
            )
        )
    );
}


/**
 * @param {ChatGPTProfile} profile
 */
function saveChatGPTProfile(profile) {
    writeJson(
        CHATGPT_PROFILE_FILE,
        profile
    );
}


function openBrowser(url) {
    let command;
    let args;

    if (process.platform === "win32") {
        command = "rundll32";
        args = [
            "url.dll,FileProtocolHandler",
            url,
        ];
    }
    else if (
        process.platform === "darwin"
    ) {
        command = "open";
        args = [url];
    }
    else {
        command = "xdg-open";
        args = [url];
    }

    const child = spawn(
        command,
        args,
        {
            detached: true,
            stdio: "ignore",
        }
    );

    child.unref();
}


/**
 * @param {string} expectedState
 * @returns {Promise<{
 *   redirectUri: string,
 *   result: Promise<OAuthCallback>
 * }>}
 */
async function createCallbackListener(
    expectedState
) {
    /** @type {(value: OAuthCallback) => void} */
    let resolveResult = () => {};

    /** @type {(reason?: any) => void} */
    let rejectResult = () => {};

    /** @type {Promise<OAuthCallback>} */
    const result = new Promise(
        (resolve, reject) => {
            resolveResult = resolve;
            rejectResult = reject;
        }
    );

    const server = http.createServer(
        (req, res) => {
            try {
                const requestUrl =
                    new URL(
                        req.url ?? "/",
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
                    requestUrl.searchParams.get(
                        "state"
                    );

                if (state !== expectedState) {
                    res.writeHead(400);
                    res.end(
                        "OAuth state mismatch."
                    );

                    rejectResult(
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
                        "Authorization failed."
                    );

                    rejectResult(
                        new Error(
                            `${error}: ${
                                description ?? ""
                            }`
                        )
                    );

                    server.close();
                    return;
                }

                const code =
                    requestUrl.searchParams.get(
                        "code"
                    );

                if (!code) {
                    res.writeHead(400);
                    res.end(
                        "Missing authorization code."
                    );

                    rejectResult(
                        new Error(
                            "Missing OAuth code"
                        )
                    );

                    server.close();
                    return;
                }

                const clientId =
                    requestUrl.searchParams.get(
                        "client_id"
                    ) ?? undefined;

                const scope =
                    requestUrl.searchParams.get(
                        "scope"
                    ) ?? undefined;

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/html; charset=utf-8",
                    }
                );

                res.end(`
                    <!doctype html>
                    <html>
                    <body style="
                        font-family:sans-serif;
                        padding:40px
                    ">
                        <h2>Connected to ChatGPT</h2>
                        <p>
                            You can close this tab
                            and return to the terminal.
                        </p>
                    </body>
                    </html>
                `);

                resolveResult({
                    code,
                    clientId,
                    scope,
                });

                server.close();
            }
            catch (error) {
                rejectResult(error);
                server.close();
            }
        }
    );

    await new Promise(
        (resolve, reject) => {
            server.once(
                "error",
                reject
            );

            server.listen(
                {
                    port: 0,
                    host: "127.0.0.1",
                },
                () => resolve(undefined)
            );
        }
    );

    const address =
        server.address();

    if (
        !address ||
        typeof address === "string"
    ) {
        server.close();

        throw new Error(
            "Unable to obtain OAuth callback port."
        );
    }

    return {
        redirectUri:
            `http://127.0.0.1:${address.port}/auth/callback`,
        result,
    };
}


/**
 * @param {{
 *   code: string,
 *   clientId: string,
 *   verifier: string,
 *   redirectUri: string
 * }} params
 * @returns {Promise<OAuthTokenResponse>}
 */
async function exchangeAuthorizationCode(
    params
) {
    const body = new URLSearchParams({
        grant_type:
            "authorization_code",
        client_id:
            params.clientId,
        code:
            params.code,
        code_verifier:
            params.verifier,
        redirect_uri:
            params.redirectUri,
        resource:
            CHATGPT_RESOURCE,
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
        throw new Error(
            `OAuth token exchange failed (${
                response.status
            }): ${await response.text()}`
        );
    }

    return /** @type {OAuthTokenResponse} */ (
        await response.json()
    );
}


/**
 * @param {string} idToken
 * @param {string} clientId
 * @param {string} nonce
 */
async function verifyIdToken(
    idToken,
    clientId,
    nonce
) {
    const jwks =
        createRemoteJWKSet(
            new URL(JWKS_URL)
        );

    const { payload } =
        await jwtVerify(
            idToken,
            jwks,
            {
                issuer:
                    "https://auth.openai.com",
                audience:
                    clientId,
            }
        );

    if (
        payload.nonce !== nonce
    ) {
        throw new Error(
            "ID token nonce mismatch."
        );
    }

    if (
        typeof payload.sub !== "string"
    ) {
        throw new Error(
            "ID token does not contain a subject."
        );
    }

    return payload;
}


export async function loginChatGPT() {
    const existing =
        loadChatGPTProfile();

    const hostId =
        getOrCreateHostId();

    const state =
        randomValue();

    const nonce =
        randomValue();

    const verifier =
        randomValue(64);

    const challenge =
        base64url(
            crypto
                .createHash("sha256")
                .update(verifier)
                .digest()
        );

    const listener =
        await createCallbackListener(
            state
        );

    const returning =
        Boolean(existing?.client_id);

    const authorizationClientId =
        existing?.client_id ??
        "dynamic_agent_client";

    const authUrl =
        new URL(AUTHORIZE_URL);

    authUrl.searchParams.set(
        "client_id",
        authorizationClientId
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
        CHATGPT_RESOURCE
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
        "ext_agent_host_id",
        hostId
    );

    if (!returning) {
        authUrl.searchParams.set(
            "agent_name_hint",
            APP_NAME
        );
    }
    else {
        if (existing?.id_token) {
            authUrl.searchParams.set(
                "id_token_hint",
                existing.id_token
            );
        }

        if (existing?.email) {
            authUrl.searchParams.set(
                "login_hint",
                existing.email
            );
        }
    }

    console.log(
        "Opening ChatGPT authorization..."
    );

    openBrowser(
        authUrl.toString()
    );

    const callback =
        await listener.result;

    let issuedClientId;

    if (returning) {
        issuedClientId =
            existing.client_id;

        if (
            callback.clientId &&
            callback.clientId !==
                issuedClientId
        ) {
            throw new Error(
                "OAuth callback returned a different client ID."
            );
        }
    }
    else {
        if (!callback.clientId) {
            throw new Error(
                "Initial registration did not return an issued client ID."
            );
        }

        issuedClientId =
            callback.clientId;
    }

    const tokens =
        await exchangeAuthorizationCode({
            code:
                callback.code,
            clientId:
                issuedClientId,
            verifier,
            redirectUri:
                listener.redirectUri,
        });

    if (
        !tokens.access_token ||
        !tokens.id_token
    ) {
        throw new Error(
            "OAuth token response is incomplete."
        );
    }

    const identity =
        await verifyIdToken(
            tokens.id_token,
            issuedClientId,
            nonce
        );

    if (
        existing?.subject &&
        identity.sub !==
            existing.subject
    ) {
        throw new Error(
            "Returned ChatGPT account does not match the saved account."
        );
    }

    const scopes =
        String(tokens.scope ?? "")
            .split(/\s+/)
            .filter(Boolean);

    if (
        !scopes.includes(
            "chatgpt.tokens.use.direct"
        )
    ) {
        throw new Error(
            "ChatGPT plan usage was not granted."
        );
    }

    const email =
        typeof identity.email === "string"
            ? identity.email
            : undefined;

    /** @type {ChatGPTProfile} */
    const profile = {
        email,
        issuer:
            "https://auth.openai.com",
        subject:
            identity.sub,
        client_id:
            issuedClientId,
        ext_agent_host_id:
            hostId,
        id_token:
            tokens.id_token,
        access_token:
            tokens.access_token,
        refresh_token:
            tokens.refresh_token,
        token_type:
            tokens.token_type ??
            "Bearer",
        expires_in:
            tokens.expires_in ??
            3600,
        earliest_refresh_at:
            tokens.earliest_refresh_at,
        scopes,
        saved_at:
            new Date().toISOString(),
    };

    saveChatGPTProfile(
        profile
    );

    return profile;
}


/**
 * @param {ChatGPTProfile} profile
 * @returns {Promise<ChatGPTProfile>}
 */
async function refreshChatGPTProfile(
    profile
) {
    if (!profile.refresh_token) {
        throw new Error(
            "No ChatGPT refresh token is available. Sign in again."
        );
    }

    const body =
        new URLSearchParams({
            grant_type:
                "refresh_token",
            client_id:
                profile.client_id,
            refresh_token:
                profile.refresh_token,
            resource:
                CHATGPT_RESOURCE,
        });

    const response =
        await fetch(
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
        throw new Error(
            `ChatGPT token refresh failed (${
                response.status
            }): ${await response.text()}`
        );
    }

    const tokens =
        /** @type {OAuthTokenResponse} */ (
            await response.json()
        );

    if (!tokens.access_token) {
        throw new Error(
            "Refresh response has no access token."
        );
    }

    const scopes =
        tokens.scope
            ? tokens.scope
                .split(/\s+/)
                .filter(Boolean)
            : profile.scopes;

    /** @type {ChatGPTProfile} */
    const updated = {
        ...profile,

        access_token:
            tokens.access_token,

        refresh_token:
            tokens.refresh_token ??
            profile.refresh_token,

        id_token:
            tokens.id_token ??
            profile.id_token,

        token_type:
            tokens.token_type ??
            profile.token_type,

        expires_in:
            tokens.expires_in ??
            3600,

        earliest_refresh_at:
            tokens.earliest_refresh_at,

        scopes,

        saved_at:
            new Date().toISOString(),
    };

    saveChatGPTProfile(
        updated
    );

    return updated;
}


function accessTokenStillValid(
    profile,
    minimumSeconds = 120
) {
    const saved =
        Date.parse(
            profile.saved_at
        );

    if (!Number.isFinite(saved)) {
        return false;
    }

    const expiresAt =
        saved +
        profile.expires_in * 1000;

    return (
        Date.now() +
            minimumSeconds * 1000
        <
        expiresAt
    );
}


export async function getChatGPTAccessToken() {
    let profile =
        loadChatGPTProfile();

    if (!profile) {
        throw new Error(
            "ChatGPT is not connected. Run the login command first."
        );
    }

    if (
        !profile.scopes.includes(
            "chatgpt.tokens.use.direct"
        )
    ) {
        throw new Error(
            "Saved profile does not have ChatGPT plan usage permission."
        );
    }

    if (
        !accessTokenStillValid(
            profile
        )
    ) {
        profile =
            await refreshChatGPTProfile(
                profile
            );
    }

    return profile.access_token;
}


export async function listChatGPTModels() {
    const accessToken =
        await getChatGPTAccessToken();

    const response =
        await fetch(
            `${CHATGPT_RESOURCE}/models`,
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`,
                },
            }
        );

    if (!response.ok) {
        throw new Error(
            `Could not list ChatGPT models (${
                response.status
            }): ${await response.text()}`
        );
    }

    /** @type {{
     * models?: Array<{
     *   slug: string,
     *   display_name?: string,
     *   visibility?: string
     * }>
     * }} */
    const catalog =
        await response.json();

    return (
        catalog.models ?? []
    ).filter(
        model =>
            model.visibility === "list"
    );
}