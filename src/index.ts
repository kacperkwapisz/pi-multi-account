import { type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type FamilyAccounts, listAccounts, providersToRegister } from "./accounts.ts";
import { authFilePath, readCredentials } from "./auth-file.ts";
import { createAccountProvider } from "./clone.ts";
import type { Slot } from "./families.ts";
import { AccountsView, type ViewAction, type ViewTab } from "./view.ts";

export default function multiAccount(pi: ExtensionAPI) {
	const registered = new Set<string>();
	let families: FamilyAccounts[] = [];

	/** Registers every extra account and each family's next free slot; drops the rest. */
	const sync = () => {
		families = listAccounts(readCredentials());
		const wanted = new Map(providersToRegister(families).map((slot) => [slot.providerId, slot]));
		for (const id of registered) {
			if (wanted.has(id)) continue;
			pi.unregisterProvider(id);
			registered.delete(id);
		}
		for (const [id, slot] of wanted) {
			if (registered.has(id)) continue;
			pi.registerProvider(createAccountProvider(slot));
			registered.add(id);
		}
	};

	sync();

	// Pi's /login and /logout write auth.json; follow along so the next free slot is always listed.
	let watcher: FSWatcher | undefined;
	let pending: NodeJS.Timeout | undefined;
	pi.on("session_start", () => {
		sync();
		const file = authFilePath();
		try {
			watcher = watch(dirname(file), (_event, name) => {
				if (name && name.toString() !== basename(file)) return;
				clearTimeout(pending);
				pending = setTimeout(sync, 100);
			});
		} catch {
			// Without a watcher, /accounts and the next session start still sync.
		}
	});
	pi.on("session_shutdown", () => {
		clearTimeout(pending);
		watcher?.close();
		watcher = undefined;
	});

	/** Switches to an account, keeping the current model when that account offers it. */
	const useAccount = async (ctx: ExtensionCommandContext, slot: Slot) => {
		const providerName = ctx.modelRegistry.getProviderDisplayName(slot.providerId);
		const current = ctx.model;
		let model = current ? ctx.modelRegistry.find(slot.providerId, current.id) : undefined;
		if (!model) {
			const models = ctx.modelRegistry.getAvailable().filter((m) => m.provider === slot.providerId);
			const picked = await ctx.ui.select(
				`Model for ${providerName}`,
				models.map((m) => m.id),
			);
			model = models.find((m) => m.id === picked);
			if (!model) return;
		}
		if (await pi.setModel(model)) ctx.ui.notify(`Using ${providerName} · ${model.name}`, "info");
		else ctx.ui.notify(`${providerName} is not logged in.`, "warning");
	};

	pi.registerCommand("accounts", {
		description: "See, switch and add your Claude and ChatGPT accounts",
		handler: async (_args, ctx) => {
			sync();
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/accounts needs the interactive terminal.", "warning");
				return;
			}
			const tabs: ViewTab[] = families.map(({ family, accounts, next }) => ({
				family,
				title: family.createBase().name,
				accounts,
				next,
			}));
			const isLoggedIn = (slot: Slot) => ctx.modelRegistry.getProviderAuthStatus(slot.providerId).configured;
			const action = await ctx.ui.custom<ViewAction | undefined>(
				(_tui, theme, _keybindings, done) => new AccountsView(tabs, isLoggedIn, theme, ctx.model?.provider, done),
			);

			if (action?.type === "login") {
				ctx.ui.setEditorText(`/login ${action.providerId}`);
				ctx.ui.notify("Press Enter to log in.", "info");
			} else if (action?.type === "use") {
				await useAccount(ctx, action.slot);
			}
		},
	});
}
