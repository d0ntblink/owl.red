# Open WebUI And Ollama

The selected application is one NAS container containing Open WebUI and Ollama,
with an authenticated chat/API interface at `https://ai.owl.red`. Fleet owns
its TLS ingress, not the application process. PostgreSQL database/role
`openwebui` remains on the existing NAS database service. The original retained
PVC directory is mounted locally into the container; accounts and settings
remain in PostgreSQL, never SQLite on SMB. The old Kubernetes deployment and
PVC are retained for rollback, with the old deployment stopped after cutover.

The public image source and `master` build workflow live in
[d0ntblink/open-webui-ollama](https://github.com/d0ntblink/open-webui-ollama).
CI publishes `latest` and commit-specific tags to Docker Hub using a dedicated
GitHub Actions secret. It does not deploy the NAS. Pin a qualified digest in
[the target registry](../../ansible/vars/llm.json); never deploy floating latest.
Vector/RAG, local speech, tools, code execution, cloud providers and background
generation are outside this chat/API deployment.

## Deployment

1. Keep the existing PostgreSQL role, Bitwarden runtime mapping, session key,
   model cache and retained WebUI volume. Run the canonical PostgreSQL lane
   only when provisioning database identities or its private operator token.
2. Run `node scripts/ollama-service-run.mjs combined-plan`, then
   `combined-prepare` from the repository root. Preparation validates storage,
   pulls the pinned image and creates a private NAS runtime file. It does not
   stop live services. Different credentials/configuration require review.
3. Publish the old WebUI deployment's `replicas: 0` through Fleet and wait until
   its pod is absent. Never start two application writers on the same files.
4. Run `node scripts/ollama-service-run.mjs combined-apply`. It stops only the
   owned old Ollama daemon and starts the combined container and its TLS proxy.
   If native startup fails immediately, it restarts the old daemon. Delayed
   failures still require validation and the rollback procedure below.
5. Run `node scripts/ollama-service-run.mjs combined-configure` to update the
   persisted model connection using the native WebUI admin API. Environment
   defaults alone do not replace saved connection settings. A private preimage
   is retained on the controller for rollback.
6. Run `node scripts/ollama-service-run.mjs combined-verify` before publishing
   the NAS ingress target. After Fleet reconciliation, rerun it with `--ingress`
   to qualify the actual `ai.owl.red` path. No competing Helm release or manual
   overwrite of Fleet-owned application resources is needed.

Initial login: `admin@owl.red`. Retrieve `open-webui__admin-password` privately
from Bitwarden Secrets Manager. The upstream product creates this owner only
when the database has no users; signup is disabled. After changing the password
in the UI, the bootstrap value is no longer the current login password.
`open-webui__secret-key` remains stable so sessions survive replacement pods.

## Models And API

`qwen2.5:3b` is the default; `qwen2.5:1.5b` is the faster, less reliable option.
Both model digests and the qualified component/combined images are pinned in
[the model registry](../../ansible/vars/llm.json). Model files remain at
`/mnt/ssd/appdata/llm-models`. The combined application receives NVIDIA access;
the Kubernetes ingress does not run a model or UI process.

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

The UI connects to bundled Ollama at container-local `127.0.0.1:11434`; there
is no published raw model port. A separate Nginx TLS infrastructure proxy on
`https://nas.owl.red:11436` forwards the UI/API, which enforces native login/API
authentication. Traefik retains the administration allowlist and verifies the
NAS certificate with its `nas.owl.red` server name. Do not add browser-side
direct model connections or disable backend certificate verification.

## Validation And Maintenance

`node scripts/ollama-service-run.mjs combined-verify --ingress` checks trusted
TLS, existing owner login, native API-key authentication, both model choices,
actual bundled GPU inference, empty loaded-model state and VRAM returning within
32 MiB of baseline while the same application PID stays alive. A temporary API
key is removed afterward; existing keys are preserved. This is a bounded
qualification check, not continuous monitoring.
The earlier temporary `llm-run.mjs` is diagnostic-only and refuses to start
while the persistent service exists.

The application and Nginx have bounded memory/CPU/log settings and restart
policies. The application is read-only except for its existing data/model mounts
and bounded temporary filesystem. It uses container UID 0/GID 100 to access the
existing root-owned model cache without recursive ownership changes; capabilities
are dropped, privilege escalation is disabled, and no Docker socket is mounted.
Docker health checks both processes; unhealthy status alone does not trigger
an automatic Docker restart.
Do not delete the shared model directory, application PVC or PostgreSQL database
to repair a failed rollout. Existing Plex/media paths and Frigate remain intact.
WebUI settings persist in its database; changing bootstrap environment defaults
does not necessarily overwrite previously saved native settings.

The proxy uses the valid `nas.owl.red` certificate from Kubernetes Secret
`home-assistant/frigate-tls`, copied privately into
`/mnt/ssd/appdata/open-webui-service`. Certificate renewal distribution to the NAS
is not automated: Kubernetes renewal alone does not update these copies.
The provisioner refuses a different certificate/configuration until a reviewed
update is performed. Before expiry, validate and replace only the owned TLS
files, test Nginx configuration, reload only `open-webui-https`, and reverify HTTPS.
Keep this renewal task on the roadmap until automated.

## Rollback

While the combined UI is reachable, run `combined-restore-connection` to restore
the original native model connection from the private controller preimage. Then
run `combined-rollback` to stop only the owned combined application/proxy and
restart the original Ollama daemon. Restore the old Kubernetes Service/ingress
definition and `replicas: 1` through Fleet, wait for readiness, and verify owner
login plus model listing. Do not run both writers concurrently or delete/recreate
the PVC/database. No database schema downgrade is involved because the WebUI
version is unchanged. If the combined UI is unavailable, restore the old writer
first, then restore its connection using the same native API and private preimage.