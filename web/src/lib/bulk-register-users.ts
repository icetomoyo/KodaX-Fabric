export type ParsedRegisterUser = {
  name: string;
  phone: string;
  lineNo: number;
};

export type BulkRegisterParseResult = {
  users: ParsedRegisterUser[];
  errors: string[];
};

const HEADER_RE = /^(姓名|名字|name)\s*[,，\t ]\s*(手机号|电话|phone)$/i;
const MAX_BATCH = 200;

function splitNameAndPhone(value: string): { name: string; phone: string } | null {
  const tabIndex = value.indexOf("\t");
  const commaMatch = /[,，]/.exec(value);
  const separatorIndex = tabIndex >= 0 ? tabIndex : commaMatch?.index ?? -1;
  if (separatorIndex >= 0) {
    return {
      name: value.slice(0, separatorIndex).trim(),
      phone: value.slice(separatorIndex + 1).trim(),
    };
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    name: parts.slice(0, -1).join(" "),
    phone: parts[parts.length - 1] ?? "",
  };
}

export function parseBulkRegisterText(raw: string): BulkRegisterParseResult {
  const users: ParsedRegisterUser[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ value: line.trim(), lineNo: index + 1 }))
    .filter((line) => line.value.length > 0);

  for (const line of lines) {
    if (HEADER_RE.test(line.value)) continue;
    const parsed = splitNameAndPhone(line.value);
    if (!parsed) {
      errors.push(`第 ${line.lineNo} 行：请同时填写姓名和手机号`);
      continue;
    }
    const name = parsed.name.trim();
    const phone = parsed.phone.trim();
    if (!name) {
      errors.push(`第 ${line.lineNo} 行：姓名不能为空`);
      continue;
    }
    if (name.length > 100) {
      errors.push(`第 ${line.lineNo} 行：姓名不能超过 100 个字符`);
      continue;
    }
    if (phone.length < 5 || phone.length > 20) {
      errors.push(`第 ${line.lineNo} 行：手机号长度应为 5–20 个字符`);
      continue;
    }
    const previous = seen.get(phone);
    if (previous != null) {
      errors.push(`第 ${line.lineNo} 行：与第 ${previous} 行手机号重复`);
      continue;
    }
    seen.set(phone, line.lineNo);
    users.push({ name, phone, lineNo: line.lineNo });
  }

  if (users.length > MAX_BATCH) errors.push(`单次最多注册 ${MAX_BATCH} 人`);
  return { users, errors };
}
