# Open WebUI And Ollama

Open WebUI is the prebuilt CPU-only chat interface and authenticated automation
API at `https://ai.owl.red`. Fleet owns the Kubernetes workload. Its PostgreSQL
database/role is `openwebui` on the existing NAS database service; the retained
SMB PVC holds files/cache, never a SQLite application database. Vector/RAG,
local speech, tools, code execution, cloud providers and background generation
are not part of the initial deployment.

## Deployment

1. Run `node scripts/postgresql-run.mjs --validate-config` then
   `node scripts/postgresql-run.mjs --apply` from the repository root.
2. Run `node scripts/ollama-service-run.mjs prepare`, `plan`, then `apply`.
   Existing credentials, model files and containers are preserved; incompatible
   ownership/configuration is refused. Never print private logs or env files.
3. Publish only the approved source changes and activate the new bundle path
   through the existing Fleet GitRepo. Do not deploy a second Helm release or
   manually overwrite Fleet-owned application resources.
4. Once the `open-webui` namespace exists, run
   `node scripts/postgresql-run.mjs --apply --bootstrap-kubernetes --application openwebui`.
   This installs the operator bootstrap token privately and refuses mismatches.
   The Bitwarden operator maps only the four declared runtime credentials.
5. Let Fleet complete the rollout and Technitium reconcile the internal DNS
   record. Confirm the `open-webui` certificate and deployment are ready.

Initial login: `admin@owl.red`. Retrieve `open-webui__admin-password` privately
from Bitwarden Secrets Manager. The upstream product creates this owner only
when the database has no users; signup is disabled. After changing the password
in the UI, the bootstrap value is no longer the current login password.
`open-webui__secret-key` remains stable so sessions survive replacement pods.

## Models And API

`qwen2.5:3b` is the default; `qwen2.5:1.5b` is the faster, less reliable option.
Both model digests and the qualified Ollama image are pinned in
[the model registry](../../ansible/vars/llm.json). Model files remain at
`/mnt/ssd/appdata/llm-models`; no GPU is requested by the WebUI pod.

Use native Workspace Models presets and chat parameters rather than a custom
serving application. Defaults are context 4096, at most 512 generated tokens,
temperature 0.1 and `keep_alive: 0`. Presets are user-adjustable: these are not
hard request limits. Ollama allows one parallel request and one loaded model,
with an eight-request queue. Neither this nor unload-on-completion reserves
GPU capacity or preempts Plex/Frigate. A second revision pass is an explicit
second request, not a built-in accuracy guarantee.

Create an API key in Open WebUI's account settings. Send it as a Bearer token
to `POST https://ai.owl.red/api/chat/completions` with the model and messages,
or list models at `GET https://ai.owl.red/api/models`. Keep keys in your
automation's secret store, never command arguments, chat, source or logs.
Start with an appropriate dedicated account for ongoing automation rather
than distributing the owner's credentials. The ingress retains the same
administration-source allowlist as HA; other client networks are not enabled.

The UI connects server-side to `https://nas.owl.red:11434`, using the private
`open-webui__ollama-api-configs` credential. Nginx requires a separate token
`ollama__api-token`; Ollama itself has no published host port and is attached
only to the private `owl-llm` Docker network. Only the proxy has the external
bridge network. Do not expose raw Ollama or add browser-side direct connections.

## Validation And Maintenance

`node scripts/ollama-service-run.mjs verify` checks trusted TLS, unauthenticated
denial, pinned model availability, actual GPU inference, empty loaded-model
state and VRAM returning within 32 MiB of baseline while the same Ollama PID
stays alive. This is a bounded qualification check, not continuous monitoring.
The earlier temporary `llm-run.mjs` is diagnostic-only and refuses to start
while the persistent service exists.

Ollama and Nginx have bounded memory/CPU/log settings and restart policies.
Do not delete the shared model directory, application PVC or PostgreSQL database
to repair a failed rollout. Existing Plex/media paths and Frigate remain intact.
WebUI settings persist in its database; changing bootstrap environment defaults
does not necessarily overwrite previously saved native settings.

The proxy initially uses the valid `nas.owl.red` certificate from Kubernetes
Secret `home-assistant/frigate-tls`, copied privately into
`/mnt/ssd/appdata/ollama-service`. Certificate renewal distribution to the NAS
is not automated: Kubernetes renewal alone does not update these copies.
The provisioner refuses a different certificate/configuration until a reviewed
update is performed. Before expiry, validate and replace only the owned TLS
files, test Nginx configuration, reload only `ollama-https`, and reverify HTTPS.
Keep this renewal task on the roadmap until automated.