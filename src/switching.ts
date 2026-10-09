import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FamilyAccounts } from "./accounts.ts";
import { classifyFailure, type Cooldowns, knownResetAt, nextAccount, parseResetAt, streamErrorResetAt } from "./failover.ts";
import { parseSlot, type Slot } from "./families.ts";
import { formatDuration } from "./format.ts";

/** Safety net against loops: a prompt never switches more often than this. */
const MAX_SWITCHES_PER_PROMPT = 10;

interface FailedTurn {
	readonly entryId: string;
	readonly message: AssistantMessage;
}

/** The failed assistant reply that ended the run, with the session entry that holds it. */
function lastFailedTurn(entries: readonly { sourceEntry: { id: string; type: string }; messages: readonly unknown[] }[]): FailedTurn | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]!;
		if (entry.sourceEntry.type !== "message") continue;
		const message = entry.messages[entry.messages.length - 1] as AssistantMessage | undefined;
		if (message?.role !== "assistant") return undefined;
		return message.stopReason === "error" ? { entryId: entry.sourceEntry.id, message } : undefined;
	}
	return undefined;
}

/**
 * Moves to another account of the same provider when the current one hits its usage limit or
 * loses its login, and carries on with the same model.
 *
 * This is Pi's own retry, on a different account: at `agent_before_settle` (after Pi's retries
 * gave up) the failed attempt is hidden from the model with a `context_edit`, exactly as Pi
 * does for its retries, and `continue: true` asks Pi for the next request.
 */
export function registerAutomaticSwitching(
	pi: ExtensionAPI,
	options: { cooldowns: Cooldowns; accounts: () => readonly FamilyAccounts[] },
): void {
	const { cooldowns } = options;
	const failedHeaders = new Map<string, Record<string, string>>();
	/** Reset times from streamed errors (ChatGPT's usage limit arrives that way). */
	const streamResets = new Map<string, number>();
	/** Each account's limit reset from its last successful response (Claude sends one each time). */
	const knownResets = new Map<string, number>();
	let switchesThisPrompt = 0;

	pi.on("before_agent_start", () => {
		switchesThisPrompt = 0;
	});

	pi.on("after_provider_response", (event, ctx) => {
		const provider = ctx.model?.provider;
		if (!provider) return;
		if (event.status >= 400) {
			failedHeaders.set(provider, event.headers);
		} else {
			failedHeaders.delete(provider);
			streamResets.delete(provider);
			cooldowns.clear(provider);
			const reset = knownResetAt(event.headers);
			if (reset) knownResets.set(provider, reset);
		}
	});

	pi.on("provider_stream_event", (event) => {
		const reset = streamErrorResetAt(event.data);
		if (reset) streamResets.set(event.provider, reset);
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "error" || event.continue) return;
		const failed = lastFailedTurn(event.context.contextEntries);
		if (!failed) return;
		const kind = classifyFailure(failed.message);
		const current = parseSlot(failed.message.provider);
		if (!kind || !current) return;

		// Best source first: the error itself, then a streamed error, then the last reset time the
		// account reported while it still worked (only if that is still ahead).
		const known = knownResets.get(current.providerId);
		const resetAt =
			parseResetAt(failed.message.errorMessage ?? "", failedHeaders.get(current.providerId)) ??
			streamResets.get(current.providerId) ??
			(known !== undefined && known > Date.now() ? known : undefined);
		streamResets.delete(current.providerId);
		const cooldown = cooldowns.mark(current.providerId, kind, kind === "limit" ? resetAt : undefined);
		const family = options.accounts().find((entry) => entry.family === current.family);
		const providerName = ctx.modelRegistry.getProviderDisplayName(current.family.id);
		const what =
			kind === "limit"
				? `hit its usage limit${resetAt ? ` (resets in ${formatDuration(cooldown.until - Date.now())})` : ""}`
				: `needs logging in again (/login ${current.providerId})`;

		const modelId = failed.message.model;
		const usable = (slot: Slot) =>
			!cooldowns.get(slot.providerId) &&
			ctx.modelRegistry.getProviderAuthStatus(slot.providerId).configured &&
			!!ctx.modelRegistry.find(slot.providerId, modelId);
		const next =
			family && switchesThisPrompt < MAX_SWITCHES_PER_PROMPT ? nextAccount(family.accounts, current, usable) : undefined;

		if (!next) {
			ctx.ui.notify(`${providerName} account ${current.number} ${what}. ${noAccountLeft(family, current, cooldowns)}`, "warning");
			return;
		}

		const model = ctx.modelRegistry.find(next.providerId, modelId)!;
		try {
			await pi.setModel(model);
		} catch {
			return;
		}
		switchesThisPrompt++;
		ctx.ui.notify(`${providerName} account ${current.number} ${what}. Continuing on account ${next.number}.`, "info");
		return {
			entries: [...event.entries, { type: "context_edit", targetId: failed.entryId, replacement: null }],
			continue: true,
		};
	});
}

function noAccountLeft(family: FamilyAccounts | undefined, current: Slot, cooldowns: Cooldowns): string {
	const others = family?.accounts.filter((slot) => slot.providerId !== current.providerId) ?? [];
	if (others.length === 0) return "Add another account with /accounts to keep working when this happens.";
	const resets = others
		.map((slot) => ({ slot, cooldown: cooldowns.get(slot.providerId) }))
		.filter((entry) => entry.cooldown?.kind === "limit")
		.sort((a, b) => a.cooldown!.until - b.cooldown!.until);
	const first = resets[0];
	if (first) {
		return `Every account is at its limit. Account ${first.slot.number} resets first, in ${formatDuration(first.cooldown!.until - Date.now())}.`;
	}
	return "No other account can run this model right now. See /accounts.";
}
