import assert from "node:assert/strict";
import test from "node:test";
import {
  clientModelUpstreamName,
  parseClientModel,
} from "../src/lib/relay/client-model.js";

test("catalog aliases and prefixed names resolve to glm upstream models", () => {
  assert.deepEqual(parseClientModel("glm-5.3-flash"), {
    kind: "catalog",
    prefix: "glm",
    providerCode: "glm",
    canonicalId: "glm/glm-5.3-flash",
    upstreamModel: "glm-5.3-flash",
    fromAlias: true,
  });
  assert.deepEqual(parseClientModel("GLM/glm-5.3"), {
    kind: "catalog",
    prefix: "glm",
    providerCode: "glm",
    canonicalId: "glm/glm-5.3",
    upstreamModel: "glm-5.3",
    fromAlias: false,
  });
  assert.equal(clientModelUpstreamName("glm/glm-5.3-flash"), "glm-5.3-flash");
});

test("unknown prefixes keep the routing prefix and strip it for upstream", () => {
  const parsed = parseClientModel("haizhi/glm-5.3");
  assert.equal(parsed.kind, "prefixed");
  if (parsed.kind !== "prefixed") return;
  assert.equal(parsed.providerCode, "haizhi");
  assert.equal(parsed.upstreamModel, "glm-5.3");
});

test("unprefixed custom names stay legacy so existing keys keep working", () => {
  assert.deepEqual(parseClientModel("upstream-a-test"), {
    kind: "legacy",
    upstreamModel: "upstream-a-test",
  });
});
