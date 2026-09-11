import assert from "node:assert/strict";
import test from "node:test";
import { channelDisplayName, formatChannelName } from "./channel-display.ts";

test("channel display name uses 公司/模型 and official GLM line titles", () => {
  assert.equal(formatChannelName("智谱", "GLM"), "智谱/GLM");
  assert.equal(formatChannelName("智谱", "智谱/GLM"), "智谱/GLM");
  assert.equal(
    channelDisplayName({
      providerCode: "glm",
      providerName: "智谱",
      productLineCode: "api",
      productLineName: "GLM",
    }),
    "智谱/GLM（国内版）",
  );
  assert.equal(
    channelDisplayName({
      providerCode: "glm",
      providerName: "智谱",
      productLineCode: "api_intl",
      productLineName: "随便写的名字",
    }),
    "智谱/GLM（国际版）",
  );
  assert.equal(
    channelDisplayName({
      providerCode: "glm",
      providerName: "智谱",
      productLineCode: "cn_abcd",
      productLineName: "国内A",
    }),
    "智谱/国内A",
  );
  assert.equal(
    channelDisplayName({
      providerCode: "glm",
      providerName: "智谱",
      productLineCode: "cn_efgh",
      productLineName: "智谱/GLM",
    }),
    "智谱/GLM",
  );
});
