import { createHmac, timingSafeEqual } from "node:crypto";
import { DINGTALK_CONTACT_API_BASE_URL } from "./dingtalk-department-tree.js";

export const DINGTALK_OAUTH_AUTHORIZE_URL = "https://login.dingtalk.com/oauth2/auth";
export const DINGTALK_LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
export const DINGTALK_LOGIN_CALLBACK_PATH = "/login/dingtalk";

type FetchImpl = typeof fetch;

export function buildDingtalkAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(DINGTALK_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", "openid corpid");
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "consent");
  return url.toString().replace(/scope=openid(\+|%20)corpid/, "scope=openid%20corpid");
}

export function dingtalkLoginRedirectUriFromOrigin(origin: string): string {
  return `${origin.replace(/\/$/, "")}${DINGTALK_LOGIN_CALLBACK_PATH}`;
}

export function isAllowedDingtalkRedirectUri(
  redirectUri: string,
  allowed: readonly string[],
): boolean {
  return allowed.includes(redirectUri);
}

export function createDingtalkLoginState(
  secret: string,
  now = Date.now(),
  employeeId?: number,
): string {
  const nonce = createHmac("sha256", secret).update(`n:${now}:${Math.random()}`).digest("hex").slice(0, 32);
  const boundId = boundEmployeeId(employeeId);
  const mac = signState(secret, nonce, now, boundId);
  const payload: { n: string; t: number; m: string; e?: number } = { n: nonce, t: now, m: mac };
  if (boundId) payload.e = boundId;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function readDingtalkLoginState(
  secret: string,
  state: string,
  now = Date.now(),
): { ok: false } | { ok: true; employeeId?: number } {
  if (!state) return { ok: false };
  let parsed: { n?: unknown; t?: unknown; m?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    return { ok: false };
  }
  const nonce = typeof parsed.n === "string" ? parsed.n : "";
  const issuedAt = typeof parsed.t === "number" ? parsed.t : Number.NaN;
  const mac = typeof parsed.m === "string" ? parsed.m : "";
  if (!nonce || !mac || !Number.isFinite(issuedAt)) return { ok: false };
  if (Math.abs(now - issuedAt) > DINGTALK_LOGIN_STATE_TTL_MS) return { ok: false };
  let employeeId: number | undefined;
  if (parsed.e !== undefined) {
    employeeId = boundEmployeeId(parsed.e);
    if (!employeeId) return { ok: false };
  }
  const expected = signState(secret, nonce, issuedAt, employeeId);
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return { ok: false };
  if (!timingSafeEqual(left, right)) return { ok: false };
  return employeeId ? { ok: true, employeeId } : { ok: true };
}

export function verifyDingtalkLoginState(secret: string, state: string, now = Date.now()): boolean {
  return readDingtalkLoginState(secret, state, now).ok;
}

function boundEmployeeId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function signState(secret: string, nonce: string, issuedAt: number, employeeId?: number): string {
  const extra = employeeId ? `.${employeeId}` : "";
  return createHmac("sha256", secret).update(`${nonce}.${issuedAt}${extra}`).digest("hex");
}

export type DingtalkUserAccessTokenResult =
  | { ok: true; accessToken: string; corpId: string | null }
  | { ok: false };

export async function exchangeDingtalkUserAccessToken(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<DingtalkUserAccessTokenResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DINGTALK_CONTACT_API_BASE_URL).replace(/\/$/, "");
  const response = await fetchImpl(new URL("/v1.0/oauth2/userAccessToken", `${baseUrl}/`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      code: options.code,
      grantType: "authorization_code",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await readJsonRecord(response);
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  if (!response.ok || !accessToken) return { ok: false };
  const corpId = typeof body?.corpId === "string" && body.corpId.trim() ? body.corpId.trim() : null;
  return { ok: true, accessToken, corpId };
}

export type DingtalkOauthContactMeResult =
  | { ok: true; unionId: string; nick: string; mobile: string | null }
  | { ok: false };

export async function fetchDingtalkOauthContactMe(options: {
  userAccessToken: string;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<DingtalkOauthContactMeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DINGTALK_CONTACT_API_BASE_URL).replace(/\/$/, "");
  const response = await fetchImpl(new URL("/v1.0/contact/users/me", `${baseUrl}/`), {
    method: "GET",
    headers: {
      "content-type": "application/json",
      "x-acs-dingtalk-access-token": options.userAccessToken,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await readJsonRecord(response);
  const unionId = typeof body?.unionId === "string" ? body.unionId.trim() : "";
  if (!response.ok || !unionId) return { ok: false };
  const nick = typeof body?.nick === "string" ? body.nick.trim() : "";
  const mobile = typeof body?.mobile === "string" && body.mobile.trim() ? body.mobile.trim() : null;
  return { ok: true, unionId, nick, mobile };
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
