import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FAMILIES, type Slot, slotFor } from "../src/families.ts";
import { AccountsView, type ViewAction, type ViewTab } from "../src/view.ts";

const plainTheme = { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const [anthropic, openai] = FAMILIES;

function tabsWith(accounts: Slot[]): ViewTab[] {
	return [
		{ family: anthropic, title: "Anthropic", accounts, next: slotFor(anthropic, accounts.length + 1) },
		{ family: openai, title: "OpenAI", accounts: [], next: slotFor(openai, 1) },
	];
}

test("the view lists every account with its Pi provider id, which one is in use, and which needs login", () => {
	const accounts = [slotFor(anthropic, 1), slotFor(anthropic, 2), slotFor(anthropic, 3)];
	const loggedIn = (slot: Slot) => slot.number !== 3;
	const view = new AccountsView(tabsWith(accounts), loggedIn, plainTheme, "anthropic", () => {});
	const width = 72;
	const lines = view.render(width);
	const text = lines.join("\n");

	assert.ok(lines.every((line) => visibleWidth(line) <= width), "no line is wider than the terminal");
	assert.match(text, /Anthropic \(3\) +OpenAI \(0\)/);
	assert.match(text, / > ● Account 1 anthropic +in use/);
	assert.match(text, /Account 2 anthropic-account-2\n/);
	assert.match(text, /Account 3 anthropic-account-3 +needs login/);
	assert.match(text, /\+ Add Anthropic account/);
	assert.match(text, /Esc close/);
});

test("keys move between tabs and accounts and turn Enter into the right action", () => {
	const accounts = [slotFor(anthropic, 1), slotFor(anthropic, 2), slotFor(anthropic, 3)];
	const actions: (ViewAction | undefined)[] = [];
	const loggedIn = (slot: Slot) => slot.number !== 3;
	const view = new AccountsView(tabsWith(accounts), loggedIn, plainTheme, "anthropic-account-2", (a) => actions.push(a));

	view.handleInput("\r"); // starts on the account in use
	view.handleInput("\x1b[B"); // down → account 3, which needs login
	view.handleInput("\r");
	view.handleInput("\x1b[B"); // down → "Add account"
	view.handleInput("\r");
	view.handleInput("\t"); // OpenAI tab, only "Add account"
	view.handleInput("\r");
	view.handleInput("\x1b"); // Esc

	assert.deepEqual(actions, [
		{ type: "use", slot: accounts[1] },
		{ type: "login", providerId: "anthropic-account-3" },
		{ type: "login", providerId: "anthropic-account-4" },
		{ type: "login", providerId: "openai" },
		undefined,
	]);
});
