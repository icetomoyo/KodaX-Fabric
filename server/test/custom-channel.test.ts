import assert from "node:assert/strict";
import test from "node:test";
import { describeBulkCreateLocator } from "../src/lib/credential-bulk.js";
import {
  allocateCustomProductLineCode,
  mergeCustomProtocolConfigs,
  resolveCustomProtocolConfigs,
} from "../src/lib/custom-channel.js";
import {
  CUSTOM_PROVIDER_CODE,
  isCustomProvider,
  isTestableUpstreamUrl,
} from "../src/lib/provider-templates.js";

test("bulk create locator accepts custom independently of official templates", () => {
  assert.equal(
    describeBulkCreateLocator({ custom: true }),
    "custom",
  );
  assert.equal(
    describeBulkCreateLocator({
      providerCode: "glm",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    }),
    "template",
  );
  assert.equal(
    describeBulkCreateLocator({ productLineId: 1 }),
    "existing",
  );
  assert.equal(
    describeBulkCreateLocator({
      custom: true,
      productLineId: 1,
    }),
    "invalid",
  );
  assert.equal(
    describeBulkCreateLocator({
      custom: true,
      providerCode: "glm",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    }),
    "custom",
  );
  assert.equal(
    describeBulkCreateLocator({ providerCode: "glm" }),
    "invalid",
  );
  assert.equal(describeBulkCreateLocator({}), "invalid");
});

test("custom product line codes are unique opaque identifiers", () => {
  const codes = new Set(Array.from({ length: 20 }, () => allocateCustomProductLineCode()));
  assert.equal(codes.size, 20);
  for (const code of codes) {
    assert.match(code, /^c_[0-9a-f]{16}$/);
    assert.ok(code.length <= 64);
  }
});

test("custom channel updates reuse stored protocol URLs instead of a vendor template", () => {
  const stored = {
    openai_chat: {
      baseUrl: "http://10.10.20.241:8078/v1",
      authStyle: "bearer",
    },
  };
  const merged = mergeCustomProtocolConfigs(stored, undefined);
  assert.deepEqual(
    resolveCustomProtocolConfigs(merged, ["openai_chat"]),
    {
      ok: true,
      configs: {
        openai_chat: {
          baseUrl: "http://10.10.20.241:8078/v1",
          authStyle: "bearer",
        },
      },
    },
  );

  const withAnthropic = mergeCustomProtocolConfigs(stored, {
    anthropic_messages: {
      baseUrl: "http://10.10.20.241:8078/v1/",
      authStyle: "x-api-key",
    },
  });
  assert.deepEqual(
    resolveCustomProtocolConfigs(withAnthropic, ["openai_chat", "anthropic_messages"]),
    {
      ok: true,
      configs: {
        openai_chat: {
          baseUrl: "http://10.10.20.241:8078/v1",
          authStyle: "bearer",
        },
        anthropic_messages: {
          baseUrl: "http://10.10.20.241:8078/v1",
          authStyle: "x-api-key",
        },
      },
    },
  );
});

test("custom protocol configs require a URL and auth style for every selected protocol", () => {
  const configs = {
    openai_chat: {
      baseUrl: "https://gateway.example.test/v1/",
      authStyle: "bearer",
    },
  };

  assert.deepEqual(
    resolveCustomProtocolConfigs(configs, ["openai_chat"]),
    {
      ok: true,
      configs: {
        openai_chat: {
          baseUrl: "https://gateway.example.test/v1",
          authStyle: "bearer",
        },
      },
    },
  );
  assert.deepEqual(
    resolveCustomProtocolConfigs(configs, ["openai_chat", "anthropic_messages"]),
    {
      ok: false,
      reason: "protocol_unsupported",
      unsupportedProtocols: ["anthropic_messages"],
    },
  );
  assert.equal(resolveCustomProtocolConfigs(undefined, ["openai_chat"]).ok, false);
});

test("connectivity tests allow custom http(s) URLs but still lock GLM to official hosts", () => {
  assert.equal(isCustomProvider(CUSTOM_PROVIDER_CODE), true);
  assert.equal(
    isTestableUpstreamUrl("custom", "https://gateway.example.test/v1"),
    true,
  );
  assert.equal(
    isTestableUpstreamUrl("custom", "http://10.10.0.10:8080/v1"),
    true,
  );
  assert.equal(isTestableUpstreamUrl("custom", "ftp://gateway.example.test/v1"), false);
  assert.equal(
    isTestableUpstreamUrl("glm", "https://open.bigmodel.cn/api/coding/paas/v4"),
    true,
  );
  assert.equal(
    isTestableUpstreamUrl("glm", "https://gateway.example.test/v1"),
    false,
  );
});
