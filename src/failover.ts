import { type AssistantMessage, isContextOverflow } from "@earendil-works/pi-ai";
import type { Slot } from "./families.ts";

/** Why an account cannot be used right now. */
export type FailureKind = "limit" | "login";

const LIMIT_PATTERN =
	/usage.?limit|rate.?limit|too many requests|\b429\b|quota|out of budget|billing|limit (?:reached|exceeded)|exceeded (?:your|the) .{0,40}limit|subscription_sharing_usage_limit_exceeded/i;
const LOGIN_PATTERN =
	/\b401\b|unauthori[sz]ed|authentication.?error|invalid.{0,20}(?:token|api.?key|bearer|credential)|token.{0,30}(?:expired|revoked|invalidated)|invalid_grant|re-?authenticate|log ?in again|No API key found/i;

/**
 * Decides whether a failed turn is about the account itself, so another account of the same
 * provider can carry on. Everything else (context overflow, overload, network trouble) is
 * Pi's to handle with compaction and retries; another account would not help.
 *
 * Runs after Pi's own retries, so a rate limit seen here has already outlasted them.
 */
export function classifyFailure(message: AssistantMessage): FailureKind | undefined {
	if (message.stopReason !== "error" || !message.errorMessage) return undefined;
	if (isContextOverflow(message)) return undefined;
	const text = message.errorMessage;
	if (LIMIT_PATTERN.test(text)) return "limit";
	if (LOGIN_PATTERN.test(text)) return "login";
	return undefined;
}

const MINUTE = 60_000;
/** Used when the provider does not say when the limit resets. Short: a wrong guess costs one request. */
export const DEFAULT_COOLDOWN_MS = 15 * MINUTE;
const MAX_COOLDOWN_MS = 8 * 24 * 60 * MINUTE;

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: MINUTE, s: 1000 };

function durationMs(text: string): number | undefined {
	let total = 0;
	let found = false;
	for (const [, amount, unit] of text.matchAll(/([\d.]+)\s*(d|h|m|s)(?:ays?|ours?|in(?:ute)?s?|ec(?:ond)?s?|rs?)?\b/gi)) {
		const ms = UNIT_MS[unit!.toLowerCase()];
		if (ms === undefined) continue;
		total += Number(amount) * ms;
		found = true;
	}
	return found && Number.isFinite(total) ? total : undefined;
}

function headerNumber(headers: Record<string, string> | undefined, name: string): number | undefined {
	const value = headers?.[name] ?? headers?.[name.toLowerCase()];
	if (value === undefined || value.trim() === "") return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * When a limited account becomes usable again, from the error text or the failed response's
 * headers. Returns undefined when the provider does not say.
 */
export function parseResetAt(errorMessage: string, headers?: Record<string, string>, now = Date.now()): number | undefined {
	// Claude: "...usage limit reached|1712345678"
	const epoch = errorMessage.match(/\|(\d{10})(?:\d{3})?\b/);
	if (epoch) return Number(epoch[1]) * 1000;

	const iso = errorMessage.match(/reset(?:s)?(?: at)?:?\s*(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i);
	if (iso) {
		const at = Date.parse(iso[1]!);
		if (Number.isFinite(at)) return at;
	}

	const relative = errorMessage.match(/(?:try again|resets?|retry) (?:in|after) ([^.;\n]+)/i);
	const relativeMs = relative ? durationMs(relative[1]!) : undefined;
	if (relativeMs) return now + relativeMs;

	const anthropicReset = headerNumber(headers, "anthropic-ratelimit-unified-reset");
	if (anthropicReset) return anthropicReset * 1000;

	for (const window of ["primary", "secondary"]) {
		const used = headerNumber(headers, `x-codex-${window}-used-percent`);
		const after = headerNumber(headers, `x-codex-${window}-reset-after-seconds`);
		if (used !== undefined && used >= 100 && after !== undefined) return now + after * 1000;
	}

	const retryAfter = headers?.["retry-after"];
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) return now + seconds * 1000;
		const at = Date.parse(retryAfter);
		if (Number.isFinite(at)) return at;
	}
	return undefined;
}

/**
 * The reset time a provider sends inside a streamed error, such as ChatGPT's usage limit over
 * its WebSocket: `{ type: "error", error: { resets_at, resets_in_seconds }, headers }`. That
 * error never arrives as an HTTP response, so Pi's after_provider_response doesn't see it.
 */
export function streamErrorResetAt(data: unknown, now = Date.now()): number | undefined {
	const event = data as { type?: unknown; error?: { resets_at?: unknown; resets_in_seconds?: unknown }; response?: { error?: unknown } } | undefined;
	if (event?.type !== "error" && event?.type !== "response.failed") return undefined;
	const error = (event.error ?? event.response?.error) as { resets_at?: unknown; resets_in_seconds?: unknown } | undefined;
	if (typeof error?.resets_at === "number" && error.resets_at > 0) return error.resets_at * 1000;
	if (typeof error?.resets_in_seconds === "number" && error.resets_in_seconds > 0) return now + error.resets_in_seconds * 1000;
	const headers = (event as { headers?: Record<string, string> }).headers;
	if (headers) {
		const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
		return parseResetAt("", lower, now);
	}
	return undefined;
}

/**
 * When the account's current limit window resets, from a successful Claude response
 * (`anthropic-ratelimit-unified-reset`). A failed Claude request carries no reset time that
 * reaches extensions, so the last one seen is the best guess.
 */
export function knownResetAt(headers: Record<string, string>, now = Date.now()): number | undefined {
	const reset = headerNumber(headers, "anthropic-ratelimit-unified-reset");
	return reset !== undefined && reset * 1000 > now ? reset * 1000 : undefined;
}

export interface Cooldown {
	readonly until: number;
	readonly kind: FailureKind;
}

/** Accounts that recently hit a limit or lost their login, until they are usable again. */
export class Cooldowns {
	private readonly entries = new Map<string, Cooldown>();

	mark(providerId: string, kind: FailureKind, resetAt: number | undefined, now = Date.now()): Cooldown {
		const wanted = resetAt ?? now + DEFAULT_COOLDOWN_MS;
		const until = Math.min(Math.max(wanted, now + MINUTE), now + MAX_COOLDOWN_MS);
		const cooldown = { until, kind };
		this.entries.set(providerId, cooldown);
		return cooldown;
	}

	get(providerId: string, now = Date.now()): Cooldown | undefined {
		const cooldown = this.entries.get(providerId);
		if (cooldown && cooldown.until <= now) {
			this.entries.delete(providerId);
			return undefined;
		}
		return cooldown;
	}

	clear(providerId: string): void {
		this.entries.delete(providerId);
	}
}

/**
 * The next account to try after `current`: the following account numbers first, then
 * wrapping around, skipping any that `isUsable` rejects.
 */
export function nextAccount(accounts: readonly Slot[], current: Slot, isUsable: (slot: Slot) => boolean): Slot | undefined {
	const others = accounts.filter((slot) => slot.providerId !== current.providerId);
	const after = others.filter((slot) => slot.number > current.number);
	const before = others.filter((slot) => slot.number < current.number);
	return [...after, ...before].find(isUsable);
}
