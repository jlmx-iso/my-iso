// A local OpenID Connect provider standing in for Google sign-in: discovery,
// authorize (with a consent page), token, userinfo and JWKS. The app is
// pointed at it with GOOGLE_OAUTH_ISSUER_URL (src/auth.config.ts), which is
// honoured for loopback addresses only.
//
// Used by the Vitest sign-in tests (src/auth.signin.test.ts), and run by the
// end-to-end server (e2e/serve.mjs) as
//   node src/test/helpers/oidcStub.ts --port 8789 --client-id ID --client-secret SECRET
// with Node's own type stripping: keep it to erasable TypeScript (no enums,
// namespaces or parameter properties) and to `node:` modules and `jose`.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseArgs } from "node:util";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

export type OidcStubOptions = {
  clientId: string;
  clientSecret: string;
  /** Default 127.0.0.1. Loopback only: the stub is never reachable from outside. */
  host?: string;
  /** Default 0 (any free port). */
  port?: number;
};

export type OidcStubConsent = {
  email: string;
  /** What the ID token's `email_verified` says. Default true. */
  emailVerified?: boolean;
  familyName?: string;
  givenName: string;
};

export type OidcStub = {
  /** The issuer, exactly as its discovery document and ID tokens state it. */
  issuer: string;
  /** Method and path (no query) of every request the stub answered. */
  requests: string[];
  close: () => Promise<void>;
};

