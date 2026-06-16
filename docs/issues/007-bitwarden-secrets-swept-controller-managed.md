# Issue 007 — BitwardenSecret sync swept controller-managed secrets

**Date:** 2026-06-15
**Affected:** `scripts/bitwarden-k8s-secrets-sync.sh`, `gitops/bitwarden-secrets/generated/`
**Severity:** High — froze rotating/controller-owned secrets in Bitwarden; broke the
`owl-red-gitops-traefik` Fleet bundle (hash mismatch) and blocked the `dns.owl.red`
TLS certificate for ~27 days.
**Status:** Fixed (repo); one live step pending push (traefik contents secret regen)

---

## Symptoms

- `owl-red-gitops-traefik` bundle stuck: `targeting error: retrying, hash mismatch
  between secret and bundledeployment`.
- `technitium-tls` Certificate stuck `Ready=False` for 27 days; challenge error
  `specified key "api-token" not found in secret cert-manager/cloudflare-api-token`
  (the target secret was empty).
- Many live secrets carried the label `k8s.bitwarden.com/bw-secret` despite being
  generated/rotated by their own controllers.

---

## Root Cause

`scripts/bitwarden-k8s-secrets-sync.sh` enumerates **all** namespaced secrets and
pushes them into Bitwarden Secrets Manager, then generates `BitwardenSecret` CRs
that pull them back. Its only exclusions were service-account tokens, Helm release
secrets, `kube-root-ca.crt`, and `bw-auth-token`.

That swept up secrets that must never be frozen in Bitwarden because a controller
owns and rotates them, or because they are Fleet-internal:

| Swept secret | Real owner | Why it breaks |
|--------------|-----------|---------------|
| `cluster-fleet-local-local-*/owl-red-gitops-traefik` (type `fleet.cattle.io/bundle-deployment/v1alpha1`) | Fleet BundleDeployment | Operator overwrites Fleet's own contents secret with a 35-day-old copy → hash never matches → bundle wedged |
| `fleet-local/owl-red-gitops-traefik` | Fleet | same class |
| `cattle-fleet-local-system/fleet-agent`, `fleet-local/local-kubeconfig` | Fleet / Rancher | cluster credentials, rotate |
| `cattle-system/tls-rancher*`, `serving-cert`, `cattle-webhook-*` | Rancher / cert-manager | TLS, rotates |
| `cert-manager/cert-manager-webhook-ca` | cert-manager | CA, rotates |
| `metallb-system/metallb-memberlist`, `metallb-webhook-cert` | MetalLB | generated/rotates |
| `cattle-capi-system/capi-*` | CAPI controller | controller-managed |

Once frozen, every time the owning controller rotated its secret, the Bitwarden
operator would overwrite it back to the stale value — a latent outage for each.

A separate data bug: the Cloudflare token's generated manifest shipped with a
placeholder `bwSecretId: "REPLACE-WITH-BWS-SECRET-UUID"`, so `cloudflare-api-token`
synced as an **empty** secret (the operator maps zero secrets and reports
`SuccessfulSync`). cert-manager DNS-01 then had no token.

---

## Resolution

### Repo

1. Removed the 18 generated manifests that targeted controller-managed / Fleet-internal
   secrets (kept only genuine human-provided credentials: `cloudflare-api-token`,
   `owl-red-github-auth`, `letsencrypt-prod-key`, `letsencrypt-staging-key`,
   `bootstrap-secret`).
2. Hardened `scripts/bitwarden-k8s-secrets-sync.sh`:
   - **Exclude by secret TYPE**: service-account-token, `kubernetes.io/tls`,
     docker-config, Helm release, and `fleet.cattle.io/*` (bundle-deployment).
   - **Skip secrets that carry `ownerReferences`** — they are controller-managed.
   - Broadened the name exclusion regex (`*-webhook-ca`, `*-webhook-cert`,
     `*-cert-ca`, `fleet-agent`, `*-kubeconfig`, `letsencrypt-production`).
   - A dry-run of the new filter yields only the five legitimate credentials above.
3. Fixed the Cloudflare token manifest to the real BWS secret UUID.

### Live cluster

- Placed the real Cloudflare token into `cert-manager/cloudflare-api-token`, cleared
  the stale ACME order/challenges → `technitium-tls` issued (`Ready=True`) →
  `owl-red-gitops-technitium-ingress` bundle `1/1`.
- **Pending push:** once the 18 manifests are removed on `origin/main`, Fleet prunes
  the `bw-owl-red-gitops-traefik` BitwardenSecret CRs. Then delete the stale Fleet
  contents secret so the BundleDeployment regenerates it:
  ```bash
  kubectl -n cluster-fleet-local-local-1a3d67d0a899 delete secret owl-red-gitops-traefik
  kubectl -n fleet-local patch gitrepo owl-red --type=merge \
    -p '{"spec":{"forceSyncGeneration":'"$(date +%s)"'}}'
  ```

### Ownership-cascade safety

Audited `ownerReferences` before removing manifests: only `cloudflare-api-token` is
owned by its BitwardenSecret (kept). All other swept targets are owned by their real
controller or nothing, so Fleet pruning their BitwardenSecret CRs does **not**
cascade-delete the live secrets.

---

## Prevention

- The sync script must only migrate **human-provided input credentials**. Anything a
  controller generates or rotates, or any Fleet/cluster-internal secret, is excluded
  by type / ownerReference / name.
- Re-running the hardened script is idempotent and will not re-introduce the swept
  secrets (verified by dry-run).
- Never store a placeholder `bwSecretId`; fill the real UUID (`bws secret list`)
  before committing a generated manifest, or the target secret syncs empty.

---

## References

- Issue 006 — Fleet SSA field-ownership conflict (metallb), found in the same pass
- ADR 003 — Secrets management with Bitwarden + SM operator
- ADR 014 — Fleet bundle ownership boundaries
- `scripts/bitwarden-k8s-secrets-sync.sh` — hardened filter
