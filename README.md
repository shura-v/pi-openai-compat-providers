# pi-openai-compat-providers

Manage named endpoints that implement the **OpenAI Chat Completions API** in Pi. Each server must support `GET <baseUrl>/models` for discovery and `POST <baseUrl>/chat/completions` for chat. Pi also supports the Responses API, but this extension does not call `/responses` or the legacy text `/completions` endpoint.

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

Use Node 24, run `npm ci`, then `npm test`. The integration test uses a temporary settings directory and a loopback HTTP server.

## Releases

The first merge of the release workflow into `main` publishes the existing `0.1.0` version if it is not on npm yet. No initial changeset or manual version bump is needed. **Before merging**:

1. In GitHub → Settings → Actions → General, enable **Allow GitHub Actions to create and approve pull requests**.
2. For the first publish, add an Actions secret named `NPM_TOKEN` with a short-lived npm granular token that can create this unscoped package and publish without an interactive 2FA prompt. After the first release, configure an npm trusted publisher for `shura-v/pi-openai-compat-providers`, workflow `publish.yml`, with publish permission; remove the bootstrap secret and revoke the token.

For subsequent user-facing changes, run `npm run changeset` in the feature branch and include the generated file in the PR. After merge, Changesets opens a release PR with the version and changelog. Merging that PR runs the tests and publishes to npm, then creates the Git tag and GitHub Release. Once published, install with `pi install npm:pi-openai-compat-providers`.
