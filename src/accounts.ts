import type { Credential } from "@earendil-works/pi-ai";
import { FAMILIES, type Family, parseSlot, type Slot, slotFor } from "./families.ts";

export interface FamilyAccounts {
	readonly family: Family;
	/** Logged-in subscription accounts, in account-number order. */
	readonly accounts: readonly Slot[];
	/** The lowest free account number; logging into it adds an account. */
	readonly next: Slot;
}

/** Groups the stored subscription logins by family. */
export function listAccounts(credentials: Record<string, Credential>): FamilyAccounts[] {
	return FAMILIES.map((family) => {
		const accounts = Object.entries(credentials)
			.filter(([, credential]) => credential?.type === "oauth")
			.map(([providerId]) => parseSlot(providerId))
			.filter((slot): slot is Slot => slot?.family === family)
			.sort((a, b) => a.number - b.number);
		let number = 1;
		while (credentials[slotFor(family, number).providerId]) number++;
		return { family, accounts, next: slotFor(family, number) };
	});
}

/**
 * Provider ids this extension should have registered: every extra account plus each
 * family's next free slot, so Pi's `/login` lists it. Account 1 is Pi's own provider.
 */
export function providersToRegister(families: readonly FamilyAccounts[]): Slot[] {
	return families
		.flatMap(({ accounts, next }) => [...accounts, next])
		.filter((slot) => slot.number > 1);
}
