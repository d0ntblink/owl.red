# Dependency Updates With Renovate

Use the hosted [Renovate GitHub App](https://github.com/apps/renovate), restricted
to `d0ntblink/owl.red`. [renovate.json](../../renovate.json) is the repository's
policy. Installing the app and publishing this configuration are separate steps;
a local file alone does not activate the service.

## Activate The App

1. Sign in to GitHub as `d0ntblink` and open the Renovate app's installation page.
2. Select **Only select repositories**, then **owl.red**. Review the requested
   permissions before authorizing. The hosted app needs repository access for
   branches, pull requests and its Dependency Dashboard; it does not need cluster,
   NAS, Bitwarden or infrastructure credentials.
3. Publish the reviewed configuration to the default branch. If Renovate creates
   an onboarding PR, review it against this policy rather than accepting broader
   defaults. An existing recognized default-branch config may skip onboarding.
4. Confirm the Dependency Dashboard lists dependencies from actual Fleet bundles
   and Kubernetes manifests. Check extraction warnings before requesting updates.
5. Use [Mend's portal](https://developer.mend.io/) for hosted job status and logs.

No self-hosted bot, Actions PAT or new homelab container is required. Grant access
only to this repository; adding other repositories is a separate choice.

## Update Policy

- Normal update branches are created Monday 00:00-08:00 America/Edmonton. This is
  an allowed window, not a promise that the hosted service runs at a precise time.
  Existing branch updates also wait for the window unless manually requested.
- At most three normal update PRs are open, with one new PR per hour.
- Automerge and platform automerge are disabled for every update type.
- Major upgrades need a Dependency Dashboard checkbox before a PR is created.
- Critical platform/stateful paths also require dashboard approval, even for
  patches or digest updates. Approving PR creation is not approving its merge.
- Unrelated dependencies are not grouped. Renovate can update repeated references
  to the same detected dependency together; check every changed reference.
- Container images retain/add digest pins. Prefer explicit release tags plus
  digests; a digest-only reference does not communicate a release compatibility
  policy and may follow an implicit mutable tag. Review its proposed destination.
- Longhorn chart updates are restricted to `<1.13.0` for the current Kubernetes
  compatibility boundary. Do not remove the ceiling without qualifying a cluster
  upgrade and the storage upgrade path.

Renovate vulnerability-fix PRs are disabled in this initial configuration because
they normally bypass ordinary schedules and PR limits. This does not disable
GitHub Dependabot alerts. Triage security findings separately and request an
appropriate update manually; image-version updates are not SBOM/CVE scanning.

## Initial Coverage

| Source | Coverage |
|--------|----------|
| Fleet bundle `fleet.yaml` | Remote Helm chart versions through the native Fleet manager |
| Kubernetes YAML under `gitops` | Detectable container image references, including init containers |
| Conventional Helm values | Image repository/tag/digest mappings; Fleet files are included explicitly |
| Local Helm `Chart.yaml` | Declared chart dependencies, not arbitrary template expressions |
| GitHub Actions workflows | Referenced action versions and supported commit pins |

An image `tag` override without an explicit repository may not be discoverable.
For example, upgrading a chart does not necessarily update its separately pinned
image override. Inspect both before merging. Embedded scripts/config strings,
custom JSON app registries, Ansible variables, Terraform/Nix, NAS definitions and
other repositories are not claimed covered by this initial policy. Do not add
broad regular expressions that edit every version-looking string. Qualify native
managers or targeted structured extraction before expanding coverage.

## Review And Deploy

For each PR:

1. Read release notes, breaking changes and the complete diff. Verify the proposed
   chart's Kubernetes/CRD requirements against the running cluster, not just its
   SemVer major number. Check explicit image overrides and duplicated registry/
   helper pins outside Renovate's coverage.
2. Run affected configuration checks and render the changed chart/manifests with
   the real values and supported Kubernetes version. Existing CI checks secrets
   and selected infrastructure logic; it does not validate every Helm release or
   application migration. A green PR is not upgrade certification.
3. For stateful apps, review database migrations, current data recovery and whether
   an image/chart downgrade is supported. A Git revert cannot undo a database
   migration. Network, storage, ingress and GPU workloads need their own focused
   compatibility and post-change checks.
4. Merge deliberately. Fleet watches `main` and applies merged GitOps changes;
   there is no separate harmless staging merge. Every new commit can also trigger
   Technitium's normal reconciliation. Bot branches alone do not deploy.
5. Verify the affected Fleet bundle and workload, then the application's relevant
   functionality. Stop rather than repeatedly restarting failed workloads.

Do not grant the bot bypass rights or enable automerge to clear a backlog. Pause
an update by leaving it unapproved, or close an unwanted PR after reading
Renovate's explanation of what future updates that suppresses.

For stalled rollouts, prerequisite CRD work, runtime compatibility failures and
misleading health reports, use the [upgrade exceptions playbook](upgrade-exceptions.md).
It records the unexpected recovery work from the 2026-11-03 update batch and
the acceptance gates to reuse, not historical approvals to replay.

### Qualified Version Pairs

The offline renderer workflow retains Python 3.12 with Ansible Core 2.16.3
and adds Python 3.15 with Ansible Core 2.22.0. Both pairs pass the existing
rendering and unsafe-input checks. This does not upgrade the controller's local
virtual environment or certify every live playbook on the newer pair.

The current Kubernetes 1.31 cluster is outside cert-manager 1.21's supported
Kubernetes 1.33-1.36 range. Keep that update held until a separately reviewed
cluster upgrade establishes compatibility. Successful Helm rendering alone is
not sufficient, and an older compatible branch may already be end-of-life.

## Validate Configuration

Use Node.js 24 and npm/npx on the controller. From the repository root:

```sh
npx --yes --package renovate@44.209.0 renovate-config-validator --strict --no-global renovate.json
git diff --check
```

This downloads a pinned validation tool into npm's cache, not the repository.
The security workflow runs the same repository-scoped check on pushes and PRs.
It checks Renovate configuration, not upstream registry access or complete
dependency extraction. No infrastructure credentials are needed. Compare the
first hosted Dependency Dashboard with the coverage table before trusting it.

To stop hosted processing, suspend the app installation in GitHub or remove this
repository from its selected repositories. Setting `enabled: false` in Renovate
also stops processing but can close its PRs/issues and delete its bot branches;
review that cleanup behavior first. Neither approach rolls back merged software.