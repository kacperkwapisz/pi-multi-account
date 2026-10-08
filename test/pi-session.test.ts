/**
 * Runs automatic switching inside a real Pi agent session (Pi's SDK), with two scripted
 * accounts from pi-ai's faux provider standing in for Anthropic. Proves that Pi itself
 * accepts the continuation: no real accounts or network involved.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Context, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { listAccounts } from "../src/accounts.ts";
import { Cooldowns } from "../src/failover.ts";
import { registerAutomaticSwitching } from "../src/switching.ts";

const oauth = { type: "oauth" as const, access: "a", refresh: "r", expires: 0 };

async function startSession(account1: ReturnType<typeof fauxProvider>, account2: ReturnType<typeof fauxProvider>) {
	const dir = mkdtempSync(join(tmpdir(), "pma-session-"));
	// Like real accounts, both have a stored login.
	writeFileSync(
		join(dir, "auth.json"),
		JSON.stringify({ anthropic: { type: "api_key", key: "one" }, "anthropic-account-2": { type: "api_key", key: "two" } }),
		{ mode: 0o600 },
	);
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		noExtensions: true,
		extensionFactories: [
			(pi) => {
				pi.registerProvider(account1.provider);
				pi.registerProvider(account2.provider);
			},
			(pi) =>
				registerAutomaticSwitching(pi, {
					cooldowns: new Cooldowns(),
					accounts: () => listAccounts({ anthropic: oauth, "anthropic-account-2": oauth }),
				}),
		],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 } }),
		model: account1.getModel(),
		noTools: "all",
	});
	return session;
}

const accounts = () => [
	fauxProvider({ provider: "anthropic", models: [{ id: "claude-opus-5" }] }),
	fauxProvider({ provider: "anthropic-account-2", models: [{ id: "claude-opus-5" }] }),
] as const;
const limited = (when: string) => fauxAssistantMessage("", { stopReason: "error", errorMessage: `You've hit your usage limit. Try again in ${when}.` });

test("in a real Pi session, a usage limit on account 1 continues the same task on account 2", async () => {
	const [account1, account2] = accounts();
	account1.setResponses([limited("2h")]);
	let account2Saw: Context["messages"] = [];
	account2.setResponses([
		(context) => {
			account2Saw = context.messages;
			return fauxAssistantMessage("Done, on account 2.");
		},
	]);
	const session = await startSession(account1, account2);

	try {
		await session.prompt("Fix the failing tests.");

		assert.equal(account1.state.callCount, 1);
		assert.equal(account2.state.callCount, 1, "Pi continued on the next account");
		assert.equal(session.model?.provider, "anthropic-account-2");
		assert.equal(session.model?.id, "claude-opus-5", "same model");

		assert.ok(
			account2Saw.some((m) => m.role === "user"),
			"account 2 received the user's task",
		);
		assert.ok(
			!account2Saw.some((m) => m.role === "assistant" && (m as { stopReason?: string }).stopReason === "error"),
			"the failed attempt is hidden from the model",
		);

		const last = session.messages.at(-1) as { role: string; content: { type: string; text?: string }[] };
		assert.equal(last.role, "assistant");
		assert.equal(last.content.find((c) => c.type === "text")?.text, "Done, on account 2.");
	} finally {
		session.dispose();
	}
});

test("in a real Pi session, when every account is limited each is tried once and the run stops", async () => {
	const [account1, account2] = accounts();
	account1.setResponses([limited("2h"), fauxAssistantMessage("never reached")]);
	account2.setResponses([limited("40m"), fauxAssistantMessage("never reached")]);
	const session = await startSession(account1, account2);
	try {
		await session.prompt("Fix the failing tests.");
		assert.equal(account1.state.callCount, 1);
		assert.equal(account2.state.callCount, 1);
		const last = session.messages.at(-1) as { role: string; stopReason?: string };
		assert.equal(last.stopReason, "error", "the final error is left for the user to see");
	} finally {
		session.dispose();
	}
});
