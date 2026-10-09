import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { listAccounts } from "../src/accounts.ts";
import { Cooldowns } from "../src/failover.ts";
import { registerAutomaticSwitching } from "../src/switching.ts";

const oauth = { type: "oauth" as const, access: "a", refresh: "r", expires: 0 };
type Handler = (event: any, ctx: any) => any;

/** A minimal Pi: records handlers, model switches and notifications. */
function fakePi(options: { loggedOut?: string[]; models?: Record<string, string[]> } = {}) {
	const handlers = new Map<string, Handler[]>();
	const switches: string[] = [];
	const notes: { text: string; level: string }[] = [];
	const models = options.models ?? {};
	const has = (provider: string, id: string) => (models[provider] ?? ["claude-opus-5"]).includes(id);
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		setModel: async (model: { provider: string; id: string }) => {
			switches.push(`${model.provider}/${model.id}`);
			return true;
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { provider: "anthropic", id: "claude-opus-5" },
		modelRegistry: {
			find: (provider: string, id: string) => (has(provider, id) ? { provider, id } : undefined),
			getProviderAuthStatus: (provider: string) => ({ configured: !options.loggedOut?.includes(provider) }),
			getProviderDisplayName: (provider: string) => (provider === "anthropic" ? "Anthropic" : provider),
		},
		ui: { notify: (text: string, level: string) => notes.push({ text, level }) },
	};
	const emit = async (event: string, payload: any) => {
		let result: any;
		for (const handler of handlers.get(event) ?? []) result = await handler(payload, ctx);
		return result;
	};
	return { pi, ctx, emit, switches, notes };
}

/** The boundary Pi emits after a run that ended with a failed reply on `provider`. */
function failedRun(provider: string, errorMessage: string, extra: Partial<{ entries: unknown[]; continue: boolean }> = {}) {
	return {
		type: "agent_before_settle",
		outcome: "error",
		entries: extra.entries ?? [],
		continue: extra.continue ?? false,
		context: {
			contextEntries: [
				{ sourceEntry: { id: "user-1", type: "message" }, messages: [{ role: "user", content: "fix the tests" }] },
				{ sourceEntry: { id: "model-change", type: "model_change" }, messages: [] },
				{
					sourceEntry: { id: "reply-1", type: "message" },
					messages: [{ role: "assistant", stopReason: "error", errorMessage, provider, model: "claude-opus-5", content: [] }],
				},
			],
		},
	};
}

const threeAccounts = listAccounts({ anthropic: oauth, "anthropic-account-2": oauth, "anthropic-account-3": oauth });

test("a usage limit moves to the next account, hides the failed attempt, and continues like Pi's retry", async () => {
	const { pi, emit, switches, notes } = fakePi();
	const cooldowns = new Cooldowns();
	registerAutomaticSwitching(pi, { cooldowns, accounts: () => threeAccounts });

	const otherExtension = { type: "custom", customType: "other", data: 1 };
	const result = await emit(
		"agent_before_settle",
		failedRun("anthropic", "You've hit your usage limit. Try again in 2h 14m.", { entries: [otherExtension] }),
	);

	assert.deepEqual(switches, ["anthropic-account-2/claude-opus-5"], "same model, next account");
	assert.deepEqual(result, {
		entries: [otherExtension, { type: "context_edit", targetId: "reply-1", replacement: null }],
		continue: true,
	});
	assert.match(notes[0]!.text, /^Anthropic account 1 hit its usage limit \(resets in 2h 1[34]m\)\. Continuing on account 2\.$/);
	assert.ok(cooldowns.get("anthropic"), "the limited account is benched");
});

test("each failure moves on, and when every account is limited the user learns which resets first", async () => {
	const { pi, emit, switches, notes } = fakePi();
	registerAutomaticSwitching(pi, { cooldowns: new Cooldowns(), accounts: () => threeAccounts });

	await emit("before_agent_start", {});
	await emit("agent_before_settle", failedRun("anthropic", "usage limit reached. Try again in 3h"));
	await emit("agent_before_settle", failedRun("anthropic-account-2", "usage limit reached. Try again in 40m"));
	await emit("agent_before_settle", failedRun("anthropic-account-3", "usage limit reached. Try again in 5h"));
	const last = await emit("agent_before_settle", failedRun("anthropic-account-3", "usage limit reached. Try again in 5h"));

	assert.deepEqual(switches, ["anthropic-account-2/claude-opus-5", "anthropic-account-3/claude-opus-5"]);
	assert.equal(last, undefined, "no continuation when nothing is usable");
	assert.equal(notes.at(-1)!.level, "warning");
	assert.match(notes.at(-1)!.text, /Every account is at its limit\. Account 2 resets first, in 4\dm\./);
});

test("a dead login moves on and says how to fix it", async () => {
	const { pi, emit, switches, notes } = fakePi();
	registerAutomaticSwitching(pi, { cooldowns: new Cooldowns(), accounts: () => threeAccounts });
	await emit("agent_before_settle", failedRun("anthropic-account-2", "401 authentication_error: OAuth token has been revoked"));
	assert.deepEqual(switches, ["anthropic-account-3/claude-opus-5"]);
	assert.match(notes[0]!.text, /account 2 needs logging in again \(\/login anthropic-account-2\)\. Continuing on account 3\./);
});

