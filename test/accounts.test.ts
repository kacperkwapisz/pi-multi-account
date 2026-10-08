import assert from "node:assert/strict";
import { test } from "node:test";
import type { Credential } from "@earendil-works/pi-ai";
import { listAccounts, providersToRegister } from "../src/accounts.ts";
import { createAccountProvider } from "../src/clone.ts";
import { FAMILIES, parseSlot, slotFor } from "../src/families.ts";

const [anthropic, openai] = FAMILIES;
const oauth: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };
const apiKey: Credential = { type: "api_key", key: "k" };

test("account 1 is Pi's built-in provider, extra accounts use the -account-N suffix", () => {
	assert.equal(slotFor(anthropic, 1).providerId, "anthropic");
	assert.equal(slotFor(anthropic, 3).providerId, "anthropic-account-3");
	assert.equal(slotFor(openai, 2).providerId, "openai-account-2");
});

test("parseSlot recognises only our families and valid account numbers", () => {
	assert.equal(parseSlot("anthropic")?.number, 1);
	assert.equal(parseSlot("anthropic-account-2")?.number, 2);
	assert.equal(parseSlot("openai-account-7")?.family, openai);
	for (const id of ["anthropic-account-1", "anthropic-account-0", "anthropic-2", "openai-codex", "openai-codex-account-2", "cursor-account-2"]) {
		assert.equal(parseSlot(id), undefined, id);
	}
});

test("an extra account is Pi's provider under a new id, with every model relabelled", () => {
	for (const family of FAMILIES) {
		const base = family.createBase();
		const clone = createAccountProvider(slotFor(family, 2));
		assert.equal(clone.id, `${family.id}-account-2`);
		assert.equal(clone.name, `${base.name} (account 2)`);
		assert.ok(clone.getModels().length > 0);
		assert.deepEqual(clone.getModels().map((m) => m.id), base.getModels().map((m) => m.id));
		assert.ok(clone.getModels().every((m) => m.provider === clone.id));
	}
});

test("an extra account only accepts its own subscription login, never ambient API keys", () => {
	const clone = createAccountProvider(slotFor(anthropic, 2));
	assert.equal(clone.auth.apiKey, undefined);
	assert.equal(clone.auth.oauth?.name, anthropic.createBase().auth.oauth?.name);
});

test("accounts are grouped per family in number order, and the next slot is the lowest free one", () => {
	const [claude, chatgpt] = listAccounts({
		"anthropic-account-3": oauth,
		anthropic: oauth,
		"openai-codex": oauth,
		cursor: oauth,
	});
	assert.deepEqual(claude.accounts.map((s) => s.providerId), ["anthropic", "anthropic-account-3"]);
	assert.equal(claude.next.providerId, "anthropic-account-2");
	assert.deepEqual(chatgpt.accounts, []);
	assert.equal(chatgpt.next.providerId, "openai");
});

test("an API key is not a subscription account but still occupies its slot", () => {
	const [claude] = listAccounts({ anthropic: apiKey });
	assert.deepEqual(claude.accounts, []);
	assert.equal(claude.next.providerId, "anthropic-account-2");
});

test("only extra accounts and free extra slots are registered; Pi owns account 1", () => {
	const ids = providersToRegister(listAccounts({ anthropic: oauth, "anthropic-account-2": oauth }));
	assert.deepEqual(ids.map((s) => s.providerId), ["anthropic-account-2", "anthropic-account-3"]);
	assert.deepEqual(providersToRegister(listAccounts({})), []);
});
