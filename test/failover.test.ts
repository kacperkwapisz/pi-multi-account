import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { classifyFailure, Cooldowns, DEFAULT_COOLDOWN_MS, nextAccount, parseResetAt } from "../src/failover.ts";
import { FAMILIES, slotFor } from "../src/families.ts";

const [anthropic] = FAMILIES;
const NOW = Date.parse("2026-10-08T18:00:00Z");
const error = (errorMessage: string): AssistantMessage =>
	({ role: "assistant", stopReason: "error", errorMessage, content: [], provider: "anthropic", model: "m" }) as unknown as AssistantMessage;

test("account limits and dead logins switch accounts; provider-wide trouble does not", () => {
	const cases: [string, ReturnType<typeof classifyFailure>][] = [
		["Claude AI usage limit reached|1791500000", "limit"],
		['429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}', "limit"],
		["You've hit your usage limit. Upgrade to Pro or try again in 2 hours 14 minutes.", "limit"],
		["subscription_sharing_usage_limit_exceeded", "limit"],
		["insufficient_quota: You exceeded your current quota", "limit"],
		['401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}', "login"],
		["OAuth refresh failed for anthropic-account-2: invalid_grant", "login"],
		['529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', undefined],
		["fetch failed: ECONNRESET socket hang up", undefined],
		["503 Service Unavailable", undefined],
		["prompt is too long: 250000 tokens > 200000 maximum", undefined],
		["400 invalid_request_error: messages.0.content is empty", undefined],
	];
	for (const [text, expected] of cases) assert.equal(classifyFailure(error(text)), expected, text);
	assert.equal(classifyFailure({ ...error("usage limit"), stopReason: "stop" } as AssistantMessage), undefined);
});

test("reset times are read from the error text in each provider's wording", () => {
	assert.equal(parseResetAt("Claude AI usage limit reached|1791500000", undefined, NOW), 1_791_500_000_000);
	assert.equal(parseResetAt("Try again in 2h 14m.", undefined, NOW), NOW + (2 * 60 + 14) * 60_000);
	assert.equal(parseResetAt("try again in 2 hours 14 minutes", undefined, NOW), NOW + (2 * 60 + 14) * 60_000);
	assert.equal(parseResetAt("Your limit resets in 3 days", undefined, NOW), NOW + 3 * 86_400_000);
	assert.equal(parseResetAt("limit resets at 2026-10-09T07:00:00Z", undefined, NOW), Date.parse("2026-10-09T07:00:00Z"));
	assert.equal(parseResetAt("rate limited", undefined, NOW), undefined);
});

test("reset times are read from the failed response's headers", () => {
	assert.equal(parseResetAt("429", { "anthropic-ratelimit-unified-reset": "1791500000" }, NOW), 1_791_500_000_000);
	assert.equal(
		parseResetAt("429", {
			"x-codex-primary-used-percent": "40",
			"x-codex-primary-reset-after-seconds": "600",
			"x-codex-secondary-used-percent": "100",
			"x-codex-secondary-reset-after-seconds": "86400",
		}, NOW),
		NOW + 86_400_000,
		"the window that is actually full",
	);
	assert.equal(parseResetAt("429", { "retry-after": "120" }, NOW), NOW + 120_000);
	assert.equal(parseResetAt("429", { "retry-after": "Thu, 08 Oct 2026 19:00:00 GMT" }, NOW), NOW + 3_600_000);
});

test("cooldowns last until the reset, within sane bounds, and expire on their own", () => {
	const cooldowns = new Cooldowns();
	assert.equal(cooldowns.mark("a", "limit", undefined, NOW).until, NOW + DEFAULT_COOLDOWN_MS, "unknown reset");
	assert.equal(cooldowns.mark("b", "limit", NOW + 5_000, NOW).until, NOW + 60_000, "at least a minute");
	assert.equal(cooldowns.mark("c", "limit", NOW + 90 * 86_400_000, NOW).until, NOW + 8 * 86_400_000, "never weeks");
	assert.ok(cooldowns.get("a", NOW + DEFAULT_COOLDOWN_MS - 1));
	assert.equal(cooldowns.get("a", NOW + DEFAULT_COOLDOWN_MS), undefined);
	cooldowns.clear("b");
	assert.equal(cooldowns.get("b", NOW), undefined);
});

test("the next account follows the current one, wraps around, and skips unusable ones", () => {
	const accounts = [1, 2, 3, 4].map((n) => slotFor(anthropic, n));
	const all = () => true;
	assert.equal(nextAccount(accounts, accounts[1]!, all)?.number, 3);
	assert.equal(nextAccount(accounts, accounts[3]!, all)?.number, 1);
	assert.equal(nextAccount(accounts, accounts[1]!, (s) => s.number !== 3)?.number, 4);
	assert.equal(nextAccount(accounts, accounts[1]!, () => false), undefined);
	assert.equal(nextAccount([accounts[0]!], accounts[0]!, all), undefined);
});
