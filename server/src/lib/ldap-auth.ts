import { Client } from "ldapts";

export type LdapPerson = {
  dn: string;
  uid: string;
  mail: string | null;
  displayName: string | null;
  mobile: string | null;
};

export type LdapEmployeeMatch = {
  id: number;
  name: string;
  phone: string;
};

export function normalizeLdapBase(baseDn: string): string {
  return baseDn.trim().replace(/^cn=\*\s*,\s*/i, "");
}

export function isSafeLdapUsername(username: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(username.trim());
}

export function ldapBindDns(username: string, baseDn: string): string[] {
  const user = username.trim();
  const base = normalizeLdapBase(baseDn);
  return [`cn=${user},${base}`, `uid=${user},${base}`];
}

export function normalizeLdapMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let phone = raw.replace(/[^\d+]/g, "");
  if (phone.startsWith("+86")) phone = phone.slice(3);
  else if (phone.startsWith("86") && phone.length === 13) phone = phone.slice(2);
  return phone || null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  if (Buffer.isBuffer(value) && value.length) return value.toString("utf8").trim() || null;
  return null;
}

export function personFromLdapEntry(dn: string, entry: Record<string, unknown>): LdapPerson {
  return {
    dn,
    uid: firstString(entry.uid) || firstString(entry.cn) || "",
    mail: firstString(entry.mail),
    displayName: firstString(entry.displayName) || firstString(entry.sn),
    mobile: normalizeLdapMobile(firstString(entry.mobile) || firstString(entry.telephoneNumber)),
  };
}

export function matchEmployeeForLdapPerson(
  person: LdapPerson,
  employees: readonly LdapEmployeeMatch[],
): LdapEmployeeMatch | null {
  if (person.mobile) {
    const byPhone = employees.find((row) => row.phone === person.mobile);
    if (byPhone) return byPhone;
  }
  const name = person.displayName?.trim();
  if (!name) return null;
  const sameName = employees.filter((row) => row.name === name);
  if (sameName.length === 1) return sameName[0]!;
  return null;
}

export async function authenticateLdapUser(input: {
  username: string;
  password: string;
  url: string;
  baseDn: string;
}): Promise<LdapPerson | null> {
  if (!isSafeLdapUsername(input.username) || !input.password) return null;
  const attributes = ["uid", "cn", "mail", "displayName", "sn", "mobile", "telephoneNumber"];
  for (const dn of ldapBindDns(input.username, input.baseDn)) {
    const client = new Client({ url: input.url, connectTimeout: 5_000, timeout: 8_000 });
    try {
      await client.bind(dn, input.password);
      const { searchEntries } = await client.search(dn, {
        scope: "base",
        filter: "(objectClass=*)",
        attributes,
      });
      const raw = searchEntries[0] as Record<string, unknown> | undefined;
      if (!raw) continue;
      const person = personFromLdapEntry(dn, raw);
      if (person.uid) return person;
    } catch {
      // try the next DN
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
  return null;
}
