# NAS Appdata Over SMB

Fleet owns the upstream `csi-driver-smb` Helm release, pinned to `1.20.3`, in
`storage-system`. Do not install a parallel imperative Helm release. The
namespace and credential mapping are declared under
[the Bitwarden bundle](../bitwarden-secrets/generated/storage-system/unraid-smb-credentials-bitwardensecret.yaml).

## Deployment

The Fleet bundle is active with two controllers and node plugins on all four
nodes. `nas-appdata-smb` is available for explicitly selected workloads.
The non-login NAS account `k8s` uses UID/GID `1001:100`; private appdata grants
remain limited to `d0ntblink` and `k8s`. Bitwarden supplies the two-field
`storage-system/unraid-smb-credentials` secret.

A disposable PVC passed authenticated writes, UID/GID/mode checks and
persistence between `worker1-talos` and `cp3-talos`. Its NAS files remained
after claim deletion under the Retain policy. Only that test's files and
resources were removed; protected NAS configuration remained unchanged.
NFS stays disabled and production media is unchanged.

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

The CSI workloads require privileged/host-network access. Keep ordinary
applications outside `storage-system`; do not relax their namespace policies.

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

## Request A Volume

Add a claim to the application's Fleet bundle, using its own namespace:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: appdata
  namespace: example-app
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: nas-appdata-smb
  resources:
    requests:
      storage: 1Gi
```

Reference `appdata` through the workload's `persistentVolumeClaim.claimName`.
Run qualified clients as UID/GID `1001:100`, or explicitly review their
permission requirements. The size is a provisioning request, not an SMB quota.
`ReadWriteMany` permits mounting from multiple nodes; it does not make an
application safe for concurrent writers. Keep retained PV/data reclamation
separate from ordinary application removal.

## Activation And Acceptance

Publish the reviewed source before applying the active
[Fleet-local GitRepo path update](../rancher/fleet/gitrepo-owl-red-fleet-local.yaml).
The Fleet-default file is the alternate namespace template, not a second
GitRepo to activate for this cluster. The existing Bitwarden bundle's
`takeOwnership` setting permits adoption of the source-defined bootstrap
namespace/mapping; the token itself remains a private bootstrap secret.

Keep `helm.disablePreProcess: true` in [fleet.yaml](fleet.yaml). The SMB driver
must receive literal `${pvc.metadata.namespace}`, `${pvc.metadata.name}` and
`${pv.metadata.name}` placeholders; Fleet must not interpret them as its own
values templates.

Require this bundle's desired/applied revision and ready workloads. Then use a
dedicated test namespace/PVC to prove authenticated create/read/delete,
permissions and persistence when its pod is recreated on another eligible
node. Test retained data deliberately without deleting unrelated PVs or NAS
paths. Clean up only the uniquely identified test data after acceptance.

No application migration, appdata cleanup, database deployment or production
media change is included. Wider Fleet/TLS and power/storage safety work remains
tracked separately in [the roadmap](../../ROADMAP.md).