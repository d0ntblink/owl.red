# Proposal: K3s + Rancher Fleet for GitOps

## Status

**Superseded by [ADR 008](008-talos-vanilla-k8s.md)** — K3s was replaced by Talos Linux + vanilla Kubernetes during Phase 3 implementation. Fleet (GitOps) remains the chosen reconciler.

## Context

This homelab needs a Kubernetes distribution and a GitOps reconciler that can run reliably on existing hardware (ThinkCentre M73 nodes and RSV-L4500U host) without adding enterprise-level operational overhead.

## Proposed Decision

Use K3s as the Kubernetes distribution and Rancher Fleet for GitOps reconciliation.

Rationale:
- K3s is operationally lighter than a full upstream stack while remaining Kubernetes-compatible.
- Fleet gives repo-driven reconciliation with simple grouping via GitRepo/Bundle primitives.
- Ansible can continue to own host bootstrap while Fleet owns cluster object reconciliation.

## Scope And Assumptions

- Scope: cluster lifecycle and Kubernetes manifest delivery.
- Out of scope: application-specific rollout policy and backup strategy.
- Assumes one source git repo is used for desired state.

## Risks And Mitigations

- Risk: GitOps drift debugging can be harder than imperative deploys.
	Mitigation: keep bundle boundaries small and map each bundle to one responsibility.
- Risk: Fleet adds a control-plane component to learn and maintain.
	Mitigation: start with one cluster and a minimal bundle layout.

## Review Gates Before Approval

- Confirm K3s install/upgrade path in Ansible (fresh install and rollback).
- Confirm Fleet repo structure (core services vs workloads) is documented.
- Confirm break-glass path exists for urgent manual rollback.

## Consequences If Approved

- Git becomes the single desired-state source for Kubernetes objects.
- Initial setup effort increases, but change tracking and rollback improve.
- Future node expansion remains straightforward with K3s.