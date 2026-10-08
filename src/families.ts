import type { Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

/**
 * A subscription family: one of Pi's built-in providers whose OAuth login can be
 * repeated for extra accounts. Account 1 is the built-in provider itself; account N
 * is a clone registered as `<id>-account-N`.
 */
export interface Family {
	/** Pi's built-in provider id, e.g. `anthropic`. */
	readonly id: string;
	/** Creates a fresh instance of Pi's built-in provider. */
	readonly createBase: () => Provider;
}

export const FAMILIES: readonly Family[] = [
	{ id: "anthropic", createBase: anthropicProvider },
	{ id: "openai", createBase: openaiProvider },
];

export interface Slot {
	readonly family: Family;
	/** 1-based account number. */
	readonly number: number;
	/** Provider id Pi stores the credential under. */
	readonly providerId: string;
}

export function slotFor(family: Family, number: number): Slot {
	const providerId = number === 1 ? family.id : `${family.id}-account-${number}`;
	return { family, number, providerId };
}

/** Parses a provider id such as `anthropic` or `anthropic-account-3` into its slot. */
export function parseSlot(providerId: string): Slot | undefined {
	for (const family of FAMILIES) {
		if (providerId === family.id) return slotFor(family, 1);
		const match = providerId.match(/^(.+)-account-(\d+)$/);
		if (match?.[1] === family.id) {
			const number = Number(match[2]);
			if (Number.isSafeInteger(number) && number >= 2) return slotFor(family, number);
		}
	}
	return undefined;
}
