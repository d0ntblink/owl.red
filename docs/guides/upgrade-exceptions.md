# Upgrade Exceptions And Recovery Playbook

Use this alongside [dependency updates](dependency-updates.md), not instead of
the owning service guide. These procedures capture unexpected work from the
2026-11-03 component-update batch. The Talos/Kubernetes section records planning
findings only: those platform upgrades were not executed during that batch.

Historical versions and outcomes below are evidence, not current-state checks,
standing approval, or a recommendation to reuse old process IDs and images.
Keep credentials, full machine configurations and recovery captures out of Git.

## Before Starting Or Resuming

1. Record the reviewed PR head, changed chart/image references, current workload
   UID/image, node placement and relevant application/storage health. Check the
   worktree and preserve edits made by other work; never reset to clear a batch.
2. Read breaking changes and the target's Kubernetes, CRD and runtime support
   requirements. Render with real values and the running Kubernetes version.
3. For consequential live changes, retain the affected-state preimage, verify an
   independent recovery path, review the exact diff and obtain scoped approval.
   An application-update approval does not authorize a NAS or node reboot.
4. Merge deliberately: Fleet deploys `main`, and even documentation publication
   can trigger normal Technitium reconciliation. Do not merge more workloads
   while a shared storage or rollout failure is unresolved.
5. After an uncertain command result, inspect actual state before deciding to
   retry. Write down what was issued, what changed and what remains unknown.

Do not delete BundleDeployments to force reconciliation: their finalizers can
uninstall workloads. Do not bypass drain, quorum, ownership or data-safety gates
to clear a queue.

## Home Assistant Stuck Terminating On SMB

**Observed:** An init-container image update triggered a rollout before the HA
application update. The old pod remained terminating. Its process leader was a
zombie with an empty file-descriptor directory, but another thread remained in
uninterruptible `D` state inside `cifs_write_begin` / `folio_wait_bit_common`.
The leader alone did not prove that the old writer had stopped.

### Diagnose

1. Identify the old pod UID, node, deletion timestamp and container ID. Inspect
   its events and runtime state through the existing Talos diagnostic access.
2. Inspect every thread, not just the process leader: thread state, wait channel
   and kernel stack. Record any outstanding SMB write and pending termination.
3. Treat the old instance as a possible writer until process/thread evidence
   proves otherwise. Preserve the single-replica, Recreate deployment and PVC.
   A timeout, zombie leader or empty leader FD listing is not that proof.

### Recover

1. Stop further workload merges. Do not force-delete the pod to allow a second
   writer, delete the PVC, clear application data or repeatedly send signals.
2. If considering server-side SMB recovery, map the exact client session and
   share, preserve other sessions and obtain separate approval. In this incident,
   one targeted `smbcontrol close-share` was attempted; it did **not** release
   the blocked thread. Do not copy its historical PID or escalate to restarting
   Samba/NAS without a new recovery review.
3. If the thread cannot be released, review a normal reboot of only the affected
   Talos guest. First verify control-plane quorum, healthy storage replicas,
   surviving direct API access and independent Proxmox access to that guest.
   Identify guest versus hypervisor explicitly. Obtain approval for this scope.
4. Issue the approved recovery once, then inspect boot identity, runtime state
   and the old pod UID before any retry. The native reboot command in this
   incident returned a StopContainer shutdown deadline error, **but the guest
   actually rebooted**. Kubelet subsequently removed the old pod naturally.
5. Wait for storage recovery before continuing. Eleven Longhorn volumes became
   temporarily degraded after this reboot; all twelve recovered through native
   rebuilds. Do not layer another upgrade onto rebuilding storage.

**Accept:** Old writer/process gone; one replacement HA instance Ready; trusted
HTTPS and existing configuration reads succeed; expected nodes Ready and all
affected volumes healthy. See [Home Assistant](home-assistant.md) and
[shared storage](shared-storage.md). A successful configuration read does not
replace a verified application-data backup.

## Traefik Values And CRDs Require Separate Work

**Observed:** Chart 42.3.0 rejected the old `logs.general.level` values. Fixing
rendering was not enough: existing CRDs also needed a separately approved schema
refresh, which a normal Helm chart update does not perform automatically.

1. Render the exact target chart with the actual values and Kubernetes version.
   Follow intermediate release notes, not just the destination patch notes.
   Pair the `log.level` migration with the chart pin in the same change.
2. Extract CRDs from that pinned chart and capture installed CRDs privately.
   Compare schemas after accounting for API-server defaults; distinguish actual
   schema changes from normalization and metadata differences.
3. Inventory in-use API groups. The observed refresh covered ten existing Proxy
   CRDs; Hub was excluded. The meaningful Proxy schema addition was Middleware
   `errors.errorRequestHeaders`. Do not reuse the count as a future allowlist.
