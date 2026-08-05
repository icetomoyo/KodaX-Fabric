import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectCredentialSecretDuplicates,
  shouldRejectExistingChannelForMetadataRequest,
} from "../src/lib/credential-bulk.js";

test("bulk credential duplicate inspection reports every duplicate input position", () => {
  assert.deepEqual(
    inspectCredentialSecretDuplicates(
      ["key-a", "key-b", "key-a", "key-c", "key-b"],
      [],
    ),
    {
      batchDuplicateIndexes: [1, 2, 3, 5],
      existingDuplicateIndexes: [],
    },
  );
});

test("bulk credential duplicate inspection reports matches in the existing channel", () => {
  assert.deepEqual(
    inspectCredentialSecretDuplicates(
      ["new-key", "existing-key", "other-existing-key"],
      ["existing-key", "other-existing-key"],
    ),
    {
      batchDuplicateIndexes: [],
      existingDuplicateIndexes: [2, 3],
    },
  );
});

test("bulk credential duplicate inspection never includes secret values in its result", () => {
  const secret = "do-not-leak-this-secret";
  const result = inspectCredentialSecretDuplicates([secret, secret], [secret]);

  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("metadata-bearing channel creation never falls through to an existing conflict row", () => {
  const creation = {
    providerCode: "glm",
    name: "GLM Coding Plan",
    status: "active",
  };

  assert.equal(
    shouldRejectExistingChannelForMetadataRequest(creation, false),
    true,
  );
  assert.equal(
    shouldRejectExistingChannelForMetadataRequest(creation, true),
    false,
  );
  assert.equal(
    shouldRejectExistingChannelForMetadataRequest({}, false),
    false,
  );
  assert.equal(
    shouldRejectExistingChannelForMetadataRequest(
      { productLineId: 42, name: "ignored by schema" },
      false,
    ),
    false,
  );
});
