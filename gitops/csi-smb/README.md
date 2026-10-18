# NAS Appdata Over SMB

Fleet owns the upstream `csi-driver-smb` Helm release, pinned to `1.20.3`, in
`storage-system`. Do not install a parallel imperative Helm release. The
namespace and credential mapping are declared under
[the Bitwarden bundle](../bitwarden-secrets/generated/storage-system/unraid-smb-credentials-bitwardensecret.yaml).

## Status (2026-10-18)

- NAS account `k8s` exists with UID/GID `1001:100` and `/bin/false`.
- Appdata is private SMB; only `d0ntblink` and `k8s` have write grants. NAS-local
  SMB3 authentication, a temporary write/read and guest rejection pass.
- Media and all other share configurations, root/owner credentials and
  disk/array/network/global settings match the protected preimage. No existing
  application files were moved or ownership-reset. NFS stays disabled.
- The replacement Bitwarden token is verified. The operator delivered exactly
  `username` and `password` to `storage-system/unraid-smb-credentials`, with a
  private value comparison against the intended vault entries.
- The real chart renders 12 resources; its Kubernetes 1.31.1 server dry-run
  passes. The CSI workloads legitimately require privileged/host-network access;
  the dedicated namespace allows this, while restricted-policy audit warnings
  remain visible. Do not host ordinary applications in this namespace.
- The driver and StorageClass are **staged, not installed**. No PVC mount,
  Kubernetes write or cross-node rescheduling acceptance is claimed.

Native Unraid changed authorization during the bootstrap. Switching private
security cleared the grant list; explicit grants were reapplied and accepted.
It also omitted legacy `shareFruit=no` while global Fruit stayed disabled and
materialized an empty secondary-pool key. Those normalizations were checked
against effective SMB behavior rather than treated as new storage policy.

Private controller evidence:
`~/.local/state/owl-red/unraid-smb-GmLEvd/`. This is not a data backup or NAS
fallback. Account and share preimages also remain privately on the NAS.

## Requirements

- Existing Talos `1.8.1` / Kubernetes `1.31.1`, working private kubeconfig and
  matched Talos client. CIFS kernel support is confirmed; keep the existing
  kubelet path `/var/lib/kubelet`. No Talos upgrade is selected here.
- Controller Helm, kubectl and the existing Ansible virtual environment/PyYAML
  for structured rendering checks; HTTPS access to the pinned upstream chart
  and its container registries. Follow the
  [controller guide](../../docs/guides/controller-setup.md).
- Working Fleet reconciliation for this release, Bitwarden operator/CRD, the
  private namespace bootstrap token and the exact mapped secret above. Do not
  put passwords or machine tokens in values, Git, logs or command arguments.
- Node DNS for `nas.owl.red` and TCP 445 connectivity to the NAS. Qualify
  SMB 3.1.1 mounts from actual workloads before production use.

## Storage Contract

`nas-appdata-smb` is not a default StorageClass. It uses
`//nas.owl.red/appdata` with unique namespace/PVC/PV-derived directories,
`reclaimPolicy: Retain` and `onDelete: retain`. Deleting a PVC must not silently
delete its NAS data; reclaiming that data is a separate reviewed action.

Client-side modes map UID/GID `1001:100` with directories `0770` and files
`0660`; there is no `noperm` or world-write option. These are mount mappings,
not recursive server-side ownership changes. Applications needing different
UIDs, filesystem semantics or locking must be qualified separately. Do not
force existing application directories into this policy during cleanup.

SMB subdirectory PVC sizes do not enforce per-directory NAS quotas. Monitor
real SSD capacity; expansion is not advertised. Shared credentials are not
strong isolation between application directories. Other shares, including
guest-readable production media, retain their existing policy.

SQLite/network-filesystem concerns still apply. Shared storage is not permission
for multiple active Home Assistant writers, and retained directories are not
application-consistent backups or protection against NAS loss.

## Activation And Acceptance

Publish the reviewed source before applying the active
[Fleet-local GitRepo path update](../rancher/fleet/gitrepo-owl-red-fleet-local.yaml).
The Fleet-default file is the alternate namespace template, not a second
GitRepo to activate for this cluster. The existing Bitwarden bundle's
`takeOwnership` setting permits adoption of the source-defined bootstrap
namespace/mapping; the token itself remains a private bootstrap secret.

Require this bundle's desired/applied revision and ready workloads. Then use a
dedicated test namespace/PVC to prove authenticated create/read/delete,
permissions and persistence when its pod is recreated on another eligible
node. Test retained data deliberately without deleting unrelated PVs or NAS
paths. Clean up only the uniquely identified test data after acceptance.

No application migration, appdata cleanup, database deployment or production
media change is included. Wider Fleet/TLS and power/storage safety work remains
tracked separately in [the roadmap](../../ROADMAP.md).