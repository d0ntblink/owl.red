# Decision: Talos Linux for Kubernetes GitOps

## Status

Selected: Implemented during Phase 3

## Quick Summary

| Area | Decision |
|------|----------|
| Kubernetes node OS | Talos Linux |
| Management model | API-driven, immutable, no SSH or shell |
| Reason | Stronger GitOps alignment and reduced node drift |
| Operational impact | Troubleshooting shifts to `talosctl` and Kubernetes APIs |

## Context

The initial strategy utilized Debian 12 Minimal for Kubernetes node VMs. While standard, Debian is a mutable OS. Over time, manual interventions (like using `apt install` or editing `/etc`) introduce configuration drift, breaking the pure GitOps "cattle-not-pets" philosophy.

The user explicitly requested an immutable OS, citing NixOS as an example, to ensure absolute reproducibility and to align with the core GitOps principles of the project.

## Options Compared

| Option | GitOps Approach | Pros | Cons |
|---|---|---|---|
| **NixOS** | Declarative System Config | Total control over every aspect of the OS. Reproducible from a single file. | Overkill for a dedicated Kubernetes node. Requires learning the Nix language. Full SSH access remains. |
| **openSUSE MicroOS** | Transactional Updates | Familiar Linux base. Atomic rollbacks via Btrfs. | Still relies on standard systemd/SSH. Doesn't fundamentally change the OS management paradigm. |
| **Talos Linux** | API-Driven Immutability | Purpose-built for Kubernetes. Zero SSH. Zero shell. 100% API managed. Node is entirely disposable. | Steep conceptual shift. No ability to "log in and fix it." |

## Decision

Adopt **Talos Linux** as the underlying operating system for all Kubernetes nodes.

## Why This Is The Best Fit Now

- It is the ultimate expression of GitOps for Kubernetes. The OS configuration is a single YAML file applied via an API.
- It maximizes security by removing SSH, bash, and package managers entirely.
- It pairs perfectly with Terraform. Terraform provisions the empty VM, boots the Talos ISO, and injects the declarative machine configuration.

## Consequences

- We can no longer SSH into the Kubernetes nodes.
- Troubleshooting must be done via `talosctl` logs or Kubernetes APIs.
- The `ansible_user: ubuntu` logic in the inventory is deprecated for `talos_k8s_hosts`; Ansible will not manage these nodes.
