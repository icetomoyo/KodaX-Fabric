import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY = "unit-test-credential-secret";

const {
  EMPLOYEE_API_KEY_ENCRYPTION_PURPOSE,
  decryptEmployeeApiKey,
  encryptEmployeeApiKey,
  generateApiKey,
  hashApiKey,
} = await import("../src/lib/api-key.js");
const { decryptSecret, encryptSecret } = await import("../src/lib/crypto-secret.js");

test("employee API keys round-trip through purpose-scoped encryption", () => {
  const generated = generateApiKey();
  const encrypted = encryptEmployeeApiKey(generated.raw);

  assert.notEqual(encrypted, generated.raw);
  assert.equal(decryptEmployeeApiKey(encrypted, generated.hash), generated.raw);
});

test("purpose-scoped ciphertext cannot be decrypted under a different purpose", () => {
  const encrypted = encryptSecret("scoped secret", EMPLOYEE_API_KEY_ENCRYPTION_PURPOSE);

  assert.throws(() => decryptSecret(encrypted, "different-purpose:v1"));
});

test("employee API key decryption enforces hash and generated-key format binding", () => {
  const generated = generateApiKey();
  const encrypted = encryptEmployeeApiKey(generated.raw);
  const otherKey = generateApiKey();

  assert.throws(() => decryptEmployeeApiKey(encrypted, otherKey.hash));

  const malformed = "th_not-a-generated-token";
  const malformedEncrypted = encryptSecret(malformed, EMPLOYEE_API_KEY_ENCRYPTION_PURPOSE);
  assert.throws(() => decryptEmployeeApiKey(malformedEncrypted, hashApiKey(malformed)));
});

test("unscoped decryption remains compatible with legacy upstream ciphertext", () => {
  const legacyCiphertext =
    "AAECAwQFBgcICQoLT/gf0r8MMahWR9wzPFAmgSrKsQQRSYRqtNPiueLU7Z0Rk8xRvDw=";

  assert.equal(decryptSecret(legacyCiphertext), "legacy-upstream-secret");
});
