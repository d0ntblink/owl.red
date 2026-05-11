# Decision: Terraform vs Ansible Boundaries

## Status

Selected: Implemented during Phase 3

## Context

With the introduction of Terraform (OpenTofu) for managing the Proxmox Virtual Machine lifecycle, the project now relies on two powerful automation tools: Terraform and Ansible. 

To prevent technical debt, overlapping responsibilities, and "split-brain" management scenarios, a strict boundary must be defined detailing exactly what each tool is responsible for managing.

## Proposed Decision

We establish the following strict boundary of responsibilities:

### Terraform (Infrastructure Layer)
Terraform is strictly responsible for **declarative hardware and virtualization state**.
- Proxmox VMs (creation, destruction, sizing, disk allocation).
- Proxmox Node configurations (e.g., SDN, clustering, if managed programmatically).
- Immutable OS bootstrapping (e.g., injecting the initial Talos Linux machine configuration or ISO).
- *Rule of Thumb:* If it is a virtual or physical hardware resource that can be destroyed and recreated, Terraform owns it.

### Ansible (Configuration Layer)
Ansible is strictly responsible for **imperative OS configuration and bare-metal orchestration**.
- Bare-metal host configuration (e.g., setting up the base Debian OS on the M73 Proxmox hosts, configuring APT, SMART monitoring).
- Network appliances (e.g., pushing config to OPNsense or SwOS if modules become available).
- Secret injection orchestration (e.g., pulling keys from Bitwarden to place on the host).
- *Rule of Thumb:* If it requires running a script, installing a package, tweaking a `/etc/` file on a mutable system, or executing a rolling reboot, Ansible owns it.

## Exclusions (GitOps)
Neither Terraform nor Ansible are responsible for managing Kubernetes workloads.
- Kubernetes state (Deployments, Services, Helm charts like Rancher) will be managed purely by a GitOps controller (e.g., Rancher Fleet or ArgoCD) living inside the cluster.

## Consequences If Approved

- Playbooks that create or destroy VMs must be rejected in code review.
- Terraform code that attempts to SSH into a node to run configuration commands (via `local-exec` or `remote-exec`) must be rejected.
- This creates a clean "Layer Cake" architecture: Terraform builds the hardware -> Ansible preps the mutable hosts -> GitOps deploys the applications.
