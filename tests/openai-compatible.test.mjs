import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createModels } from '@earendil-works/pi-ai/models';
import openaiCompatible from '../src/index.ts';

function start() {
	const models = createModels();
	let command;
	openaiCompatible({
		registerProvider: p => models.setProvider(p), unregisterProvider: id => models.deleteProvider(id),
		registerCommand: (name, spec) => { assert.equal(name, 'openai-compat-providers'); command = spec.handler; },
	});
	return { models, run(args, ...answers) {
		const answer = () => { assert.ok(answers.length, 'unexpected dialog'); return answers.shift(); };
		return command(args, { mode: 'tui', modelRegistry: models, ui: {
			input: answer, select: answer, confirm: answer,
			custom: factory => new Promise(resolve => {
				const field = factory(null, null, null, resolve);
				const key = answer();
				if (key === undefined) return field.onEscape();
				field.setValue(key);
				if (key) assert.ok(!field.render(60).join(' ').includes(key));
				field.onSubmit(key);
			}),
			notify: (message, level) => { if (level === 'error') throw new Error(message); },
		} });
	} };
}

test('named endpoints survive reload; discovery and chat use only their own URL and credentials', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'pi-providers-test-'));
	const oldDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(() => {
		if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = oldDir;
		rmSync(dir, { recursive: true, force: true });
	});
	const seen = [];
	const server = createServer((req, res) => {
		seen.push([req.url, req.headers.authorization]);
		if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'shared' }] }));
		res.writeHead(200, { 'Content-Type': 'text/event-stream' });
		res.end('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	const url = `http://127.0.0.1:${server.address().port}`;
	const key = '!literal-$TEST';
	const file = join(dir, 'openai-compatible.json');
	assert.equal(start().models.getProvider('tabby'), undefined);
	// Existing personal settings remain usable after switching packages.
	writeFileSync(file, JSON.stringify([{ name: 'tabby', baseUrl: `${url}/old/v1`, apiKey: '', profile: 'tabby' }]), { mode: 0o600 });
	let app = start();
	const otherSession = start();
	assert.ok(app.models.getProvider('tabby'));
	await app.run('add', 'local', `${url}/local/v1/`, '');
	await app.run('add', 'remote', `${url}/remote/v1`, key);
	await assert.rejects(otherSession.run('remove tabby', true), /another session/);
	assert.equal(statSync(file).mode & 0o777, 0o600);
	app = start();
	for (const name of ['local', 'remote']) {
		const id = `openai-compatible-${name}`;
		await app.models.refresh({ providers: [id], allowNetwork: true });
		const model = app.models.getModel(id, 'shared');
		assert.ok(model);
		assert.equal(model.reasoning, false);
		const reply = await app.models.completeSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] });
		assert.equal(reply.stopReason, 'stop', reply.errorMessage);
	}
	assert.deepEqual(seen, ['local', 'remote'].flatMap(name => ['models', 'chat/completions'].map(path =>
		[`/${name}/v1/${path}`, name === 'remote' ? `Bearer ${key}` : undefined])));

	const before = readFileSync(file, 'utf8');
	await app.run('edit local remote', '', '', 'new-key', undefined); // Escape midway cancels the batch.
	await app.run('remove local remote', false);
	await assert.rejects(app.run('remove local unknown'), /Unknown provider name/);
	assert.equal(readFileSync(file, 'utf8'), before);
	await app.run('edit local remote', 'renamed', '', '', '', '', 'Keep');
	await app.run('edit remote', '', `${url}/other/v1`, ''); // URL change never carries the old key.
	assert.ok(app.models.getProvider('openai-compatible-renamed'));
	assert.ok(!readFileSync(file, 'utf8').includes(key));
	await app.run('edit tabby', '', `${url}/forge/v1`, '');
	await app.models.refresh({ providers: ['tabby'], allowNetwork: true });
	const tabby = app.models.getModel('tabby', 'shared');
	assert.equal(tabby.contextWindow, 106496);
	assert.equal(tabby.compat.thinkingFormat, 'qwen-chat-template');
	await app.run('remove tabby remote renamed', true);
	assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
	assert.equal(start().models.getProvider('tabby'), undefined);
});
