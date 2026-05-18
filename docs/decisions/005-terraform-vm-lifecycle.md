# Decision: Terraform for Proxmox VM Lifecycle

## Status

Selected: Implemented during Phase 3

## Quick Summary

| Area | Decision |
|------|----------|
| VM lifecycle owner | Terraform / OpenTofu |
| Provider | `bpg/proxmox` |
| Role of Ansible | Post-provision host and appliance configuration only |
| Main reason | Declarative lifecycle state, drift tracking, and clean destruction |

## Context

The initial strategy used Ansible (`community.general.proxmox_kvm` or `qm` shell commands) to provision Kubernetes node Virtual Machines on the Proxmox cluster. While Ansible excels at OS-level configuration, it is an imperative configuration management tool. It struggles with infrastructure lifecycle state (e.g., if a VM is removed from the code, Ansible does not destroy the VM).

A core principle of this project is GitOps and reducing technical debt. A declarative state engine is required for infrastructure management.

## Options Compared

| Option | Pros | Cons |
|---|---|---|
| **Ansible (Status Quo)** | Single toolchain. Good for post-provisioning config. | Imperative. Poor drift detection. Difficult to manage clean destruction. |
| **Terraform (OpenTofu) + bpg/proxmox** | Purely declarative. Tracks state. Deletions in code equal destruction in infrastructure. Industry standard. | Introduces a second tool to the pipeline. Requires API tokens and state file management. |

## Decision

Adopt **Terraform (OpenTofu)** using the `bpg/proxmox` provider for all Proxmox Virtual Machine and infrastructure lifecycle management.

Ansible will be strictly reserved for configuring the host systems (Proxmox nodes, OPNsense, switches) and any non-immutable OS layers, adhering to a clean separation of concerns.

## Why This Is The Best Fit Now

- It provides a true GitOps infrastructure-as-code foundation.
- The `bpg/proxmox` provider is feature-rich, actively maintained, and handles SDN and clustering natively.
- It completely eliminates the technical debt of tracking "orphaned" VMs created imperatively.

## Consequences

- We must securely manage a `.tfstate` file.
- We must generate and rotate a Proxmox API token (`terraform@pam!automation`).
- Documentation must clearly delineate that Terraform builds the VMs, and Ansible/GitOps handles the software layer inside them.
