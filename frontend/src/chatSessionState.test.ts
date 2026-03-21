import { expect, test } from "bun:test";
import { getBottomSlackPx, getUserMessageTopOffsetPx, MAX_USER_MESSAGE_TOP_OFFSET_PX, MIN_BOTTOM_SLACK_PX, MIN_USER_MESSAGE_TOP_OFFSET_PX } from "./chatSessionState";

test("getUserMessageTopOffsetPx respects minimum bound", () => {
  expect(getUserMessageTopOffsetPx(200)).toBe(MIN_USER_MESSAGE_TOP_OFFSET_PX);
});

test("getUserMessageTopOffsetPx scales within bounds", () => {
  expect(getUserMessageTopOffsetPx(500)).toBe(40);
});

test("getUserMessageTopOffsetPx respects maximum bound", () => {
  expect(getUserMessageTopOffsetPx(2000)).toBe(MAX_USER_MESSAGE_TOP_OFFSET_PX);
});

test("getBottomSlackPx respects minimum bound", () => {
  expect(getBottomSlackPx(200)).toBe(MIN_BOTTOM_SLACK_PX);
});

test("getBottomSlackPx scales above minimum", () => {
  expect(getBottomSlackPx(1000)).toBe(120);
});
