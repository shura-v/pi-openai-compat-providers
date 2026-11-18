import { join } from "node:path";
import { type Model, openAICompletionsApi, type Provider } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import { type Endpoint, loadEndpoints, normalizeUrl, saveEndpoints, validKey, validName } from "./config.ts";

const commandName = "openai-compat-providers";

// Preserve existing tabby/model references; namespace new IDs away from Pi's own providers.
const providerId = (name: string) => name === "tabby" ? name : `openai-compatible-${name}`;

function makeProvider({ name, baseUrl, apiKey, profile }: Endpoint): Provider {
	const id = providerId(name);
	const tabby = profile === "tabby";
	let models: Model<"openai-completions">[] = [];
	return {
		id, name, baseUrl,
		...openAICompletionsApi(),
		auth: { apiKey: {
			name: `API key (/${commandName})`,
			// The OpenAI client needs a nonempty key even on anonymous servers. Suppress its default header there.
			resolve: async () => ({ auth: { baseUrl, apiKey: apiKey || "unused", headers: apiKey ? undefined : { Authorization: null } } }),
		} },
		getModels: () => models,
		async refreshModels({ allowNetwork, signal, publish }) {
			if (!allowNetwork) return;
			const response = await fetch(`${baseUrl}/models`, {
				headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
				signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
			});
			if (!response.ok) throw new Error(`${name}: /models returned HTTP ${response.status}`);
			const { data } = await response.json() as { data: { id: string }[] };
			if (!Array.isArray(data) || !data.every(item => typeof item?.id === "string" && item.id.trim())) {
				throw new Error(`${name}: expected /models to return a data array with an id for each model`);
			}
			const discovered = data.map(({ id: modelId }): Model<"openai-completions"> => ({
				id: modelId, name: modelId, provider: id, api: "openai-completions", baseUrl,
				input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				// Keep the legacy Tabby profile's limits and Qwen template for existing configurations.
				contextWindow: tabby ? 106496 : 128000, maxTokens: 16384, reasoning: tabby,
				...(tabby && { compat: { thinkingFormat: "qwen-chat-template" } }),
			}));
			await publish({ update: () => { models = discovered; } });
		},
	};
}

async function promptEndpoint(ctx: ExtensionCommandContext, previous?: Endpoint): Promise<Endpoint | undefined> {
	const nameInput = await ctx.ui.input(previous ? `Provider name (Enter to keep ${previous.name})` : "Provider name");
	if (nameInput === undefined) return;
	const name = nameInput.trim() || previous?.name;
	if (!name || !validName.test(name)) throw new Error("Start the name with a lowercase letter (a-z) or digit. After that, dots, hyphens, and underscores are also allowed.");
	const urlInput = await ctx.ui.input(previous ? `Base URL (Enter to keep ${previous.baseUrl})` : "Base URL (e.g. http://localhost:8000/v1)");
	if (urlInput === undefined) return;
	const baseUrl = normalizeUrl(urlInput.trim() || previous?.baseUrl || "");
	if (previous?.apiKey && previous.baseUrl === baseUrl) {
		const choice = await ctx.ui.select(`API key for ${name}`, ["Keep", "Replace", "Clear"]);
		if (!choice) return;
		if (choice !== "Replace") return { ...previous, name, baseUrl, apiKey: choice === "Keep" ? previous.apiKey : "" };
	}
	const key = await ctx.ui.custom<string | undefined>((_tui, _theme, _kb, done) => {
		const input = new Input();
		input.onSubmit = done;
		input.onEscape = () => done(undefined);
		input.render = width => [truncateToWidth("API key (leave blank for no key, Esc to cancel)", width), "•".repeat(Math.min(width, input.getValue().length))];
		return input;
	}, { blocked: { kind: "auth", message: "Provider API key" } });
	if (key === undefined) return;
	const apiKey = key.trim();
	if (!validKey.test(apiKey)) throw new Error("Use only printable ASCII characters without spaces in the API key.");
	return { ...previous, name, baseUrl, apiKey };
}

export default function openaiCompatible(pi: ExtensionAPI) {
	const file = join(getAgentDir(), "openai-compatible.json");
	let endpoints = loadEndpoints(file);
	for (const endpoint of endpoints) pi.registerProvider(makeProvider(endpoint));

	pi.registerCommand(commandName, {
		description: "OpenAI-compatible: add | edit [name ...] | remove [name ...]",
		async handler(args, ctx) {
			if (ctx.mode !== "tui") throw new Error(`Run /${commandName} in an interactive Pi session.`);
			const snapshot = endpoints;
			const [verb, ...names] = args.trim().split(/\s+/);
			const action = verb || await ctx.ui.select("OpenAI-compatible providers", ["add", "edit", "remove"]);
			if (!action) return;
			if (!["add", "edit", "remove"].includes(action) || (action === "add" && names.length)) {
				return ctx.ui.notify(`/${commandName} add | edit [name ...] | remove [name ...]`, "error");
			}
			if (action !== "add" && !names.length) {
				if (!snapshot.length) return ctx.ui.notify(`No providers configured. Run /${commandName} add.`, "info");
				const name = await ctx.ui.select("Select a provider", snapshot.map(p => p.name));
				if (!name) return;
				names.push(name);
			}
			const selected: Endpoint[] = [];
			for (const name of new Set(names)) {
				const endpoint = snapshot.find(p => p.name === name);
				if (!endpoint) return ctx.ui.notify("Unknown provider name. No changes made.", "error");
				selected.push(endpoint);
			}
			if (selected.some(p => providerId(p.name) === ctx.model?.provider)) {
				return ctx.ui.notify("Use /model to switch to another provider first.", "warning");
			}
			const next = snapshot.filter(p => !selected.includes(p));
			const updates: Endpoint[] = [];
			if (action === "remove") {
				if (!await ctx.ui.confirm("Remove the selected providers and their API keys?", selected.map(p => p.name).join(", "))) return;
			} else {
				for (const previous of action === "add" ? [undefined] : selected) {
					const endpoint = await promptEndpoint(ctx, previous);
					if (!endpoint) return;
					if (next.some(p => p.name === endpoint.name) || (previous?.name !== endpoint.name && ctx.modelRegistry.getProvider(providerId(endpoint.name)))) {
						return ctx.ui.notify(`The name ${endpoint.name} is already in use. No changes made.`, "error");
					}
					next.push(endpoint);
					updates.push(endpoint);
				}
			}
			saveEndpoints(file, snapshot, next);
			endpoints = next;
			for (const { name } of selected) if (!next.some(p => p.name === name)) pi.unregisterProvider(providerId(name));
			for (const endpoint of updates) pi.registerProvider(makeProvider(endpoint));
			ctx.ui.notify(action === "remove" ? `Removed: ${names.join(", ")}` : `Saved: ${updates.map(p => p.name).join(", ")}. Open /model to see available models.`, "info");
		},
	});
}