4. Review the exact schema/ownership diff and obtain approval before applying
   prerequisites. Use native server-side apply with the reviewed field manager;
   stop on ownership conflicts rather than adding `--force-conflicts` blindly.
   This batch used `helm` without live conflict forcing. Keep Fleet as workload
   owner. Retain prior schemas, but do not assume schema downgrades are safe
   after custom resources start using new fields.
5. Let Fleet deploy the reviewed chart and values together. Confirm desired and
   applied deployment IDs match, exact images are running and three replicas
   are Ready. An old healthy release is not successful deployment of the new one.

**Accept:** Trusted routes work with certificate verification enabled. Both API
and redirect reject an unauthorized source with `403`, including forged
forwarded headers. Direct-pod tests prove middleware behavior, not VLAN firewall
isolation. Do not disable global TLS verification or widen the allowlist.
Follow the owning [Traefik guide](../../gitops/traefik/README.md).

## CI Runtime Updates Are Compatibility Updates

**Observed:** Python 3.15 was outside Ansible Core 2.16.3's supported controller
range. Changing setup-python alone could not qualify the renderer workflow.

1. Check the automation framework's supported Python range before raising the
   interpreter. Choose a supported pair, not independently newest versions.
2. Retain the existing qualified pair while testing the new pair in isolation.
   This batch retained Python 3.12 / Ansible Core 2.16.3 and added Python 3.15 /
   Ansible Core 2.22.0. The controller/editor environment was not replaced.
3. Run the existing renderer and unsafe-input checks, then require actual CI
   results for both pairs. Report skipped optional fixtures explicitly; do not
   count them as exercised. CI success does not certify every live playbook.
4. Check the actual Node executable too: the controller's system Node was 18,
   while modern tooling used an explicitly selected Node 24 binary. A workflow
   pin or installed binary does not establish which executable a local command
   used. Verify the executable/version required by that specific command.

## A Failing Baseline Test Is Not Permission To Change Policy

**Observed:** The Wi-Fi renderer test still expected a TCP/443-only restriction,
but the accepted source already permitted owner-trusted VLAN 20 access to the
management subnet. This failure also existed on the baseline, independently of
the dependency PR.

1. Compare the failure against the base branch and inspect the deciding source.
   Establish whether the implementation or test contradicts accepted policy.
2. Update only the stale expectation when source and accepted policy agree.
   Retain collision, unsafe-input, dual-stack and approval guards. This batch
   also checked cleanup of the obsolete protocol/port restrictions; no router
   configuration or live firewall change was made.
3. Run the focused check immediately. An embedded-Python indentation mistake
   was caught and corrected locally before relying on broader CI.
4. If the bot branch conflicts with newer `main`, merge current `main` into that
   branch, review the resulting diff and rerun checks. Do not force-push or
   discard accepted tests simply to restore a green status.

## Green Rendering Does Not Establish Platform Support

**Observed:** cert-manager 1.21.3 rendered on Kubernetes 1.31, but officially
supported only Kubernetes 1.33-1.36. The installed cert-manager 1.20.2 also had
pre-existing support debt on 1.31; holding the new PR did not resolve that debt.

1. Compare the live cluster version with the target's official support matrix.
   Keep unsupported updates held even when schema rendering and generic CI pass.
2. Record both the blocked destination and any existing unsupported combination.
   Do not substitute an end-of-life branch without assessing its support status.
3. Prepare the separate platform migration and recovery plan. Do not fold a
   cluster upgrade into an application-update approval.

