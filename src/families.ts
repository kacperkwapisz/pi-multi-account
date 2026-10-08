import type { Provider } from "@earendil-works/pi-ai";
// Pi provides this module to extensions; individual provider modules are not.
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

let builtins: Map<string, Provider> | undefined;

/** Pi's built-in provider with this id. */
function builtin(id: string): () => Provider {
	return () => {
		builtins ??= new Map(builtinProviders().map((provider) => [provider.id, provider]));
		const provider = builtins.get(id);
		if (!provider) throw new Error(`Pi has no built-in ${id} provider`);
		return provider;
	};
}

export interface Family {
	/** Pi's built-in provider id, e.g. `anthropic`. */
	readonly id: string;
	/** Pi's built-in provider for this family. */
	readonly createBase: () => Provider;
}

export const FAMILIES: readonly Family[] = [
	{ id: "anthropic", createBase: builtin("anthropic") },
	{ id: "openai", createBase: builtin("openai") },
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
