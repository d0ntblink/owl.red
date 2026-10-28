# GWN Manager Controller

Production: `https://gwn.owl.red`, linked from Homepage. The unprivileged NixOS
LXC is CT `201` on `edge`, native `10.0.10.32/24`, MAC `02:6f:77:10:02:01`,
2 cores, 6 GiB RAM and 24 GiB local disk. It has no client-VLAN interfaces and
does not route or serve DHCP. AP control uses direct TCP `10014`, not ingress.

## Owners

- This independent Terraform root owns only the controller LXC lifecycle.
- [NixOS configuration](../../../nix/hosts/gwn-manager/configuration.nix) owns
  the service, firewall, users and pinned runtime. The vendor package/version,
  SHA-256 and allocation are in the
  [manifest](../../../ansible/vars/gwn-manager.json).
- [Manager API runner](../../../scripts/gwn-manager-run.mjs) owns the declared
  SSID fields from [Wi-Fi policy](../../../ansible/vars/wifi-networks.yml).
- [Ingress](../../../gitops/gwn-manager/) provides trusted TLS, verified backend
  TLS and the administration allowlist. Its backend CA file is public trust
  material, not a private key. Homepage/DNS sources remain their existing owners.

## Operations

Use the [controller tool prerequisites](../../../docs/guides/controller-setup.md).
The lifecycle wrapper needs Node 24, Nix, Terraform with the committed provider
lock, OpenSSH and the existing deployment key. The API runner also uses the
existing private Bitwarden CLI/profile and Python/PyYAML venv; no npm dependency
is needed. Credentials stay in private inputs, not command arguments or Git.

```bash
terraform -chdir=terraform/proxmox/gwn-manager init -lockfile=readonly
node scripts/gwn-lxc-run.mjs plan
node scripts/gwn-lxc-run.mjs inspect
node scripts/gwn-manager-run.mjs inspect-production
node scripts/gwn-manager-run.mjs ap-plan-production
GWN_MANAGER_APPLY_ALLOWED=true node scripts/gwn-manager-run.mjs apply-production
```

`plan` accepts only a no-op or creation of this single unprivileged container.
Updates/replacements are refused for review. Creation is single-request guarded;
after an uncertain result inspect actual CT/state instead of retrying blindly.
`prevent_destroy` protects the Terraform resource, not every Proxmox operation.

The production account was initialized by the user. Reuse Bitwarden's **GWN
Manager** login; contact `admin@owl.red`. Production OAuth app credentials are
separate from the temporary WSL instance. The backend CA and private API inputs
are controller-local under `~/.local/state/owl-red/gwn-manager/`.

## NixOS Deployment

```bash
nix-build nix/hosts/gwn-manager/check.nix -A system --no-out-link --max-jobs 2 --cores 2
GWN_LXC_APPLY_ALLOWED=true node scripts/gwn-lxc-run.mjs deploy
```

The wrapper transfers the built closure through trusted `edge` SSH and native
`pct exec`, sets CT `201`'s system profile and activates it. It checks router
VM `103` and DNS CT `200` configurations remain unchanged. No mixed-root apply
or host/network reload is part of this path.

The package extracts the fixed vendor archive without running Debian maintainer
scripts. Normal ELF dependencies and shell paths are patched. The opaque gateway
executable must remain byte-identical to the vendor copy and uses `nix-ld`;
rewriting that executable broke its embedded Node bootstrap. Shared vendor SSH
identities are excluded. The service uses the vendor checker under user `gwn`,
with a guarded root initializer and writable state at `/var/lib/gwn-manager`
(`/gwn` is its link). Nginx temp files live in state, not the Nix store.

Cold startup is sequential and can take several minutes. Verify the JSON
`/app/wizard/initial_info` endpoint as well as HTTPS; an active checker or static
login page alone is not application readiness.

## Recovery And Publication

Private preimages and operation markers live under
`~/.local/state/owl-red/gwn-lxc/` and `~/.local/state/owl-red/gwn-manager/`.
They are not independent backups. Do not copy old database directories over a
running controller. Review state and take a native database/configuration backup
before upgrades; restore testing and controller-outage acceptance remain pending.

The initializer refuses unknown existing state and vendor-version changes.
Same-version managed binary-path rebinding preserves configuration/data. Do not
remove its ownership marker to force an upgrade or rerun initialization.

Frontend certificates renew through cert-manager. The generated backend leaf/CA
is independent: renew it before expiry and update the public trust anchor,
runtime CA input and ingress Secret together. No automatic backend certificate
rotation job is configured.

Live ingress/Homepage/DNS were applied from the local source without a commit or
push. The new Fleet path is declared in both source GitRepo templates; publish
the reviewed files and reconcile the active GitRepo path before relying on Fleet
for ongoing ownership. Do not silently publish unrelated work.