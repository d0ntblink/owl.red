# Decision 001: K3s + Fleet Proposal (Archived)

## Status

Superseded by [ADR 008](008-talos-vanilla-k8s.md). K3s was replaced by Talos Linux plus vanilla Kubernetes during Phase 3 implementation. Fleet remained the chosen GitOps reconciler.

## Quick Summary

| Area | Original proposal | Current outcome |
|------|-------------------|-----------------|
| Kubernetes distro | K3s | Talos Linux + vanilla Kubernetes |
| GitOps reconciler | Rancher Fleet | Rancher Fleet |
| Ownership model | Ansible for host bootstrap, GitOps for cluster objects | Same ownership model retained |

## Why It Existed

At the time, the project needed a lightweight Kubernetes distribution and a GitOps reconciler that could run on the available homelab hardware without adding excessive operational overhead.

## What Was Proposed

- Use K3s as the Kubernetes distribution.
- Use Rancher Fleet for GitOps reconciliation.
- Keep Ansible responsible for host bootstrap while Fleet owns in-cluster objects.

## Why It Was Superseded

| Reason | Effect |
|------|--------|
| Talos became the chosen operating model | K3s and Talos are not the same platform shape |
| The project wanted explicit control over bundled components | Vanilla Kubernetes fit better than K3s defaults |
| Fleet remained valid independently of K3s | GitOps choice stayed, distro choice changed |

## Historical Consequences

- The repository kept the GitOps-first direction.
- The Kubernetes distribution decision moved to ADR 008.
- This file remains only as an archive of the earlier direction.