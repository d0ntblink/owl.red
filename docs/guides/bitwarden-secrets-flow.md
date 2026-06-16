# Bitwarden in owl.red — `bw`, `bws`, and the Kubernetes Operator

How secrets flow in this homelab, end to end. There are **two independent Bitwarden
products** doing two different jobs. Knowing which is which prevents most confusion.

> Authority: [ADR 003](../decisions/003-secrets-bitwarden.md). Hard rule:
> **no plaintext secrets in Git** ([SECURITY.md](../../SECURITY.md)).

---

## TL;DR — the two layers

| | Password Manager (`bw`) | Secrets Manager (`bws` + Operator) |
|---|---|---|
| **CLI** | `bw` | `bws` |
| **Consumer** | Ansible (host/infra automation) | Kubernetes workloads |
| **Auth unit** | Your account, unlocked → `BW_SESSION` | A **machine account** → access token |
| **Data unit** | Vault **items** (login/note) referenced by name | **secrets** referenced by **UUID**, grouped in a **project** |
| **Direction** | Pulled at runtime by a script | Pulled continuously into k8s `Secret`s by an operator |
| **Where in repo** | [`scripts/ansible-run.sh`](../../scripts/ansible-run.sh) | [`gitops/bitwarden-operator/`](../../gitops/bitwarden-operator/), [`gitops/bitwarden-secrets/`](../../gitops/bitwarden-secrets/) |
| **Example secret** | `proxmox-root-password` | `cloudflare-owl.red-api-token` |

Mnemonic: **`bw` = humans + Ansible; `bws`/operator = robots + Kubernetes.**

---

## Layer 1 — Password Manager (`bw`) for Ansible

Used for infrastructure credentials Ansible needs at runtime: Proxmox root password,
NUT passwords, OPNsense API key, WiFi PSK, SSH material, etc. (full list in
[ADR 003 "Secret Mapping"](../decisions/003-secrets-bitwarden.md)).

### How it authenticates

`bw` is account-based. You log in once (API key), then **unlock** to get a
short-lived `BW_SESSION` token that every subsequent `bw` call uses:

```bash
bw login --apikey          # one-time; needs BW_CLIENTID / BW_CLIENTSECRET
export BW_SESSION="$(bw unlock --raw)"   # per shell; prompts for master password
bw get password proxmox-root-password    # uses BW_SESSION implicitly
```

### How owl.red wraps it: `scripts/ansible-run.sh`

You rarely call `bw` directly. [`scripts/ansible-run.sh`](../../scripts/ansible-run.sh)
resolves the Proxmox password **just-in-time**, exports it, and `exec`s your command —
so the secret lives only in the process environment, never on disk.

```bash
# auto: try bws first, fall back to bw
scripts/ansible-run.sh ansible-playbook \
  -i ansible/inventory/hosts.yml ansible/playbooks/02-proxmox-prep.yml
```

Source order is controlled by `PROXMOX_PASSWORD_SOURCE`:

| Value | Behavior |
|-------|----------|
| `auto` (default) | Try `bws` (by `…_BWS_SECRET_ID`), else `bw` (by `…_BW_ITEM`) |
| `bws` | Secrets Manager only |
| `bw` | Password Manager only |

Relevant env vars (set in the git-ignored `env.secret`, then `source` it):

```bash
PROXMOX_PASSWORD_SOURCE=bw
PROXMOX_ROOT_PASSWORD_BW_ITEM="proxmox-root-password"   # item name or UUID
# or, for the bws path:
PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID="<secret-uuid>"
BWS_ACCESS_TOKEN="<machine-account-token>"
```

The wrapper also exports `ANSIBLE_PASSWORD`, and the Ansible README documents how it
injects `ansible_password` / `ansible_become_password` for plays that need it.

> Note: the bootstrap token that the operator uses (`bitwarden-sm-access-token`) is
> itself stored as a `bw` secure note (ADR 003). That's the bridge between the two
> layers — Layer 1 hands Layer 2 its credential.

---

## Layer 2 — Secrets Manager (`bws`) + the Kubernetes Operator

Used for secrets that **Kubernetes workloads** consume: the Cloudflare DNS-01 API
token, Plex claim token, app admin passwords, etc.

### The vocabulary (different from `bw`)

- **Machine account** — a non-human identity with an **access token**
  (`BWS_ACCESS_TOKEN`). Scoped to one or more projects, least-privilege.
- **Project** — a container for secrets. owl.red uses `owl-red-infra`
  (`projectId 89090d54-…`).
- **Secret** — a key/value, referenced by **UUID** (not name). You find UUIDs with
  `bws secret list`.

