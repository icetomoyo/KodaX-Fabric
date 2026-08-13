/** Normalize an unknown thrown value into a displayable message. */
export function errMsg(e: unknown, fallback = "出错了"): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