test("accounts that are logged out or lack the model are skipped", async () => {
	const { pi, emit, switches } = fakePi({
		loggedOut: ["anthropic-account-2"],
		models: { "anthropic-account-3": ["claude-sonnet-5"] },
	});
	registerAutomaticSwitching(pi, { cooldowns: new Cooldowns(), accounts: () => threeAccounts });
	const result = await emit("agent_before_settle", failedRun("anthropic", "usage limit reached"));
	assert.deepEqual(switches, []);
	assert.equal(result, undefined);
});

test("Pi keeps what is Pi's: overload, network trouble, other providers, and other extensions' continuations", async () => {
	const { pi, emit, switches } = fakePi();
	registerAutomaticSwitching(pi, { cooldowns: new Cooldowns(), accounts: () => threeAccounts });
	const untouched = [
		failedRun("anthropic", "529 overloaded_error: Overloaded"),
		failedRun("anthropic", "fetch failed: socket hang up"),
		failedRun("openrouter", "usage limit reached"),
		failedRun("anthropic", "usage limit reached", { continue: true }),
		{ ...failedRun("anthropic", "usage limit reached"), outcome: "completed" },
	];
	for (const event of untouched) assert.equal(await emit("agent_before_settle", event), undefined);
	assert.deepEqual(switches, []);
});

test("a successful response clears its account's recorded limit; error headers set the reset time", async () => {
	const { pi, ctx, emit } = fakePi();
	const cooldowns = new Cooldowns();
	registerAutomaticSwitching(pi, { cooldowns, accounts: () => threeAccounts });

	await emit("after_provider_response", { status: 429, headers: { "retry-after": "7200" } });
	await emit("agent_before_settle", failedRun("anthropic", "429 rate_limit_error"));
	const until = cooldowns.get("anthropic")!.until;
	assert.ok(Math.abs(until - (Date.now() + 7_200_000)) < 5_000, "reset from retry-after");

	ctx.model = { provider: "anthropic", id: "claude-opus-5" };
	await emit("after_provider_response", { status: 200, headers: {} });
	assert.equal(cooldowns.get("anthropic"), undefined);
});

// Recorded from real responses (October 2026).
const CLAUDE_429 =
	'429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."}}';
const claudeOkHeaders = (resetSeconds: number) => ({
	"anthropic-ratelimit-unified-5h-reset": String(resetSeconds),
	"anthropic-ratelimit-unified-5h-status": "allowed",
	"anthropic-ratelimit-unified-5h-utilization": "0.21",
	"anthropic-ratelimit-unified-representative-claim": "five_hour",
	"anthropic-ratelimit-unified-reset": String(resetSeconds),
	"anthropic-ratelimit-unified-status": "allowed",
});
const chatGptLimitEvent = (resetsAt: number) => ({
	type: "error",
	error: { type: "usage_limit_reached", message: "The usage limit has been reached", plan_type: "free", resets_at: resetsAt, resets_in_seconds: 1620705 },
	status_code: 429,
	headers: { "X-Codex-Primary-Used-Percent": "100", "X-Codex-Primary-Reset-At": String(resetsAt) },
});

test("Claude: a limit uses the reset time from the account's last successful response", async () => {
	const { pi, emit, notes } = fakePi();
	const cooldowns = new Cooldowns();
	registerAutomaticSwitching(pi, { cooldowns, accounts: () => threeAccounts });
	const reset = Math.floor(Date.now() / 1000) + 2 * 3600;

	await emit("after_provider_response", { status: 200, headers: claudeOkHeaders(reset) });
	await emit("agent_before_settle", failedRun("anthropic", CLAUDE_429));
	assert.equal(cooldowns.get("anthropic")!.until, reset * 1000);
	assert.match(notes.at(-1)!.text, /hit its usage limit \(resets in (1h 59m|2h)\)\. Continuing on account 2\./);
});

test("Claude: a reset time that has already passed is not used", async () => {
	const { pi, emit } = fakePi();
	const cooldowns = new Cooldowns();
	registerAutomaticSwitching(pi, { cooldowns, accounts: () => threeAccounts });
	await emit("after_provider_response", { status: 200, headers: claudeOkHeaders(Math.floor(Date.now() / 1000) + 2) });
	await new Promise((resolve) => setTimeout(resolve, 2_100));
	await emit("agent_before_settle", failedRun("anthropic", CLAUDE_429));
	const until = cooldowns.get("anthropic")!.until;
	assert.ok(Math.abs(until - (Date.now() + 15 * 60_000)) < 5_000, "falls back to the 15-minute guess");
});

test("ChatGPT: a limit uses the reset time from the streamed error", async () => {
	const { pi, emit } = fakePi({ models: { openai: ["gpt-5.5"], "openai-account-2": ["gpt-5.5"] } });
	const cooldowns = new Cooldowns();
	const accounts = listAccounts({ openai: oauth, "openai-account-2": oauth });
	registerAutomaticSwitching(pi, { cooldowns, accounts: () => accounts });
	const resetsAt = Math.floor(Date.now() / 1000) + 3 * 86400;

	await emit("provider_stream_event", { type: "provider_stream_event", provider: "openai", data: chatGptLimitEvent(resetsAt) });
	const run = failedRun("openai", "Codex error: The usage limit has been reached");
	(run.context.contextEntries[2]!.messages[0] as { model: string }).model = "gpt-5.5";
	await emit("agent_before_settle", run);
	assert.equal(cooldowns.get("openai")!.until, resetsAt * 1000);
});
