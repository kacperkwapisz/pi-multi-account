import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONNECT_CHANNEL, type MultiAccountApi } from "../src/connect.ts";

// The extension reads Pi's auth.json from the agent directory; give it two Claude accounts.
const agentDir = mkdtempSync(join(tmpdir(), "pma-connect-"));
const oauth = { type: "oauth", access: "a", refresh: "r", expires: 0 };
writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: oauth, "anthropic-account-2": oauth }));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { default: multiAccount } = await import("../src/index.ts");

function loadExtension() {
	const events = createEventBus();
	const switches: string[] = [];
	const pi = {
		events,
		on: () => () => {},
		registerProvider: () => {},
		unregisterProvider: () => {},
		registerCommand: () => {},
		setModel: async (model: { provider: string; id: string }) => (switches.push(`${model.provider}/${model.id}`), true),
	} as unknown as ExtensionAPI;
	multiAccount(pi);
	return { events, switches };
}

const ctx = {
	model: { provider: "anthropic", id: "claude-opus-5" },
	modelRegistry: {
		find: (provider: string, id: string) => ({ provider, id, name: id }),
		getProviderDisplayName: () => "Anthropic",
		getAvailable: () => [],
	},
	ui: { notify: () => {}, select: async () => undefined },
} as never;

test("another extension connects over pi.events and switches accounts through pi-multi-account", async () => {
	const { events, switches } = loadExtension();
	let api: MultiAccountApi | undefined;
	events.emit(CONNECT_CHANNEL, { reply: (reply: MultiAccountApi) => (api = reply) });

	assert.equal(api?.version, 1, "answers immediately");
	assert.equal(await api!.useAccount("anthropic-account-2", ctx), true);
	assert.deepEqual(switches, ["anthropic-account-2/claude-opus-5"], "same model on the chosen account");
	assert.equal(await api!.useAccount("openrouter", ctx), false, "only its own accounts");
});

test("without pi-multi-account nobody answers, so callers simply offer no switching", () => {
	const events = createEventBus();
	let api: MultiAccountApi | undefined;
	events.emit(CONNECT_CHANNEL, { reply: (reply: MultiAccountApi) => (api = reply) });
	assert.equal(api, undefined);
});