```bash
export BWS_ACCESS_TOKEN="<machine-account-token>"
bws project list                 # find the project UUID
bws secret list                  # list secrets (id, key, projectId)
bws secret get <secret-uuid>     # fetch one (value included — handle carefully)
```

### The operator (`sm-operator`)

Installed by Fleet/Helm from [`gitops/bitwarden-operator/`](../../gitops/bitwarden-operator/)
into namespace `sm-operator-system`. It is **pull-based**: Bitwarden → Kubernetes. It
never pushes existing k8s secrets back. Key settings
([values.yaml](../../gitops/bitwarden-operator/values.yaml)):

- `bwSecretsManagerRefreshInterval: 300` — re-syncs every 5 minutes.
- `replicas: 2`, leader-elected, tolerates control-plane nodes.

### Two objects per namespace

**1. `bw-auth-token`** — a plain k8s Secret holding the machine-account token. The
operator reads it to authenticate. **Every namespace that has a `BitwardenSecret`
needs one:**

```bash
kubectl -n <namespace> create secret generic bw-auth-token \
  --from-literal=token='<machine-account-access-token>'
```

**2. `BitwardenSecret` (CR)** — the mapping that says "pull these BWS secret UUIDs
into a native k8s Secret named X." Example (the real Cloudflare token,
[generated manifest](../../gitops/bitwarden-secrets/generated/cert-manager/cloudflare-api-token-bitwardensecret.yaml)):

```yaml
apiVersion: k8s.bitwarden.com/v1
kind: BitwardenSecret
metadata:
  name: bw-cloudflare-api-token
  namespace: cert-manager
spec:
  organizationId: "202b0b27-…"
  secretName: cloudflare-api-token   # the k8s Secret the operator creates/owns
  onlyMappedSecrets: true            # only sync the UUIDs listed in map:
  map:
    - bwSecretId: "72cb2e7d-be1d-49c2-811a-b43a004c075d"   # UUID from `bws secret list`
      secretKeyName: api-token       # becomes data.api-token in the k8s Secret
  authToken:
    secretName: bw-auth-token        # how the operator authenticates
    secretKey: token
```

The operator then creates/owns the Secret `cert-manager/cloudflare-api-token` with
key `api-token`, and **cert-manager's ClusterIssuer reads that key** for DNS-01.

### End-to-end flow (Cloudflare token example)

```
bws (owl-red-infra project)
  └─ secret 72cb2e7d… "cloudflare-owl.red-api-token"
        │  (sm-operator authenticates with bw-auth-token, every 300s)
        ▼
BitwardenSecret bw-cloudflare-api-token  (cert-manager ns)
        │  maps UUID → key "api-token"
        ▼
k8s Secret  cert-manager/cloudflare-api-token   (operator-owned)
        │  apiTokenSecretRef.key = api-token
        ▼
ClusterIssuer letsencrypt-prod  →  ACME DNS-01  →  Certificate dns.owl.red
```

---

## The migration script: `bitwarden-k8s-secrets-sync.sh`

[`scripts/bitwarden-k8s-secrets-sync.sh`](../../scripts/bitwarden-k8s-secrets-sync.sh)
is a one-time/occasional helper that **pushes** selected existing k8s Secrets *into*
BWS, then renders `BitwardenSecret` manifests to pull them back. It is the reverse
direction from the operator and exists only to migrate already-running secrets into
the GitOps model.

```bash
BW_PROJECT_ID=<project-id> \
BW_ORGANIZATION_ID=<org-id> \
BWS_ACCESS_TOKEN=<machine-account-token> \
scripts/bitwarden-k8s-secrets-sync.sh
# → writes gitops/bitwarden-secrets/generated/<ns>/<name>-bitwardensecret.yaml
```

### ⚠️ Only migrate human-provided input credentials

This script must **not** sweep up secrets a controller generates/rotates, or
Fleet/cluster-internal secrets — if it does, the operator will later overwrite the
live (rotated) value with a frozen copy and break things. This actually happened:
see [issue 007](../issues/007-bitwarden-secrets-swept-controller-managed.md). The
script is now hardened to exclude by secret **type**, **ownerReference**, and
**name** (TLS, Helm releases, `fleet.cattle.io/*`, webhook CAs, kubeconfigs, …).

Legitimate things to keep in `bitwarden-secrets`: DNS API tokens, app admin
passwords, ACME account keys, the GitHub PAT (`owl-red-github-auth`), the Rancher
bootstrap password.

---

## Operating playbook

### Add a new workload secret to Kubernetes

