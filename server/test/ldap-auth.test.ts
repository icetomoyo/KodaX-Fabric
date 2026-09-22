import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const {
  isSafeLdapUsername,
  ldapBindDns,
  matchEmployeeForLdapPerson,
  normalizeLdapBase,
  normalizeLdapMobile,
  personFromLdapEntry,
} = await import("../src/lib/ldap-auth.js");

test("LDAP bind DNs try cn then uid under People", () => {
  assert.equal(normalizeLdapBase("cn=*,ou=People,dc=haizhi,dc=com"), "ou=People,dc=haizhi,dc=com");
  assert.deepEqual(ldapBindDns("zhangchuang", "cn=*,ou=People,dc=haizhi,dc=com"), [
    "cn=zhangchuang,ou=People,dc=haizhi,dc=com",
    "uid=zhangchuang,ou=People,dc=haizhi,dc=com",
  ]);
});

test("LDAP usernames reject DN metacharacters", () => {
  assert.equal(isSafeLdapUsername("zhangchuang"), true);
  assert.equal(isSafeLdapUsername("cn=admin,dc=haizhi,dc=com"), false);
  assert.equal(isSafeLdapUsername("zhang chuang"), false);
});

test("LDAP person matches employee by mobile then unique display name", () => {
  const people = [
    { id: 1, name: "管理员", phone: "18612243416" },
    { id: 26, name: "张闯", phone: "17614030193" },
    { id: 163, name: "张闯A", phone: "18820260901" },
  ];
  assert.equal(
    matchEmployeeForLdapPerson(
      { dn: "x", uid: "zhaishidan", mail: null, displayName: "翟士丹", mobile: "18610318325" },
      [...people, { id: 222, name: "翟士丹", phone: "18610318325" }],
    )?.id,
    222,
  );
  assert.equal(
    matchEmployeeForLdapPerson(
      { dn: "x", uid: "zhangchuang", mail: "zhangchuang@haizhi.com", displayName: "张闯", mobile: null },
      people,
    )?.id,
    26,
  );
  assert.equal(
    matchEmployeeForLdapPerson(
      { dn: "x", uid: "unknown", mail: null, displayName: "路人", mobile: null },
      people,
    ),
    null,
  );
});

test("LDAP mobile strips +86", () => {
  assert.equal(normalizeLdapMobile("+86 186-1031-8325"), "18610318325");
});

test("LDAP entry parser reads uid mail and displayName", () => {
  const person = personFromLdapEntry("cn=zhangchuang,ou=People,dc=haizhi,dc=com", {
    uid: "zhangchuang",
    mail: "zhangchuang@haizhi.com",
    displayName: "张闯",
  });
  assert.equal(person.uid, "zhangchuang");
  assert.equal(person.mail, "zhangchuang@haizhi.com");
  assert.equal(person.displayName, "张闯");
  assert.equal(person.mobile, null);
});

test("login page exposes LDAP and account modes", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const login = readFileSync(resolve(root, "web/src/views/LoginView.vue"), "utf8");
  const auth = readFileSync(resolve(root, "server/src/routes/auth.ts"), "utf8");
  assert.match(login, /LDAP登录/);
  assert.match(login, /账户登录/);
  assert.match(login, /loginLdap/);
  assert.match(auth, /\/api\/auth\/login-ldap/);
  assert.match(auth, /provisionEmployeeFromLdapDingtalk/);
  assert.doesNotMatch(login, /Hz123456/);
});
