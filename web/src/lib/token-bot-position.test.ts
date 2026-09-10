import assert from "node:assert/strict";
import test from "node:test";
import {
  TOKEN_BOT_VIEW_MARGIN,
  boxToRightBottom,
  clampTokenBotPosition,
  moveTokenBotPosition,
  parseTokenBotPosition,
  tokenBotDragMoved,
} from "./token-bot-position.ts";

const viewport = {
  width: 96,
  height: 40,
  viewportWidth: 1000,
  viewportHeight: 800,
};

test("parseTokenBotPosition accepts finite right/bottom and rejects junk", () => {
  assert.deepEqual(parseTokenBotPosition('{"right":48,"bottom":24}'), { right: 48, bottom: 24 });
  assert.equal(parseTokenBotPosition(null), null);
  assert.equal(parseTokenBotPosition("{"), null);
  assert.equal(parseTokenBotPosition('{"right":"24","bottom":24}'), null);
  assert.equal(parseTokenBotPosition('{"right":null,"bottom":24}'), null);
});

test("clampTokenBotPosition keeps the widget inside the viewport margin", () => {
  assert.deepEqual(
    clampTokenBotPosition({ right: -40, bottom: -12, ...viewport }),
    { right: TOKEN_BOT_VIEW_MARGIN, bottom: TOKEN_BOT_VIEW_MARGIN },
  );
  assert.deepEqual(
    clampTokenBotPosition({ right: 9000, bottom: 9000, ...viewport }),
    {
      right: 1000 - 96 - TOKEN_BOT_VIEW_MARGIN,
      bottom: 800 - 40 - TOKEN_BOT_VIEW_MARGIN,
    },
  );
});

test("moveTokenBotPosition follows the pointer and stays on screen", () => {
  const origin = { right: 24, bottom: 24 };
  assert.deepEqual(moveTokenBotPosition(origin, 10, -20, viewport), { right: 14, bottom: 44 });
  assert.deepEqual(
    moveTokenBotPosition(origin, 400, 0, viewport),
    { right: TOKEN_BOT_VIEW_MARGIN, bottom: 24 },
  );
});

test("tokenBotDragMoved ignores jitter below the threshold", () => {
  assert.equal(tokenBotDragMoved(3, 3), false);
  assert.equal(tokenBotDragMoved(5, 0), true);
  assert.equal(tokenBotDragMoved(0, -5), true);
});

test("boxToRightBottom converts a layout rect into right/bottom offsets", () => {
  assert.deepEqual(
    boxToRightBottom({
      right: 1000 - 24,
      bottom: 800 - 24,
      viewportWidth: 1000,
      viewportHeight: 800,
    }),
    { right: 24, bottom: 24 },
  );
});
