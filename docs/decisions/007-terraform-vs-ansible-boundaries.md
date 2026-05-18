# Decision: Terraform vs Ansible Boundaries

## Status

Selected: Implemented during Phase 3

## Quick Summary

| Layer | Tool | Ownership |
|------|------|-----------|
| Infrastructure | Terraform / OpenTofu | VM lifecycle and infra primitives |
| Mutable hosts and appliances | Ansible | OS configuration, orchestration, and host prep |
| Kubernetes workloads | GitOps | In-cluster applications and service configuration |

## Context

With the introduction of Terraform (OpenTofu) for managing the Proxmox Virtual Machine lifecycle, the project now relies on two powerful automation tools: Terraform and Ansible. 

To prevent technical debt, overlapping responsibilities, and "split-brain" management scenarios, a strict boundary must be defined detailing exactly what each tool is responsible for managing.

## Decision

We establish the following strict boundary of responsibilities:

| Tool | Owns | Rule of thumb |
|------|------|---------------|
| Terraform / OpenTofu | Proxmox VMs, sizing, disk allocation, and other declarative infrastructure primitives | If it can be destroyed and recreated as infrastructure, Terraform owns it |
| Ansible | Host baseline, package and config changes, appliance orchestration, and secret placement workflows | If it requires running commands or mutating an existing system, Ansible owns it |
| GitOps | Kubernetes Deployments, Services, Helm releases, and workload configuration | If it lives inside the cluster, GitOps owns it |

## Boundaries

- Terraform should not SSH into nodes to perform mutable configuration.
- Ansible should not create or destroy VMs that are meant to be Terraform-managed.
- Neither Terraform nor Ansible should own long-lived Kubernetes workload state.

## Consequences

- Playbooks that create or destroy Terraform-owned VMs should be rejected in review.
- Terraform code that uses `local-exec` or `remote-exec` to mutate managed nodes should be rejected.
- The operating model stays clean: Terraform builds infrastructure, Ansible prepares mutable hosts, GitOps deploys cluster services and applications.
