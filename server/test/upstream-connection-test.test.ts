import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUpstreamBusinessFailure,
  parseUpstreamBusinessFailure,
} from "../src/lib/upstream-connection-test.js";

test("HTTP-success GLM error envelopes remain connection failures", () => {
  const failure = parseUpstreamBusinessFailure({
    code: 401,
    msg: "令牌已过期或验证不正确",
    success: false,
  });

  assert.deepEqual(failure, {
    code: "401",
    message: "令牌已过期或验证不正确",
  });
  assert.equal(
    formatUpstreamBusinessFailure(failure!),
    "上游返回业务错误（401）：令牌已过期或验证不正确",
  );
});

test("ordinary successful model payloads are not business failures", () => {
  assert.equal(
    parseUpstreamBusinessFailure({ data: [{ id: "glm-5" }], success: true }),
    null,
  );
  assert.equal(parseUpstreamBusinessFailure({ data: [] }), null);
});
