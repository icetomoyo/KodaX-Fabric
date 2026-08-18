/**
 * Shared fetch wrapper. Every console API call goes through here.
 *
 * - `credentials: "include"` sends the `th_session` cookie on every request.
 * - Non-2xx responses are flattened into an `ApiError` carrying the backend's
 *   `{error: {code, message}}` shape so callers can render `err.message`.
 * - 401 responses notify subscribers (the auth store) so the app can bounce to
 *   the login page from a single place instead of every call site.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Called once by the auth provider so 401s can clear the session globally. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn;
}

function flattenError(data: unknown, statusText: string): { message: string; code?: string } {
  const err = (data as { error?: { message?: string; code?: string } | string } | null)?.error;
  if (typeof err === "string") return { message: err };
  if (err && typeof err === "object") {
    return { message: err.message || statusText, code: err.code };
  }
  return { message: statusText };
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiError("无法连接网关", 0);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const { message, code } = flattenError(data, res.statusText);
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(message || `HTTP ${res.status}`, res.status, code);
  }
  return data as T;
}
