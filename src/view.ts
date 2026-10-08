import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Family, Slot } from "./families.ts";
import { formatDuration } from "./format.ts";

export interface ViewTab {
	readonly family: Family;
	/** Pi's provider name, e.g. "Anthropic". */
	readonly title: string;
	readonly accounts: readonly Slot[];
	readonly next: Slot;
}

export type ViewAction = { readonly type: "use"; readonly slot: Slot } | { readonly type: "login"; readonly providerId: string };

export interface AccountStatus {
	/** Whether Pi can authenticate the account. */
	readonly loggedIn: boolean;
	/** When an account that hit its usage limit becomes usable again (epoch ms). */
	readonly limitedUntil?: number;
}

export type StatusCheck = (slot: Slot) => AccountStatus;

/** The `/accounts` view: one tab per provider, every account, which one is in use. */
export class AccountsView implements Component {
	private readonly tabs: readonly ViewTab[];
	private readonly status: StatusCheck;
	private readonly theme: Theme;
	private readonly currentProvider: string | undefined;
	private readonly done: (action?: ViewAction) => void;
	private tab: number;
	private readonly selected: number[];
	private cache?: string[];

	constructor(
		tabs: readonly ViewTab[],
		status: StatusCheck,
		theme: Theme,
		currentProvider: string | undefined,
		done: (action?: ViewAction) => void,
	) {
		this.tabs = tabs;
		this.status = status;
		this.theme = theme;
		this.currentProvider = currentProvider;
		this.done = done;
		const current = tabs.findIndex((tab) => tab.accounts.some((slot) => slot.providerId === currentProvider));
		this.tab = Math.max(0, current);
		this.selected = tabs.map((tab) => Math.max(0, tab.accounts.findIndex((slot) => slot.providerId === currentProvider)));
	}

	invalidate(): void {
		this.cache = undefined;
	}

	handleInput(data: string): void {
		const tab = this.tabs[this.tab];
		if (!tab) return;
		const items = tab.accounts.length + 1; // accounts + "Add account"
		const index = this.selected[this.tab] ?? 0;

		if (matchesKey(data, Key.escape)) return this.done();
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			this.tab = (this.tab + 1) % this.tabs.length;
		} else if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
			this.tab = (this.tab - 1 + this.tabs.length) % this.tabs.length;
		} else if (matchesKey(data, Key.up)) {
			this.selected[this.tab] = (index - 1 + items) % items;
		} else if (matchesKey(data, Key.down)) {
			this.selected[this.tab] = (index + 1) % items;
		} else if (matchesKey(data, Key.enter)) {
			const slot = tab.accounts[index];
			if (!slot) return this.done({ type: "login", providerId: tab.next.providerId });
			if (!this.status(slot).loggedIn) return this.done({ type: "login", providerId: slot.providerId });
			return this.done({ type: "use", slot });
		} else {
			return;
		}
		this.invalidate();
	}

	render(width: number): string[] {
		if (this.cache) return this.cache;
		const t = this.theme;
		const w = Math.max(20, width);
		const lines: string[] = [];
		const push = (line = "") => lines.push(truncateToWidth(line, w));

		push(t.fg("accent", "─".repeat(w)));

		const tabs = this.tabs.map((tab, i) => {
			const text = ` ${tab.title} (${tab.accounts.length}) `;
			return i === this.tab ? t.bg("selectedBg", t.fg("text", text)) : t.fg("muted", text);
		});
		push(` ${t.fg("dim", "←")} ${tabs.join(" ")} ${t.fg("dim", "→")}`);
		push();

		const tab = this.tabs[this.tab];
		if (tab) {
			const index = this.selected[this.tab] ?? 0;
			if (tab.accounts.length === 0) push(`   ${t.fg("muted", `No ${tab.title} accounts yet.`)}`);
			tab.accounts.forEach((slot, i) => push(this.renderAccount(slot, i === index, w)));
			push();
			const addSelected = index === tab.accounts.length;
			push(`${addSelected ? t.fg("accent", " > ") : "   "}${t.fg(addSelected ? "accent" : "muted", `+ Add ${tab.title} account`)}`);
			push();
		}

		push(` ${t.fg("dim", "Tab/←→ switch • ↑↓ select • Enter use • Esc close")}`);
		push(t.fg("accent", "─".repeat(w)));

		this.cache = lines;
		return lines;
	}

	private renderAccount(slot: Slot, selected: boolean, width: number): string {
		const t = this.theme;
		const inUse = slot.providerId === this.currentProvider;
		const { loggedIn, limitedUntil } = this.status(slot);
		const limited = limitedUntil ? `limit reached · resets in ${formatDuration(limitedUntil - Date.now())}` : undefined;
		const status = !loggedIn
			? t.fg("error", "needs login")
			: [limited && t.fg("warning", limited), inUse && t.fg("accent", "in use")].filter(Boolean).join(t.fg("dim", " · "));
		const prefix = `${selected ? t.fg("accent", " > ") : "   "}${inUse ? t.fg("accent", "● ") : "  "}`;
		const left = `${prefix}${t.fg(selected ? "accent" : "text", `Account ${slot.number}`)} ${t.fg("dim", slot.providerId)}`;
		if (!status) return left;
		const gap = width - visibleWidth(left) - visibleWidth(status) - 1;
		return gap > 0 ? `${left}${" ".repeat(gap)}${status}` : `${left}  ${status}`;
	}
}
