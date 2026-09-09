type SupportErrorBody = {
  success?: false;
  message?: string;
  error?: { code?: string; message?: string };
};

export function readSupportErrorBody(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as SupportErrorBody;
  if (typeof record.error?.message === "string" && record.error.message.trim()) {
    return record.error.message;
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  return null;
}
