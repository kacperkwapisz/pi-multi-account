import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Read-only view of Pi's `auth.json`. Pi's own `/login` and `/logout` write it; this
 * extension only looks at which accounts exist.
 */
export function authFilePath(): string {
	return join(getAgentDir(), "auth.json");
}

export function readCredentials(path = authFilePath()): Record<string, Credential> {
	try {
		if (!existsSync(path)) return {};
		const data: unknown = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, "") || "{}");
		return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, Credential>) : {};
	} catch {
		return {};
	}
}