1. Put the value in BWS (`owl-red-infra` project); note its UUID (`bws secret list`).
2. Create `gitops/bitwarden-secrets/generated/<ns>/<name>-bitwardensecret.yaml`
   mapping that UUID → the key your app expects.
3. Ensure the target namespace has a `bw-auth-token` Secret.
4. Confirm the namespace is covered by a Fleet GitRepo path; commit & push.
5. Verify: `kubectl -n <ns> get secret <name> -o jsonpath='{.data}'` shows the key.

> **Never commit a placeholder `bwSecretId`.** A placeholder syncs an *empty* secret
> while the operator still reports `SuccessfulSync` — exactly the silent failure in
> [issue 007](../issues/007-bitwarden-secrets-swept-controller-managed.md).

### Add a new infra secret for Ansible

1. Create a login item / secure note in the Password Manager vault.
2. Reference it by name in the relevant `…_BW_ITEM` var (or via the lookup plugin).
3. Run through `scripts/ansible-run.sh` so it's resolved at runtime, never stored.

### Rotate the machine-account token

1. Rotate in the Bitwarden SM UI.
2. Update each `bw-auth-token` Secret with the new token.
3. Update the `bw` secure note (`bitwarden-sm-access-token`) and `env.secret`.
4. Force a resync (restart the operator or wait one refresh interval) and confirm
   `BitwardenSecret` status is `SuccessfulSync`.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Target k8s Secret is **empty** but CR says `SuccessfulSync` | Placeholder/wrong `bwSecretId`, or `onlyMappedSecrets: true` with no valid map entry | Fix the UUID (`bws secret list`); delete the empty Secret to force a clean resync |
| `BitwardenSecret` not syncing at all | Missing/invalid `bw-auth-token` in that namespace; machine account lacks project access | Recreate `bw-auth-token`; verify `bws secret get <uuid>` works with that token |
| Operator logs "No changes … Skipping sync" after you edited the CR | Operator hash/debounce cache | Delete the operator pod(s) and/or the target Secret to force a fresh reconcile |
| A controller-managed secret keeps reverting | It was wrongly migrated into BWS | Remove that generated manifest; let Fleet prune the CR — see [issue 007](../issues/007-bitwarden-secrets-swept-controller-managed.md) |
| Ansible can't find a secret | Vault locked / `BW_SESSION` unset, or wrong `…_BW_ITEM` | Re-`bw unlock`; `scripts/ansible-run.sh` handles this automatically |
| `bws` returns non-JSON / empty | `BWS_ACCESS_TOKEN` unset or expired | `source env.secret`; confirm the token in the SM UI |

Useful checks:

```bash
# Operator health + recent sync decisions
kubectl -n sm-operator-system get pods
kubectl -n sm-operator-system logs <pod> --since=10m | rg -i 'sync|error'

# A specific BitwardenSecret's status
kubectl -n <ns> get bitwardensecret <name> \
  -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.message}{"\n"}{end}'

# Does the machine account actually see a secret?
BWS_ACCESS_TOKEN=<token> bws secret get <uuid> --output json | jq '.key'
```

---

## Security notes

- `BWS_ACCESS_TOKEN`, `BW_SESSION`, and master passwords live only in the
  git-ignored `env.secret` or the process environment — never in tracked files
  (`*.secret` is in [.gitignore](../../.gitignore)).
- `BitwardenSecret` manifests are safe to commit: they contain only **UUID
  references and key names**, never values. (`git grep` for a token prefix like
  `cfut_` should return nothing.)
- Machine-account tokens are least-privilege, scoped to `owl-red-infra`, and rotated
  on a cadence (ADR 003). Bootstrap tokens are break-glass material.

---

## References

- [ADR 003 — Secrets management with Bitwarden + SM operator](../decisions/003-secrets-bitwarden.md)
- [Issue 007 — BitwardenSecret sync swept controller-managed secrets](../issues/007-bitwarden-secrets-swept-controller-managed.md)
- [`gitops/bitwarden-operator/`](../../gitops/bitwarden-operator/) — operator Helm bundle
- [`gitops/bitwarden-secrets/`](../../gitops/bitwarden-secrets/) — `BitwardenSecret` manifests
- [`scripts/ansible-run.sh`](../../scripts/ansible-run.sh) — `bw`/`bws` runtime resolver for Ansible
- [`scripts/bitwarden-k8s-secrets-sync.sh`](../../scripts/bitwarden-k8s-secrets-sync.sh) — k8s→BWS migration helper
- [Glossary](../glossary.md) — Bitwarden PM/SM, BitwardenSecret, operator entries