type PendingCode = {
  claims: Record<string, unknown>;
  codeChallenge: string;
  nonce: string | null;
  redirectUri: string;
  used: boolean;
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const KEY_ID = "oidc-stub-key";

/** A stable subject per address, as Google gives each account one. */
export function stubSubject(email: string): string {
  return `stub-${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 20)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The consent page: who to sign in as. Field names are the consent's keys. */
function consentPage(params: URLSearchParams): string {
  const hidden = [...params.entries()]
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Stub sign-in</title></head>
<body>
<h1>Sign in with the test provider</h1>
<form method="post" action="/authorize">
${hidden}
<label>Email <input name="email" type="email" required></label>
<label>First name <input name="given_name" value="Test"></label>
<label>Last name <input name="family_name" value="Member"></label>
<label><input name="email_verified" type="checkbox" value="true" checked> Email verified</label>
<button type="submit">Continue</button>
</form>
</body></html>`;
}

/**
 * Starts the provider. Codes are single use and bound to the redirect URI
 * and PKCE (S256) challenge of their request, which every authorization
 * request must carry; the client must authenticate with
 * its id and secret (HTTP Basic, as Auth.js does).
 */
export async function startOidcStub(options: OidcStubOptions): Promise<OidcStub> {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) throw new Error("The OIDC stub listens on loopback addresses only");

  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: KEY_ID, use: "sig" };
  const codes = new Map<string, PendingCode>();
  const accessTokens = new Map<string, Record<string, unknown>>();
  const requests: string[] = [];
  let issuer = "";

  function issueCode(params: URLSearchParams, consent: OidcStubConsent): string | { error: string } {
    if (params.get("client_id") !== options.clientId) return { error: "unauthorized_client" };
    if (params.get("response_type") !== "code") return { error: "unsupported_response_type" };
    const redirectUri = params.get("redirect_uri");
    if (!redirectUri) return { error: "invalid_request" };
    // PKCE is required, S256 only: Auth.js always sends it for Google.
    const challenge = params.get("code_challenge");
    if (!challenge || params.get("code_challenge_method") !== "S256") return { error: "invalid_request" };

    const email = consent.email.trim().toLowerCase();
    const code = randomBytes(16).toString("hex");
    codes.set(code, {
      claims: {
        email,
        email_verified: consent.emailVerified ?? true,
        family_name: consent.familyName,
        given_name: consent.givenName,
        name: [consent.givenName, consent.familyName].filter(Boolean).join(" "),
        sub: stubSubject(email),
      },
      codeChallenge: challenge,
      nonce: params.get("nonce"),
      redirectUri,
      used: false,
    });
    return code;
  }

  function redirectWithCode(res: ServerResponse, params: URLSearchParams, consent: OidcStubConsent) {
    const code = issueCode(params, consent);
    if (typeof code !== "string") return json(res, 400, code);
    const target = new URL(params.get("redirect_uri") ?? "");
    target.searchParams.set("code", code);
    const state = params.get("state");
    if (state) target.searchParams.set("state", state);
    res.writeHead(302, { Location: target.toString() });
    res.end();
  }

  async function token(req: IncomingMessage, res: ServerResponse) {
    const expected = `Basic ${btoa(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`)}`;
    if (req.headers.authorization !== expected) return json(res, 401, { error: "invalid_client" });

    const form = await readForm(req);
    if (form.get("grant_type") !== "authorization_code") return json(res, 400, { error: "unsupported_grant_type" });
    const pending = codes.get(form.get("code") ?? "");
    if (!pending || pending.used || pending.redirectUri !== form.get("redirect_uri")) {
      return json(res, 400, { error: "invalid_grant" });
    }
    if (s256(form.get("code_verifier") ?? "") !== pending.codeChallenge) {
      return json(res, 400, { error: "invalid_grant" });
    }
    pending.used = true;

    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({ ...pending.claims, ...(pending.nonce ? { nonce: pending.nonce } : {}) })
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(options.clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    const accessToken = randomBytes(16).toString("hex");
    accessTokens.set(accessToken, pending.claims);
    json(res, 200, {
      access_token: accessToken,
      expires_in: 3600,
      id_token: idToken,
      scope: "openid email profile",
      token_type: "Bearer",
    });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    requests.push(`${req.method ?? "GET"} ${url.pathname}`);
    const route = `${req.method ?? "GET"} ${url.pathname}`;

    const handle = async () => {
      switch (route) {
        case "GET /.well-known/openid-configuration":
          return json(res, 200, {
            authorization_endpoint: `${issuer}/authorize`,
            code_challenge_methods_supported: ["S256"],
            id_token_signing_alg_values_supported: ["RS256"],
            issuer,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            scopes_supported: ["openid", "email", "profile"],
            subject_types_supported: ["public"],
            token_endpoint: `${issuer}/token`,
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
            userinfo_endpoint: `${issuer}/userinfo`,
          });
        case "GET /authorize": {
          if (url.searchParams.get("client_id") !== options.clientId) {
            return json(res, 400, { error: "unauthorized_client" });
          }
          res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" });
          return res.end(consentPage(url.searchParams));
        }
        case "POST /authorize": {
          const form = await readForm(req);
          return redirectWithCode(res, form, {
            email: form.get("email") ?? "",
            emailVerified: form.get("email_verified") === "true",
            familyName: form.get("family_name") ?? undefined,
            givenName: form.get("given_name") ?? "",
          });
        }
        case "POST /token":
          return token(req, res);
        case "GET /userinfo": {
          const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
          const claims = accessTokens.get(bearer);
          return claims ? json(res, 200, claims) : json(res, 401, { error: "invalid_token" });
        }
        case "GET /jwks":
          return json(res, 200, { keys: [jwk] });
        default:
          return json(res, 404, { error: "not_found" });
      }
    };
    handle().catch(() => json(res, 500, { error: "server_error" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  issuer = `http://${host === "::1" ? "[::1]" : host}:${port}`;

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    issuer,
    requests,
  };
}

// Run as a program: listen until stopped, and print the issuer once ready.
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "client-id": { type: "string" },
      "client-secret": { type: "string" },
      port: { type: "string" },
    },
  });
  const stub = await startOidcStub({
    clientId: values["client-id"] ?? "",
    clientSecret: values["client-secret"] ?? "",
    port: Number(values.port ?? 0),
  });
  process.stdout.write(`${stub.issuer}\n`);
  const stop = () => void stub.close().then(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
