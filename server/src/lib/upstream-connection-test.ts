export type UpstreamBusinessFailure = {
  code: string | null;
  message: string | null;
};

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Some compatible gateways return HTTP 200 for an authentication failure and
 * communicate failure only through a JSON envelope such as
 * `{ success: false, code: 401, msg: "..." }`.
 */
export function parseUpstreamBusinessFailure(
  payload: unknown,
): UpstreamBusinessFailure | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const object = payload as Record<string, unknown>;
  if (object.success !== false) return null;

  const error = object.error;
  const nestedErrorMessage = error && typeof error === "object" && !Array.isArray(error)
    ? nonEmptyText((error as Record<string, unknown>).message)
    : null;
  const code = typeof object.code === "number" || typeof object.code === "string"
    ? String(object.code)
    : null;
  return {
    code,
    message: nonEmptyText(object.msg)
      ?? nonEmptyText(object.message)
      ?? nonEmptyText(error)
      ?? nestedErrorMessage,
  };
}

export function formatUpstreamBusinessFailure(
  failure: UpstreamBusinessFailure,
): string {
  const code = failure.code ? `（${failure.code}）` : "";
  const detail = failure.message ? `：${failure.message.slice(0, 500)}` : "";
  return `上游返回业务错误${code}${detail}`;
}
