import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { Slot } from "./families.ts";

/**
 * Builds the provider for an extra account: Pi's built-in provider under a new id.
 *
 * Login, token refresh, request shaping and streaming are Pi's own; only the id, the
 * display name and the model's `provider` field change. Auth is OAuth-only on purpose:
 * the built-in API-key auth also reads environment variables such as `ANTHROPIC_API_KEY`,
 * which would make every extra account look logged in.
 */
export function createAccountProvider(slot: Slot): Provider {
	const base = slot.family.createBase();
	const oauth = base.auth.oauth;
	if (!oauth) throw new Error(`Pi's ${slot.family.id} provider has no subscription login`);

	const id = slot.providerId;
	const getModels = (): Model<Api>[] => base.getModels().map((model) => ({ ...model, provider: id }));

	return {
		id,
		name: `${base.name} (account ${slot.number})`,
		baseUrl: base.baseUrl,
		headers: base.headers,
		auth: { oauth },
		getModels,
		getAllModels: getModels,
		stream: base.stream,
		streamSimple: base.streamSimple,
	};
}
