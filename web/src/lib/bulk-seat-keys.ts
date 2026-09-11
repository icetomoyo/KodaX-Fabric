export type ParsedSeatKey = {
  name: string;
  secret: string;
  lineNo: number;
};

export type BulkSeatKeyParseResult = {
  entries: ParsedSeatKey[];
  errors: string[];
};

const HEADER_RE = /^(姓名|名字|name)\s*[,，\t ]\s*(渠道\s*KEY|KEY|secret)$/i;
const MAX_BATCH = 200;
const SECRET_MIN = 8;
const SECRET_MAX = 4096;

function splitNameAndSecret(value: string): { name: string; secret: string } | null {
  const tabIndex = value.indexOf("\t");
  const commaMatch = /[,，]/.exec(value);
  const separatorIndex = tabIndex >= 0 ? tabIndex : commaMatch?.index ?? -1;
  if (separatorIndex >= 0) {
    return {
      name: value.slice(0, separatorIndex).trim(),
      secret: value.slice(separatorIndex + 1).trim(),
    };
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    name: parts.slice(0, -1).join(" "),
    secret: parts[parts.length - 1] ?? "",
  };
}

export function parseBulkSeatKeysText(raw: string): BulkSeatKeyParseResult {
  const entries: ParsedSeatKey[] = [];
  const errors: string[] = [];
  const seenNames = new Map<string, number>();
  const seenSecrets = new Map<string, number>();
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ value: line.trim(), lineNo: index + 1 }))
    .filter((line) => line.value.length > 0);

  for (const line of lines) {
    if (HEADER_RE.test(line.value)) continue;
    const parsed = splitNameAndSecret(line.value);
    if (!parsed) {
      errors.push(`第 ${line.lineNo} 行：请同时填写姓名和渠道 KEY`);
      continue;
    }
    const name = parsed.name.trim();
    const secret = parsed.secret.trim();
    if (!name) {
      errors.push(`第 ${line.lineNo} 行：姓名不能为空`);
      continue;
    }
    if (name.length > 100) {
      errors.push(`第 ${line.lineNo} 行：姓名不能超过 100 个字符`);
      continue;
    }
    if (secret.length < SECRET_MIN || secret.length > SECRET_MAX) {
      errors.push(`第 ${line.lineNo} 行：渠道 KEY 长度应为 ${SECRET_MIN}–${SECRET_MAX} 个字符`);
      continue;
    }
    const previousName = seenNames.get(name);
    if (previousName != null) {
      errors.push(`第 ${line.lineNo} 行：与第 ${previousName} 行姓名重复`);
      continue;
    }
    const previousSecret = seenSecrets.get(secret);
    if (previousSecret != null) {
      errors.push(`第 ${line.lineNo} 行：与第 ${previousSecret} 行渠道 KEY 重复`);
      continue;
    }
    seenNames.set(name, line.lineNo);
    seenSecrets.set(secret, line.lineNo);
    entries.push({ name, secret, lineNo: line.lineNo });
  }

  if (entries.length > MAX_BATCH) errors.push(`单次最多导入 ${MAX_BATCH} 把渠道 KEY`);
  return { entries, errors };
}

export function maskSeatKeySecret(secret: string): string {
  if (secret.length <= 4) return "••••";
  return `•••• ${secret.slice(-4)}`;
}
