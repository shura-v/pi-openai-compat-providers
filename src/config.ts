import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

export interface Endpoint {
	name: string;
	baseUrl: string;
	apiKey: string;
	profile?: "tabby";
}

export const validName = /^[a-z0-9][a-z0-9._-]*$/;
export const validKey = /^[\x21-\x7e]*$/;

export function normalizeUrl(value: string): string {
	const url = URL.parse(value);
	if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || /[?#]/.test(url.href)) {
		throw new Error("Enter an HTTP or HTTPS base URL without credentials, a query string, or a fragment.");
	}
	return url.href.replace(/\/+$/, "");
}

export function loadEndpoints(file: string): Endpoint[] {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return [];
	}
	try {
		const entries = JSON.parse(text);
		if (!Array.isArray(entries)) throw new Error();
		const names = new Set<string>();
		return entries.map(({ name, baseUrl, apiKey, profile }) => {
			if (typeof name !== "string" || !validName.test(name) || names.has(name)) throw new Error();
			if (typeof baseUrl !== "string" || typeof apiKey !== "string" || !validKey.test(apiKey)) throw new Error();
			if (profile !== undefined && profile !== "tabby") throw new Error();
			names.add(name);
			return { name, baseUrl: normalizeUrl(baseUrl), apiKey, ...(profile && { profile }) };
		});
	} catch {
		// JSON.parse errors can quote the line containing the secret.
		throw new Error(`Invalid provider configuration: ${file}`);
	}
}

export function saveEndpoints(file: string, previous: Endpoint[], next: Endpoint[]) {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	// The exclusive staging file serializes writers; rename publishes the entire batch at once.
	const staging = `${file}.tmp`;
	const fd = openSync(staging, "wx", 0o600);
	try {
		try {
			if (!isDeepStrictEqual(loadEndpoints(file), previous)) throw new Error("Provider settings changed in another session. Run /reload and try again.");
			writeFileSync(fd, JSON.stringify(next, null, 2) + "\n");
		} finally {
			closeSync(fd);
		}
		renameSync(staging, file);
	} catch (error) {
		unlinkSync(staging);
		throw error;
	}
}