See [dependency policy](dependency-updates.md#qualified-version-pairs).

## Health Signals That Needed Interpretation

### Bitwarden Timestamp Did Not Mean Failed Polling

**Observed:** `lastSuccessfulSyncTime` stayed old after operator 2.1.0 rolled out.
The exact upstream controller version showed that the timestamp advances on
changed-data completion, not every successful unchanged reconciliation.

1. Check the deployed operator version and controller implementation before
   treating the timestamp as a polling heartbeat.
2. Inspect the new controller's logs for each expected resource. Native
   `No changes to namespace/name. Skipping sync.` messages established unchanged
   reconciliation for all fourteen expected resources in this batch.
3. Confirm expected replicas, leader election and refresh configuration. Never
   dump Secret values or deliberately change a production secret just to advance
   the timestamp. If new data was expected, unchanged-result logs alone are not
   sufficient: diagnose that specific synchronization path.

### Fleet Cached Health Lagged Actual Longhorn State

1. Compare Fleet's reported object with the native workload and storage status.
   This batch had a cached manager availability of 3/4 while the actual DaemonSet
   was 4/4 and all twelve volumes were healthy.
2. Record the discrepancy and observation time. Do not restart healthy managers,
   delete BundleDeployments or claim all Fleet reports are green.
3. If the discrepancy persists, investigate Fleet reporting separately from the
   already verified storage recovery.

### Staging ACME Failed While Production Worked

1. Inspect the exact ClusterIssuer condition and failing endpoint. Test the
   staging and production directory endpoints separately with TLS verification.
2. Compare an in-cluster request with an independent controller request. Staging
   TLS handshake timeouts reproduced from both WSL and the HA pod; production
   directory requests returned HTTPS 200 from both, and the production issuer
   remained Ready.
3. Treat this as endpoint-specific evidence, not proof of a cluster-wide fault
   or proof of the remote service's root cause. Do not restart cert-manager,
   disable TLS verification or change firewall/DNS authority without new evidence.

**Accept:** Report production and staging separately. Existing valid certificates
and directory connectivity do not prove a future certificate renewal succeeds.

## Stateful Images, Repeated Pins And Deferred Jobs

1. Read application migrations even for a digest-only PR. The Reclaimerr update
   crossed release lines and introduced three database migrations. Its explicit
   disposable-data waiver applied only to Reclaimerr, not HA, Plex or NAS data.
   No Reclaimerr deletion/reset was needed. A Git revert cannot undo migrations.
2. Inspect repeated image references, init/helper images and explicit chart image
   overrides. HA had three application image references. Init-image changes can
   trigger the same disruptive rollout as an application-image change.
3. For storage-driver updates, verify controller and node rollouts, then an
   existing consumer's access. SMB CSI 1.20.4 acceptance included the HA pod UID
   remaining unchanged and its existing SMB configuration remaining readable.
4. A changed CronJob image applies to future jobs; it does not prove a new job
   ran successfully. Do not launch an unscheduled job merely to prove a pin.
5. Preserve intentionally disabled workloads. The retired Kubernetes Open WebUI
   stayed at zero replicas; the NAS combined service remained authoritative.

## Uncertain Terminal Results And Excess Checking

**Observed:** Shared persistent terminal sessions and interactive `gh` alternate
screen output made command outcomes hard to interpret. Queued input could be
swallowed. Repeated broad checks also delayed otherwise bounded updates.

1. Keep commands sharing a persistent terminal sequential. Capture noninteractive
   output for watchers instead of mixing interactive screens and subsequent input.
2. After an ambiguous merge, write, reboot or job creation, inspect the remote
   PR head/state, resource UID, boot ID or issuance receipt before retrying.
   A CLI error is not proof that no mutation happened.
3. Use native completion/failure watches for a specific operation. A broken
   observer is not a failed workload; inspect the workload before any recovery.
4. Establish the cheap discriminating check and acceptance criteria first. Reuse
   still-applicable evidence. Add a check only when its result changes whether to
   proceed, stop or recover; do not repeatedly audit unrelated infrastructure.
5. Close a superseded PR explicitly and distinguish closed from merged. Record
   remaining exceptions rather than describing the entire batch as fully green.

## Talos/Kubernetes Planning Traps, Not Executed Recovery

These findings came from reviewing the existing Talos 1.8.1 / Kubernetes 1.31.1
cluster. Requalify versions and release notes before execution.

- Talos OS upgrades do not upgrade Kubernetes. Use supported adjacent Talos
  minors and consecutive Kubernetes minors; the proposed destination must fit
  the Rancher, Talos, cert-manager and storage compatibility intersection.
  Kubernetes must reach at least 1.33 before Talos 1.14.
- Preserve the existing `/dev/sdb` Longhorn data mount and kubelet bind mounts.
  `.machine.disks` deprecation is not permission to repartition populated disks
  or paste a fresh-provisioning `UserVolumeConfig` example into production.
- Preserve the image-factory schematic's `iscsi-tools` and `util-linux-tools`.
  Qualify the actual extension contents for every image: Longhorn warns that
  open-iscsi 2.1.12 breaks attachment; use <=2.1.11 or >=2.1.13.
- Qualify each installer path and matching CLI. Talos 1.14 uses the factory
  `metal-installer` path; do not assume an older generic installer URL works.
  Talos 1.8 onward preserves data automatically; do not copy an unsupported
  `--preserve` flag from older instructions or use `--force` to skip health gates.
- Review interface-renaming and configuration migrations. Existing MAC-based
  selectors mitigate interface-name changes. Avoid a blanket configuration
  conversion that loses required kubelet extra mounts.
- Review native Kubernetes-upgrade dry-run output for removed APIs, generated
  bootstrap manifests and server-side field ownership/pruning before execution.
- Protect diagnostic output: the Talos 1.8 machineconfig resource's JSON `spec`
  is a YAML string. Parse it privately and project only required public facts;
  never dump the full secret-bearing configuration into a terminal or issue.
- Verify an external etcd recovery copy and application-data recovery, plus
  independent guest access. OS A/B rollback is not Kubernetes/etcd downgrade or
  application-data recovery. Review source pins without a broad Terraform apply
  that could recreate guests or reapply obsolete generated configuration.
- Budget for single-replica workload interruptions and storage rebuilds. Stop on
  drain/PDB, quorum, boot or volume failures; do not bypass them automatically.

The proposed platform path still required backup verification, exact installer
qualification, a reviewed first-stage diff and explicit live-change approval.
Planning completion did not satisfy those execution gates.