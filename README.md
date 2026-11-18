# pi-openai-compat-providers

Manage named OpenAI-compatible endpoints in Pi. Each provider uses its own base URL and optional API key for both model discovery and chat.

## Use

1. Install the package: `pi install git:github.com/shura-v/pi-openai-compat-providers`. To use a local checkout, run `pi install .` from its root. Run `/reload` in an existing Pi session.
2. Run `/openai-compat-providers add` and enter a short name, the full API base URL (e.g. `http://localhost:8000/v1`), and an API key. Leave the masked key field blank for an anonymous endpoint.
3. Open `/model` to discover models via `GET <baseUrl>/models`. New provider IDs are `openai-compatible-<name>`; the legacy `tabby` ID is preserved.

## Edit and remove

Run `/openai-compat-providers` for the menu. `edit` and `remove` let you pick a name or specify several names in one command:

```text
/openai-compat-providers edit home work
/openai-compat-providers remove home work
```

Enter keeps the current name and URL when editing. Keys can be kept, replaced, or cleared. A URL change requires entering the key again. Switch away from an active provider before editing or removing it. Esc cancels the entire batch; removal requires confirmation.

## Storage

A fresh installation starts empty. Existing `openai-compatible.json` settings are read from Pi's agent directory (normally `~/.pi/agent`) without migration. API keys are stored **unencrypted**, with owner-only permissions (`0600`). Keep this file out of Git and use HTTPS for authenticated remote servers.

## Test

With Node 24+ and the Pi peer dependencies installed, run `npm test`. The integration test uses a temporary settings directory and a loopback HTTP server.
