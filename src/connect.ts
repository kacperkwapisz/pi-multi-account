import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * How other extensions use pi-multi-account, over Pi's `pi.events` bus (no imports needed):
 *
 * ```ts
 * let accounts: MultiAccountApi | undefined;
 * pi.events.emit("pi-multi-account:connect", { reply: (api) => (accounts = api) });
 * // `accounts` is set right away when pi-multi-account is loaded; otherwise it stays undefined.
 * await accounts?.useAccount("anthropic-account-2", ctx);
 * ```
 */
export const CONNECT_CHANNEL = "pi-multi-account:connect";

export interface ConnectRequest {
	reply(api: MultiAccountApi): void;
}

export interface MultiAccountApi {
	readonly version: 1;
	/**
	 * Switches the session to an account (a Pi provider id such as `anthropic-account-2`),
	 * keeping the current model when that account offers it and asking otherwise.
	 * Resolves to whether the switch happened.
	 */
	useAccount(providerId: string, ctx: ExtensionContext): Promise<boolean>;
}
