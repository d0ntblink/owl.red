# Controller Setup And Tool Requirements

This is the canonical prerequisite guide for the `owl.red` control workstation
and automation scripts. Install tools only for the lane being used; installing
or checking a tool does not authorize infrastructure changes. For ownership and
execution boundaries see [Changing owl.red](changing-owl-red.md), the
[roadmap](../../ROADMAP.md) and [security policy](../../SECURITY.md).

Use a Linux controller or Ubuntu under WSL. Run repository commands from the
repository root unless a command explicitly says otherwise. Put user-installed
executables on `PATH`; activating a Python environment or refreshing Linux group
membership in one terminal does not necessarily update the VS Code agent's
existing process environment.

## Core And Lane-Specific Tools

| Tool | Required for | Version or configuration rule |
|------|--------------|-------------------------------|
| Bash, GNU coreutils, findutils, grep, sed, awk | Shell entry points and local checks | Use Bash 4.4+ for controller scripts, not `sh`; sync uses arrays and `readarray -d`. Device scripts keep their own Android/Termux shebangs. Keep Linux and Windows executable paths distinct under WSL. |
| Git | Source checkout, locks, reviewed diffs and Technitium pull reconciliation | Working repository access; do not replace a dirty worktree or push as a setup test. |
| CA certificates, curl, tar, xz-utils, unzip | API access and verified tool/asset downloads | Verify official binary checksums/signatures; preserve certificate verification except the documented LAN appliance exceptions. |
| jq | Credential wrappers, API projections, DHCP data and offline tests | Required even when Python/Ansible is installed. Do not print whole credential/API responses. |
| Python 3, venv, pipx | Ansible/controller Python dependencies and isolated utilities | Use an explicit compatible interpreter/environment, not unreviewed system-wide pip installs. |
| OpenSSL, `getent` | Unraid Terraform wrapper and CA/hostname verification | Ubuntu packages `openssl` and `libc-bin`; the wrapper also needs a writable private CA-bundle location. |
| iconv, base64 | Kubernetes-to-Bitwarden secret export | Ubuntu `libc-bin` and coreutils; values must be valid UTF-8 and only approved human-managed secrets may be exported. |
| sshpass | Optional Ansible password-based OpenSSH transport | Needed when the selected Ansible connection uses SSH passwords; not a prerequisite for key-only SSH or API-only work. |
| Node.js | Optional audit helpers, standard dotenv parsing and Node-based distributions of tools | `util.parseEnv` needs Node 20.12+/21.7+; use a supported Node LTS that provides it. Standalone `bw`/`bws` binaries do not require a separate Node runtime just to run. |
| Ansible, ansible-playbook, ansible-galaxy | Mutable-host/appliance configuration | Install Ansible in pipx or a project virtual environment; install each lane's collections and controller-side Python libraries. |
| OpenSSH client | SSH-managed hosts, jumps and tablet access | Verify destination/host key and the owning lane's SSH credentials. Target hosts need an SSH server; the controller does not need a server merely to run Ansible. |
| Terraform | Guest/infrastructure and API-backed appliance configuration | Respect each root's `required_providers` and committed lockfile; do not run `init -upgrade` as routine setup. |
| Bitwarden Password Manager `bw` | Infrastructure vault items and bootstrap SSH key | `2026.4.1` has the reproduced session regression; `2026.7.0` passed actual vault reads. See [Bitwarden flow](bitwarden-secrets-flow.md#known-cli-session-regression). |
| Bitwarden Secrets Manager `bws` | Machine-account secret retrieval and Kubernetes secret generation | Separate executable/product/token from `bw`; `BW_SESSION` does not authenticate `bws`. |
| kubectl | Kubernetes inspection and secret/bootstrap workflows | Working, private kubeconfig and correct context; inspect before mutating. Match client/server compatibility. |
| Helm | Reviewing/rendering charts and release-owned Kubernetes configuration | Fleet owns declared releases. Installing Helm does not authorize an imperative release change. |
| talosctl | Immutable Talos node inspection/configuration | Use a client compatible with the actual live Talos version, not just the boot ISO/source pin. Keep generated credentials private. |
| Nix, nix-build, nix-instantiate | NixOS module/package evaluation and non-activating builds | A usable store/daemon and a reviewed Nixpkgs input are required, not just a binary. Tablet flakes also need `nix-command` and `flakes`. |
| ShellCheck | Shell lint and the Nix `writeShellApplication` build gate | `0.9.0` passed the local Technitium checks; run the check before packaging/deployment. |
| pre-commit, gitleaks | Repository commit/security checks | Use the repository hook versions/configuration. An unavailable scanner is an unrun gate, not a passing result. |
| Android platform tools (`adb`), GnuPG | Optional tablet management and APK verification | Use the tablet Nix development shell where available; device authorization and signing-key verification are separate requirements. |
| Proxmox `pct`, `pvesm`, `pvecm`, `ha-manager` | Proxmox-local administrative scripts | Run only on the intended Proxmox node with the required privilege, never assumed available on the workstation. |
| iproute2, iputils-ping, ethtool, systemd, whiptail | Selected Proxmox NIC, monitoring and post-install scripts | Target-host requirements, not a reason to run those scripts on the controller. Some legacy helpers additionally install `ipcalc`/`net-tools`. |

There is no single repository-wide version pin for every controller executable.
Version numbers above are verified observations or explicit constraints, not a
claim that arbitrary newer/older releases are compatible. Runtime versions,
Terraform provider locks, Nixpkgs inputs and chart versions are different layers.
Adding a dependency requires updating this guide and the owning automation or
dependency declaration, not relying on an undocumented local installation.

## Ubuntu And WSL Installation

Run package installation directly in an interactive local terminal when sudo
requires a password. Never put that password in chat, a command argument or a
script. The following installs controller packages, not remote infrastructure:

```bash
sudo apt-get update
sudo apt-get install -y \
  bash ca-certificates coreutils curl findutils gawk git grep jq \
  libc-bin openssh-client openssl pipx python3 python3-pip python3-venv sed \
  tar unzip xz-utils nix-bin shellcheck
pipx ensurepath
```

Install Terraform, `bw`, `bws`, kubectl, Helm and talosctl from their official
release/package channels for the required lane. Follow version/checksum and
local-user permission requirements; do not pipe an unreviewed installer into a
privileged shell. WSL and Windows installations are not interchangeable.

### Nix Daemon Access

Ubuntu's Nix package may restrict `/nix/var/nix/daemon-socket` to `nix-users`.
When that group owns the socket directory, add the operator to it locally:

```bash
sudo usermod -aG nix-users "$USER"
newgrp nix-users
```

Open a fresh login session afterward. An already-running VS Code server/agent
can retain its old supplementary groups even when another terminal runs
`newgrp`; reconnect/restart that controller session as needed. Check configured
membership separately from the current process's effective groups:

```bash
getent group nix-users
id -nG
namei -l /nix/var/nix/daemon-socket/socket
nix --version
nix-instantiate --parse nix/hosts/technitium/configuration.nix >/dev/null
```

If membership is already configured but a long-running agent still has its old
groups, a single local check can use that authorized group without sudo:

```bash
sg nix-users -c 'nix-build nix/hosts/technitium/check.nix -A sync --no-out-link'
```

This does not add group membership or change store/socket permissions. It only
selects an already-authorized group for that command. The current controller
verified this path after adding `n0rth` to `nix-users`.

Do not make the socket/store world-writable or run project builds as root to
bypass this requirement. If the daemon is absent or stopped, inspect the local
Nix installation/service before building. A parsed module is only a syntax
check; package evaluation/build needs the intended Nixpkgs source and successful
substitution/build access. `system.stateVersion` does not pin that source.
Nixpkgs is a source/package collection, not an Ubuntu package named `nixpkgs`.
The project check fetches its pinned official archive; no `apt install nixpkgs`
or global channel update is required for that validation.

### Ansible And Local Python Tools

Choose one environment and use it consistently. For example:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install ansible pre-commit
export ANSIBLE_CONFIG="$PWD/ansible/ansible.cfg"
ansible --version
ansible-galaxy collection list
```

Alternatively use `pipx install --include-deps ansible` and install controller
libraries in that same pipx environment. A package installed in another venv is
not available to Ansible's delegated controller tasks. Set `ANSIBLE_CONFIG`
explicitly, especially on a Windows/WSL mount Ansible considers world-writable.
The existing [controller bootstrap](../../scripts/owl-controller-bootstrap.sh)
only installs Ansible when absent, retrieves the SSH key and prints environment
notes; it is not a complete toolchain installer or a deployment prerequisite for
every lane.

### Collections And Python Libraries

The current playbooks reference `ansible.builtin` and
`ansible.posix.authorized_key`. The latter needs its collection installed in the
selected Ansible environment:

```bash
ansible-galaxy collection install ansible.posix
```

Switch automation uses the repository's local modules, not a generic
RouterOS/NETCONF collection. The requirements are:

| Consumer | Python dependency | Execution constraint |
|----------|-------------------|----------------------|
| All Ansible modules | Ansible's `ansible.module_utils` | Available through the installed Ansible environment; normal remote modules also need target Python unless they use `raw`. |
| Local SwOS modules | `mikrotik-swos==1.3.2` is the tested library; module documentation also specifies `requests>=2.25.0` | Install into the interpreter that executes the local module, with CSS326 workarounds supplied by the repository's modules. |
| Local YAML validation | PyYAML (`yaml`) | Install in the selected controller venv if running the documented YAML parser checks. Pre-commit also manages its own hook environments. |
| Unraid drift/recapture | SSH; Python 3 for Ansible `fetch` recapture | Core `raw` reads do not need NAS Python. Do not install packages or change NAS services merely to perform a network survey. |
| Technitium Ansible configuration | Target Python 3; Nix commands on the NixOS LXC | The Nix module provides Python for Ansible. Its install role runs `nixos-rebuild switch`, so it is not a build-only check. Channel updates require explicit `technitium_update_nix_channels=true`; the default is false. |

For the venv path, install optional controller libraries only when needed:

```bash
.venv/bin/python -m pip install 'mikrotik-swos==1.3.2' 'requests>=2.25.0' PyYAML
.venv/bin/python -c 'import swos, requests, yaml; print("Controller libraries import successfully")'
```

The [switch inventory](../../ansible/inventory/group_vars/switches.yml) currently
uses local connections with `/usr/bin/python3`, while
[Ansible configuration](../../ansible/ansible.cfg) also has a target interpreter
default. Installing into `.venv` alone does not override those settings. Match
the local switch interpreter to the selected environment through the owning
inventory or a narrowly scoped override; do not apply a controller venv path to
remote hosts. Inspect `ansible --version` and `ansible-galaxy collection list`
before execution. The bootstrap script does not install these switch libraries
or the complete collection set.

## IaC Dependency Sources

| Lane | Declared dependency | Source of truth |
|------|---------------------|-----------------|
| Proxmox guest roots | `bpg/proxmox` `0.66.1` | Each root's Terraform declarations; committed locks where present. Existing scaffold guests still need state/import review. |
| Talos in the cluster root | `siderolabs/talos` `0.6.1` | [Cluster root](../../terraform/proxmox/technitium/main.tf) and its lockfile. The source/ISO Talos `1.7.5` pin is not the audited live `1.8.1` version or a talosctl requirement. |
| OPNsense configuration | `browningluke/opnsense`, constraint `~> 0.11`, locked `0.24.0` | [OPNsense root](../../terraform/opnsense/main.tf) and its lockfile. Check the installed router API/engine before assuming resource coverage. |
| Unraid settings API | `sullivtr/graphql` `2.6.1` | [Unraid root](../../terraform/unraid/main.tf), lockfile and the installed GraphQL schema. Destructive/operational mutations are outside this lane. |
| Technitium OS/sync | NixOS module, `writeShellApplication`, Git/curl/jq runtime inputs | [Nix configuration](../../nix/hosts/technitium/configuration.nix); [local checks](../../nix/hosts/technitium/check.nix) pin an official NixOS 25.11 archive and unpacked SHA256 for validation. This does not update/pin the running host's channel; `stateVersion = "25.11"` is not a channel lock. |
| Tablet controller tools | Nixpkgs `nixos-26.05`; `android-tools`, Bash, coreutils, curl, GnuPG, OpenSSH, jq | [Tablet flake](../../nix/android-tablet/flake.nix). Use `nix --extra-experimental-features 'nix-command flakes' develop ./nix/android-tablet`; review locking/fetches before accepting input changes. |
| Kubernetes resources | Fleet GitRepo paths, each bundle's manifests and Helm chart/values | [Fleet sources](../../gitops/rancher/fleet/README.md). Check per-bundle versions; do not substitute a workstation Helm upgrade for GitOps reconciliation. |
| Repository validation | Hook revisions, gitleaks configuration, workflow actions | [Pre-commit hooks](../../.pre-commit-config.yaml), [security workflow](../../.github/workflows/security.yml) and [gitleaks rules](../../.gitleaks.toml). |

No Go/compiler requirement is declared by the current tracked Terraform roots.
Historical custom-provider build paths and controller `dev_overrides` are not a
portable project dependency declaration. Review/remove stale local overrides
through their owning configuration, not by installing arbitrary provider builds.
No centralized Python/collection lock is currently declared; this guide records
the observed requirements without claiming those environments are reproducibly
locked. Add reviewed dependency manifests when that lane is standardized.

## Script Requirements And Execution Boundaries

All rows also inherit the base shell/file utilities above. The matrix covers
the tracked shell/Python entry points and the new offline sync test. It is a
requirements inventory, not a recommendation to execute every script. Wrappers
pass through the requested operation, so `apply` or an installation playbook
remains mutating even when credential lookup itself is read-only.

### Controller Wrappers And Checks

| Entry point | Requirements and inputs | Side effects / limits |
|-------------|-------------------------|-----------------------|
| [scripts/owl-controller-bootstrap.sh](../../scripts/owl-controller-bootstrap.sh) | Ansible already on `PATH` or pipx; `bw`/jq and a working session when the SSH key is absent; optional `BW_SSH_KEY_ITEM` | Installs local Ansible and retrieves a private key to `~/.ssh`; not a complete toolchain installer and not an infrastructure smoke-test prerequisite. |
| [scripts/ansible-run.sh](../../scripts/ansible-run.sh) | Bash/jq plus the command being wrapped; `PROXMOX_PASSWORD_SOURCE=auto|bws|bw`; supplied password or selected `bws` secret ID/token or `bw` item/session; optional `BW_PASSWORD` unlock input | Resolves/injects Proxmox credentials, then executes the command. Ansible SSH-password mode may need sshpass; no permission to run every playbook follows from a successful lookup. |
| [scripts/terraform-run.sh](../../scripts/terraform-run.sh) | Terraform/jq; supplied `PROXMOX_VE_PASSWORD` or `PROXMOX_ROOT_PASSWORD`, otherwise `bws`, `BWS_ACCESS_TOKEN` and `PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID`; reachable Proxmox API | Uses the selected password-authenticated Proxmox lane, not a universal BW fallback. Review each root/state/plan; runtime root API privilege is not workstation sudo. |
| [scripts/opnsense-terraform-run.sh](../../scripts/opnsense-terraform-run.sh) | Terraform; supplied `TF_VAR_opnsense_api_key` and `_secret`, otherwise working `bw`/jq, `BW_SESSION` and dedicated item notes; `OPNSENSE_KEY_BW_ITEM` can override the item | Executes the OPNsense configuration root. Mutations need review and change-scoped recovery; no router change is needed to install controller tools. |
| [scripts/unraid-terraform-run.sh](../../scripts/unraid-terraform-run.sh) | Terraform, OpenSSL, getent, CA certificates; supplied `TF_VAR_unraid_api_key` or working `bw`/`BW_SESSION`; optional `UNRAID_KEY_BW_ITEM`; correct `nas.owl.red` resolution | May create a local CA bundle and contacts NAS TLS before Terraform. Validate the expected appliance certificate/trust independently; do not blindly change client DNS or disable TLS globally. |
| [scripts/bitwarden-k8s-secrets-sync.sh](../../scripts/bitwarden-k8s-secrets-sync.sh) | kubectl, jq, `bws`, base64, iconv; authorized kubeconfig; `BWS_ACCESS_TOKEN`, `BW_PROJECT_ID`, `BW_ORGANIZATION_ID`; reviewed namespace/type exclusions | Reads Kubernetes secrets, creates/updates Secrets Manager values and replaces generated output. It is a credential migration, not a harmless setup check; controller-owned secrets must stay excluded. |
| [scripts/check-bitwarden-placeholders.sh](../../scripts/check-bitwarden-placeholders.sh) | Bash, find, grep, sed, tr; repository manifests | Offline, read-only UUID/placeholder guard; cannot prove a referenced secret exists in BWS. |
| [nix/hosts/technitium/sync.test.sh](../../nix/hosts/technitium/sync.test.sh) | Bash 4.4+, jq, Git and GNU file utilities | Offline fake-Git/API test; temporary directories only, no infrastructure credentials or real API calls. |

### Ansible Wrappers And Local SwOS Modules

| Entry point | Requirements and inputs | Side effects / limits |
|-------------|-------------------------|-----------------------|
| [ansible/scripts/swos-gather-facts.sh](../../ansible/scripts/swos-gather-facts.sh) | Ansible/config/inventory, local SwOS Python environment, reachable CSS326 HTTP API and `SWOS_PASSWORD` | Authenticated facts collection; controller libraries run locally, not on the switch. Check the selected inventory/current working directory. |
| [ansible/scripts/deploy-iptag.sh](../../ansible/scripts/deploy-iptag.sh) | Ansible plus target SSH/Python, root privilege and Proxmox tools; reviewed `--hosts` scope | Deploys a target systemd service and VM/container tag management; not a controller-only check. |
| [ansible/scripts/deploy-monitor-all.sh](../../ansible/scripts/deploy-monitor-all.sh) | Ansible plus target SSH/Python/root, Proxmox `qm`, systemd and functioning guest agents for opted-in VMs | Deploys the managed QEMU-only watchdog on one intended host; duplicate controllers or unintended tags can cause restarts. |
| [ansible/scripts/fix-e1000e-eee.sh](../../ansible/scripts/fix-e1000e-eee.sh) | Ansible plus target SSH/Python/root, ethtool/systemd and verified NIC identity | Applies runtime/boot NIC settings; can affect the management link. |
| [ansible/scripts/fix-grub-kernel-params.sh](../../ansible/scripts/fix-grub-kernel-params.sh) | Ansible plus target SSH/Python/root, GRUB/update-grub and reviewed hardware/kernel parameters | Changes target boot configuration; not a tool-installation validation command. |
| [ansible/library/swos.py](../../ansible/library/swos.py), [ansible/library/swos_info.py](../../ansible/library/swos_info.py), [ansible/library/swos_set_port_names.py](../../ansible/library/swos_set_port_names.py) | Ansible module utilities, tested `mikrotik-swos` `1.3.2`, `requests>=2.25.0`; local execution interpreter and switch credentials | Info module reads; setter/config modes write. Repository CSS326 compatibility code is required; another package installation does not replace these modules. |

### Proxmox-Local And LXC Scripts

| Entry point | Requirements and inputs | Side effects / limits |
|-------------|-------------------------|-----------------------|
| [scripts/pdm-lxc-ha-bootstrap.sh](../../scripts/pdm-lxc-ha-bootstrap.sh) | Intended Proxmox host/root; `pct`, `pvesm`, `pvecm`, `ha-manager`, jq; quorate cluster; `PDM_CT_OSTEMPLATE`; reviewed storage/network/HA variables; container package/key download access including wget | Creates/starts/configures a container and HA resources; default shared-storage gate must be satisfied for that design. Existing guests belong in reviewed Terraform state, not an unplanned bootstrap rerun. |
| [ansible/scripts/add-iptag.sh](../../ansible/scripts/add-iptag.sh) | Proxmox/root, Bash, curl, apt, systemd, `qm`/`pct`; legacy helper installs `ipcalc`/`net-tools` | Interactive legacy installer; fetches external helper code and changes services/tags. Prefer the owning Ansible role. |
| [ansible/scripts/monitor-all.sh](../../ansible/scripts/monitor-all.sh) | Proxmox/root, Bash/curl/systemd, `qm`/`pct`, ping and guest-agent support; interactive input | Legacy installer can configure both VM and container restarts. Do not confuse it with the managed QEMU-only watchdog or run it as a health check. |
| [ansible/scripts/nic-offloading-fix.sh](../../ansible/scripts/nic-offloading-fix.sh) | Proxmox/root, ethtool, network-interface utilities, curl/apt and systemd | Legacy target NIC/service changes; may install packages and interrupt connectivity. Prefer reviewed Ansible configuration. |
| [ansible/scripts/post-pve-install.sh](../../ansible/scripts/post-pve-install.sh) | Proxmox/root, interactive whiptail terminal, apt/curl, systemd and trusted package sources | Legacy host bootstrap can change repositories, HA/Corosync, packages and reboot. Never run on the controller or as a generic prerequisite check. |
| [ansible/files/iptag-main.sh](../../ansible/files/iptag-main.sh) | Deployed Proxmox host/root; Bash, `qm`/`pct`, timeout, ping and GNU utilities; guest-agent/container address access where used | Runtime service writes guest/container tags. Install/configure via its Ansible owner. |
| [ansible/files/ping-instances.sh](../../ansible/files/ping-instances.sh) | Deployed Proxmox host/root; Bash/`qm`/GNU utilities and QEMU guest-agent ping for explicitly tagged VMs | Managed watchdog can stop/start opted-in VMs; one controller, no LXC monitoring, no implicit router/NAS opt-in. |
| [nix/hosts/technitium/sync.sh](../../nix/hosts/technitium/sync.sh) | NixOS LXC with Bash/Git/curl/jq/coreutils; repository fetch access; private API token with required settings/zones/DHCP View+Modify permissions; existing declared scopes and explicit host activation policy | Writes Technitium configuration and serving state. Nix embeds the script; no manual copy/run is a substitute for approved IaC rollout and no-offer verification. |

### Optional Tablet Scripts

See the [tablet guide](../../nix/android-tablet/README.md) for device-specific
firmware, root, Termux and package-signature assumptions. Do not apply a tablet
script to a different serial or assume its recorded address is current.

| Entry point | Requirements and inputs | Side effects / limits |
|-------------|-------------------------|-----------------------|
| [scripts/android-tablet-apps.sh](../../scripts/android-tablet-apps.sh) | Controller Bash/jq/curl/GnuPG/sha256sum; manifest/signing-key access; `adb` and authorized exact device in install mode; `wslpath` when using Windows `adb.exe` | Download mode verifies/cache-writes APKs without a device; install mode changes apps and selected default roles/input method. |
| [scripts/android-tablet-inventory.sh](../../scripts/android-tablet-inventory.sh) | Controller Bash/jq/OpenSSH/GNU utilities; verified host key, private key and manifest; target SSH plus root `su`, `getprop` and package manager | Reads device state and writes the local inventory JSON; does not require ADB. |
| [scripts/android-tablet-ssh.sh](../../scripts/android-tablet-ssh.sh) | Controller adb/jq/ssh-keygen, public key and manifest; authorized/rooted exact device with Termux and Termux:Boot; optional `wslpath` for Windows adb | Stages SSH configuration, invokes the Termux setup and changes device boot/battery settings. |
| [scripts/android-tablet-wifi-adb.sh](../../scripts/android-tablet-wifi-adb.sh) | Controller adb/jq and manifest; verified serial, root/Magisk service directory; optional `wslpath` | Installs a device boot script and changes the ADB service path. |
| [scripts/android-tablet-debloat.sh](../../scripts/android-tablet-debloat.sh) | Android system shell/root, `pm`, mount and selected installed replacement packages; approved package/removal plan | Device-side package/filesystem mutation, not a workstation Bash bootstrap. |
| [nix/android-tablet/setup-termux-ssh](../../nix/android-tablet/setup-termux-ssh) | Termux Bash/app UID, staged public-key/config files, working Termux apt repositories; installs Termux OpenSSH | Runs as the Termux user, not root; creates keys/config/boot files. |
| [nix/android-tablet/start-sshd](../../nix/android-tablet/start-sshd) | Normal Termux app environment, installed sshd, private host keys and validated configuration; procfs/readlink | Starts the app-sandbox SSH daemon after a configuration check; not a controller command. |
| [nix/android-tablet/start-wifi-adb.sh](../../nix/android-tablet/start-wifi-adb.sh) | Android system shell/root, getprop/setprop and adbd/Magisk boot environment | Changes persistent/service ADB TCP properties and can restart adbd. |

## Credentials, TLS And Connectivity
## Credentials, TLS And Connectivity

- `bw` needs a logged-in CLI profile plus an actually usable `BW_SESSION` for
  vault reads. Validate a known item without emitting its credential values;
  successful unlock output or token shape alone is insufficient.
- Repository scripts invoke `bw` from their own `PATH`; a working interactive
  `owl_bw` helper does not redirect those calls. Verify the selected binary
  version and profile for wrappers, not just for the audit helper. Keep a tested
  replacement and original profile separate before any CLI version migration.
- `bws` needs its own least-privilege `BWS_ACCESS_TOKEN` and referenced secret
  IDs. Terraform/Ansible wrappers inject resolved credentials at execution time.
- The ignored local credential file must be owner-only (`chmod 600 env.secret`).
  A file containing dotenv assignments is not automatically valid Bash; parse it
  with an appropriate standard parser rather than blindly sourcing malformed
  entries. Node's built-in `util.parseEnv`, used during the audit, requires a
  sufficiently recent Node release; the controller's Node 18 did not provide it.
- The general Ansible wrapper recognizes optional `BW_PASSWORD`; `BW_SECRET`
  was the audit's local password variable, not a universal supported alias.
  Master-password environment injection is for controlled local unlock only;
  never commit, print or place master passwords in command arguments.
- Behind an enterprise/Zscaler TLS proxy, Node-based `bw`/`bws` may need
  `NODE_EXTRA_CA_CERTS` pointing to the trusted local CA. Fix trust, not global
  TLS verification. Appliance self-signed exceptions remain lane-specific.
- SSH, Proxmox/OPNsense/Unraid APIs and Kubernetes/Talos endpoints must be
  reachable from the actual controller. WSL NAT can require a verified SSH jump;
  it cannot prove DHCP broadcast behavior or VLAN isolation by itself.
- State files, kubeconfigs, Talos configs, API tokens and SSH private keys remain
  private local artifacts. Having tools and credentials does not authorize
  imports, applies, restarts, firmware changes or a DNS/DHCP handoff.

## DHCP Packet Acceptance Requirements

This is a bounded live-traffic check, not an offline test or a DHCP handoff.
Use the existing discovery implementation rather than constructing DHCP by
hand, and verify its installed behavior before sending traffic.

The reusable controller is
[scripts/capture-dhcp-authority.mjs](../../scripts/capture-dhcp-authority.mjs).
Its [offline tests](../../scripts/capture-dhcp-authority.test.mjs) run with
`node --test scripts/capture-dhcp-authority.test.mjs`, also in the existing
credential-free DHCP CI job. `--help` lists all required arguments; the live
helper refuses an existing output directory and never accepts incomplete PCAP
headers as evidence. An evidence-ready result still requires packet review.

- Controller: strict-host-key SSH with the existing deployment key; Node.js 24
  (matching the CI pin),
  built-in process/file APIs for capture orchestration and Python 3's standard
  XML parser for Nmap's structured results. No additional package is required.
- Probe: a physical LAN-connected Linux host with root access, Nmap and its
  `broadcast-dhcp-discover` NSE script/library, plus tcpdump. Nmap `7.95` is
  available on `cp1`. Reuse one synthetic locally administered client MAC;
  send DISCOVER only, never REQUEST, RELEASE or a lease-changing client command.
- Observer: root on `edge.pve`, host tcpdump, util-linux `nsenter`, and LXC
  `lxc-info` to resolve the running container PID. Enter only the LXC network
  namespace to observe its existing `eth0`; do not install capture tools in
  NixOS, attach NICs, or change interface configuration. Use tcpdump `-p`
  (non-promiscuous) and restrict captures to DHCP UDP ports 67/68.
- Evidence: retain packet captures outside Git in an owner-only directory
  (`0700`, files `0600`). Match the probe identity/transaction at the observer
  and require an OPNsense offer as a positive control. Missing probe visibility
  or no offer from any server is inconclusive, not a no-offer pass.
- Scope: only the tested current untagged LAN is covered. Unattached VLANs,
  client renewal/handoff, and DNS-daemon/LXC restart behavior remain separate
  checks; this procedure does not authorize those changes.

## Read-Only Subnet Inventory

The mask/recovery survey uses existing tools, not an installer or a configuration
writer. Keep structured evidence outside Git with directory mode `0700` and
file mode `0600`; never retain vault credentials, full machine configs, container
environments, API tokens or SNMP communities in that evidence.

- Controller: Node.js 24 built-in JSON/process/HTTPS APIs, Python 3 standard
  JSON/socket/HTML parsers and the existing strict-host-key deployment SSH key.
  Parse the ignored credential file with `util.parseEnv`, not shell `source`.
- Linux/PVE/NAS targets: read-only `ip -j` / `bridge -j` from iproute2, selected
  `pvesh get` networking/guest fields and, where needed, `pct exec` read commands.
  Query NAS interface/Docker-network metadata only; do not read container secret
  environments or invoke install, restart, power, disk or array operations.
- Windows under WSL: existing Windows PowerShell with `Get-NetIPConfiguration`
  and `Find-NetRoute`, invoked non-interactively. Record adapter status as well
  as address/MAC/prefix: a disconnected Wi-Fi adapter can retain old values.
  WSL's NAT interface is not the operator's physical DHCP/VLAN identity.
- Talos/Kubernetes: selected existing contexts, `talosctl get` address/route/
  resolver resources and scoped Kubernetes node/service/MetalLB pool fields.
  Talos JSON output can contain successive JSON objects; use a JSON decoder,
  not a single-object assumption or text extraction. Never dump raw credential
  configs or Kubernetes Secrets to establish network masks.
- Router: existing dedicated API item and the verified working private Bitwarden
  CLI/profile. Use documented GET actions and verify returned row counts against
  reported totals for leases/reservations/ranges. A per-appliance self-signed
  exception is not permission for a global TLS bypass or legacy TLS downgrade.
- SwOS: existing `mikrotik-swos==1.3.2`, requests and the repository platform
  override, with bounded GET-only reads. For an ad hoc reader, import
  [swos_info.py](../../ansible/library/swos_info.py) by file location; adding the
  whole library directory to `sys.path` can shadow the installed `swos` package
  with its sibling module. Avoid the unfiltered facts-playbook output when
  collecting private evidence: it prints the SNMP community.

Storage-management port (BMC) and managed power strip (PDU) network settings
must be read, not inferred from a lease or a responsive web port. A console
socket or a linked switch-port label is likewise not a verified recovery
session. Keep each missing check attached to the component/path it gates.

## Worker Management-Prefix Pilot

The [PVE prefix playbook](../../ansible/playbooks/proxmox-prefix-pilot.yml)
covers the completed compute/edge/storage rollout with reviewed single-NIC and
bond topologies, one host per invocation. It contracts only management `/16` to `/24`, retaining
address, gateway, resolver, the allowlisted bridge port and native VLAN behavior.
Every new activation requires its own host-specific approval. NAS and router guest interfaces, Talos guest prefixes, API VIP
`/32` and operator port 22 are not changed. A reload can briefly affect selected
host/guest networking; this is not a zero-interruption guarantee.

| Inventory Host | Management Address | Guest / Direct API Check | Additional Check |
|----------------|--------------------|--------------------------|------------------|
| `edge_pve` | `10.0.10.3/24` | Protected OPNsense VM 100 / Technitium LXC 200 | Router/Technitium ports, DNS and process identities |
| `storage_pve` | `10.0.10.4/24` | Protected NAS VM 101 | Bond runtime, unchanged NAS `.5/16` identity, HTTPS/SMB TCP and Technitium DNS |
| `cp1_pve` | `10.0.10.11/24` | `cp1-talos` / `.21:6443/readyz` | PDM `.31:8443` TCP |
| `cp2_pve` | `10.0.10.12/24` | `cp2-talos` / `.22:6443/readyz` | None |
| `cp3_pve` | `10.0.10.13/24` | `cp3-talos` / `.23:6443/readyz` | None |
| `worker1_pve` | `10.0.10.14/24` | `worker1-talos` Ready | Completed worker pilot |

- Controller: the tested Ansible core `2.16.3`, Node.js `24`, Python 3/PyYAML,
  selected `kubectl` context and existing strict-host-key root SSH access to
  the selected PVE host. Storage also needs the existing `nas_unraid` root SSH
  access, working Ansible Python and iproute2 JSON support on NAS; its checks only
  read `eth0`, never guest settings, disks, array or service/container state.
  Direct control-plane API readiness uses that same
  kubeconfig/client trust, not a new TLS bypass; PDM uses built-in `wait_for`
  TCP checks. Edge's explicit DNS queries use Node's built-in promise Resolver,
  not a third-party parser or OS resolver change. No new collection, npm package
  or infrastructure secret is needed.
- Target: the verified Proxmox `9.2.3` API/CLI, iproute2, ifupdown2 `ifquery` /
  `ifreload`, systemd `systemd-run` / `systemctl`, util-linux `flock`, Bash and
  GNU coreutils (`sha256sum`, `install`, `rm`, `touch`). No package installation,
  reboot or guest power operation is part of the pilot.
- Preflight: no pending file, active extra included interface definitions or SDN zones;
  only the exact zero-byte regular PVE-generated `interfaces.d/sdn` include
  is accepted in addition to an empty include directory. Other includes refuse.
  Source ownership/mode and current runtime/configured prefix agree. Six PVE
  members must be online/quorate, the gateway reachable and selected guest Ready.
- Activation: opt-in defaults false. Both host/controller private recovery
  directories must be new. Compute/edge stage the existing bridge CIDR through
  PVE. Storage instead rechecks the source against its recovery preimage and
  creates `/etc/network/interfaces.new` from those exact bytes with only the CIDR
  replaced; an existing pending file is never overwritten. PVE's storage API
  serializer was observed to add unapproved `auto` flags to both bond members,
  so that path is not used for storage staging. All hosts still activate through
  the PVE network endpoint with the same local rollback and postchecks. The
  staged non-comment directive content and complete parsed models must match
  except that CIDR. PVE's generated header, blank lines and stanza ordering are
  allowed; directive counts/content and parsed per-interface settings are not
  relaxed. `ifquery`
  explicitly includes the target's full reviewed interface list because default
  listing omits manual interfaces. Storage uses `lo obnic0 obnic1 bond0 vmbr0`,
  with `bond0` active-backup, slaves `obnic0 obnic1`, primary/active `obnic0` and
  miimon `100`. These runtime parameters and the NAS MAC/IPv4 prefix must remain
  unchanged, alongside the whole NAS VM configuration and QEMU PID. No bond
  member failover/reconfiguration or NAS action is attempted to repair a refusal.
  Compute uses `lo nic0 vmbr0`; edge uses
  `lo onboard vmbr0 nic0 nic1 nic2 nic3`, with bridge port `onboard`.
  No timer/reload starts before these checks pass.
  `serial: 1`, fatal-on-error behavior and an exact one-host invocation check
  prevent accidentally starting a multi-host rollout. Use one `--limit` and
  confirm its outcome before launching the next host.
- Recovery: the tested host-local 180-second timer is armed before PVE reload.
  It validates the preimage and accepts only original/staged source hashes;
  another operator's active/pending edits are not overwritten. On success,
  SSH, PVE task `OK`, runtime/configured `/24`, gateway, cluster quorum and guest
  readiness, selected control-plane API and any attached service check must
  pass before lock-protected confirmation cancels the timer.
  A blocked or failed rollback still needs operator inspection; do not blindly
  retry or claim the timer is infallible.

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml ansible/playbooks/proxmox-prefix-pilot.yml \
  --limit cp1_pve --check
node --test scripts/proxmox-prefix-pilot.test.mjs
```

Connected previews pass with zero changes for `cp1`, `cp2` and `cp3`; no new
compute prefix has been changed by those previews. All twelve offline cases execute
the actual embedded recovery programs or selected Ansible assertions against
temporary data/fake reloads. They test corruption/drift refusal, reload failure,
rollback/confirmation races and PVE-header acceptance without permitting another
directive/model change, plus the exact empty-include exception; they never call
the PVE API or modify real interfaces.
The existing credential-free network CI job runs them.

The added scope cases evaluate every host/IP/guest/API mapping and refuse
storage, a wrong management IP, another guest's API address or multiple
hosts. Node-scoped PVE commands must use the selected node, not a stale worker
path. Extending this allowlist prepares the next batch; it does not approve its
live activation.

The owner subsequently approved that batch after confirming why a `/16` PC and
these same-L2 `/24` hosts can still reach one another. `cp1`, `cp2`, `cp3` were
changed and confirmed independently on 2026-10-16 UTC, each completing before
the next invocation. At 01:43:58Z every selected host is runtime/persisted `/24`,
source matches staging, confirmation exists, timer is inactive, no rollback or
pending file remains, gateway/DNS and `nic0` bridge membership are unchanged.
The PVE cluster is six-node online/quorate, all four Kubernetes nodes are Ready,
each control-plane `/readyz` passes and PDM TCP is reachable. Inventory current
prefixes now match. No guest prefix, router/storage, Windows networking or
VLAN changed. Future live invocations still default off and need their own
reviewed scope; completed host changes are not approval for broader migration.

The owner approved the one-host pilot and it completed on 2026-10-16 UTC:
worker1 is runtime/persisted `.14/24`, source hashes match, the pending file is
absent, confirmation exists and the local timer is inactive without rollback.
All six PVE nodes remain online/quorate and the worker guest is Ready. The
inventory's `worker1_pve.current_flat.prefix` now records 24; its Talos guest,
router and remaining hosts were not changed. The first raw-byte guard refusal
was inspected/reverted before the controlled parser-guard repair and retry.
Default live opt-in remains false; this completed pilot is not approval for
another host or the whole subnet transition.

PVE's successful reload generated a zero-byte `interfaces.d/sdn` file. An initial
post-change inspection refused it conservatively; after validating that exact
empty regular file and testing the narrow exception, the converged read-only
preview passes `ok=14`, `changed=0`, `failed=0`, `skipped=36`. No additional
network activation was performed to repair the inspection policy.

### Edge Host Preparation

The edge extension was separately approved and deployed on 2026-10-16 UTC.
Its preflight showed `.3/16`, `onboard`, the seven declared interface stanzas,
no pending file or extra includes/SDN zones and both guests running. OPNsense's passed-through
PCI configuration is read, never written. The playbook compares whole protected
guest configurations before/after, requires the router QEMU PID unchanged and
requires Technitium's existing daemon PID unchanged. No guest restart/power
command is used. Router `.1:443`, Technitium `.30:5380` and explicit external/
internal DNS checks must pass before confirmation.

All thirteen offline cases pass, including the actual edge model and guest
assertions against healthy and drifted fixtures. Unintended NIC, passthrough,
router process, stopped guest or DNS-daemon changes refuse confirmation. The
include-directory scan also sees symlinks/other entries; only the known empty
regular `sdn` file is excepted. Edge's preparation preview returned `ok=19`,
`changed=0`, `failed=0`, `skipped=48`; no mutation ran in that preview.

The first stage was safely refused because PVE moved the unchanged manual NIC
stanzas before `vmbr0`. Exact hashes and all seven parsed models were inspected,
then only the owned pending file was reverted without reload. The actual edge
fixture now reproduces that order: directive multiset plus complete parsed
models allow reserialization, not an additional setting change. The controlled
second run completed `ok=62`, `changed=10`, `failed=0` at 02:05:58Z.

At 02:07:02Z, edge is runtime/persisted `.3/24`, gateway/DNS `.1`, bridge
`onboard`, no pending file, source hash matching staging, confirmation present
and timer inactive without rollback. Protected guest configurations, router
QEMU PID and Technitium daemon PID are unchanged, and the LXC retains `.30/24`.
Router external DNS, Technitium internal DNS, external HTTPS, six-node quorum
and four Kubernetes Ready nodes pass. Inventory now matches. No router guest,
passthrough, storage, Windows, VLAN or guest-power change was made. Use
`--limit edge_pve --check` for inspection; future live operations still require
their own scope and fresh recovery identity, with default opt-in false.

## Guarded Talos Guest Management Prefix

The [Talos prefix controller](../../scripts/talos-prefix-pilot.mjs) defaults to
preview and accepts exactly one of `worker1-talos`, `cp1-talos`, `cp2-talos`,
`cp3-talos`. It is a bounded existing-node migration, not a bootstrap or version
upgrade. The mixed Terraform root still generates Talos `1.7.5` configuration
while the live nodes run `1.8.1`; do not run that whole root to change masks.
All four guest masks were approved and completed on 2026-10-16 UTC; accepted
CIDRs/MAC selectors are reconciled into its node map, bootstrap patches and
current inventory. Terraform state was not refreshed or applied. Review its
older generated fields and live/source/version/state differences before any
future root apply; source alignment is not a claim of Terraform convergence.

Requirements:

- Controller: Node.js `24`, Python 3/PyYAML, the existing `owl-k8s` Talos context,
  `admin@owl-k8s` kubeconfig and authenticated direct access to all four nodes,
  API VIP `.20` and the three control-plane APIs. No new token, collection, npm
  dependency, SSH access or OS resolver change is needed.
- Matching official Linux/amd64 `talosctl 1.8.1`, SHA-256
  `c44180a3a4e91325a820464a9bff5ba3e5e86840ca8faa1d2f2e1340ecdd9271`.
  Default executable is
  `~/.local/share/owl-red/tools/talos/1.8.1/talosctl`; `TALOSCTL_BINARY` may select
  another path, but the same checksum is enforced. The installed system `1.13.0`
  CLI is not replaced or used by this migration controller.
- All four Kubernetes nodes Ready, API VIP and all three direct `/readyz`
  endpoints passing, exactly three expected etcd voting members and exactly one
  live `.20/32` VIP. Run only one node/operation at a time, worker first; do not
  run another Talos configuration writer during the trial.

The controller derives a candidate from the exact live machine configuration,
uses Talos's actual JSON Patch implementation and compares the complete parsed
candidate with a one-address-list replacement. Role, hostname, MAC selector,
single interface/address, gateway, DNS and control-plane VIP are checked. A
strategic merge appends address lists and is not suitable for this contraction.
The [worker migration patch](../../talos/patches/management-prefix-worker1.yaml)
is a reviewable one-shot equivalent, not the bootstrap template. Already `/24`,
unexpected interfaces/addresses or identity drift refuse rather than guessing.

```bash
node --test scripts/talos-prefix-pilot.test.mjs
node scripts/talos-prefix-pilot.mjs --node worker1-talos
```

The preview command above is for the reviewed before-state, not an instruction
to repeat the completed migration: all four accepted guests now `/24` correctly
fail its one-shot `/16` precondition. For ordinary inspection use authenticated
`talosctl get` address/route resources, not another migration invocation.

Only after explicit scope approval, add `--apply-confirmed`. Every invocation
uses a new owner-only evidence directory under
`~/.local/state/owl-red/talos-prefix/`. Full before/candidate machine configs
contain secret material: directories are `0700`, files `0600`; never publish
them, print them into chat or put them in Git. Preview runs server-side
`no-reboot --dry-run` and verifies the stored configuration stayed unchanged.

Live activation uses `--mode try --timeout 3m`, which applies immediately or
fails if a reboot would be needed. Talos reverts unless another configuration
update confirms it. Before confirming the identical candidate with
`--mode no-reboot`, require runtime `/24`, unchanged gateway/boot identity/link,
whole-config equality, four Ready nodes, direct/API VIP readiness, `/32` VIP and
three voting members; leave at least one minute of the recovery interval. Then
read back config/runtime/health again. Talos/Kubernetes versions, install image,
DNS, gateway, VIP and all other machine/cluster fields are not changed.

On failure, stop and inspect the private phase/evidence plus actual state; never
blindly retry or apply another update while relying on automatic recovery.
An unknown confirmation outcome is not proof the trial remains armed, and a
confirmed change is not automatically reverted. Inspect the saved preimage and
any concurrent drift before an approved inverse change. No reboot, upgrade,
reset, drain, guest power command or broad Terraform apply is part of this lane.
The offline CI job uses the checksum-pinned CLI and fake local configs without
cluster credentials; a local pass is not a remote workflow result.

Worker confirmation completed at 17:02:08Z, then cp1/cp2/cp3 at 17:02:38Z,
17:02:48Z and 17:02:59Z. All four report only the management CIDR changed, same
boot identity and Talos version, four Ready nodes, API/direct readiness and three
voting members. Runtime VIP remains exactly one `.20/32`; no reboot, upgrade or
rollback was needed. Five final offline cases and the touched Terraform format
check pass. Router/NAS/client masks, VLAN paths and service-authority handoff
were not changed, and no assistant Git commit/publish occurred.

## Guarded Dnsmasq Range Preparation

The [range-only playbook](../../ansible/playbooks/opnsense-dhcp-range.yml) and
its [offline tests](../../scripts/opnsense-dhcp-range.test.mjs) require Ansible
core `2.16.3`, Python `3.12` with PyYAML/Jinja dependencies and Node.js `24`
(the tested controller/CI versions). They use built-in Ansible modules and
Node's standard HTTP/process/file APIs, with no new collection or npm package.
The test suite uses only loopback HTTP, synthetic credentials and a local
`printf` replacement for the Kubernetes read; it cannot apply to the router.

```bash
node --test scripts/opnsense-dhcp-range.test.mjs
```

Live check mode additionally needs the existing inventory, reachable appliance
API, `OPNSENSE_API_KEY`/`OPNSENSE_API_SECRET` in the child environment and a
working selected `kubectl` context for actual service allocations. Preserve
existing TLS verification except the explicitly reviewed appliance exception.
The Terraform wrapper's `TF_VAR_*` names do not populate these variables.
No vault, infrastructure credentials or Kubernetes connection is needed in CI.

Both live activation flags default false. The documented
[connection/recovery gates](../../terraform/opnsense/README.md#preserve-the-control-connection)
must be satisfied before lifting them: the offered phone hotspot is not a
verified fallback until internet/DNS and LAN routes are tested. No silent
Windows route, resolver or IPv6 changes are part of controller setup.

The owner later explicitly requested the bounded range-only deployment without
Windows route changes. That one-time activation used fresh affected-field
preimages and confirmed console access; it did not certify independent hotspot
egress or a full-current XML export. The playbook completed successfully and
DHCP/DNS/HTTPS checks passed. Default opt-ins stay false for future invocations;
the broader subnet migration is not authorized by this outcome.

The temporary tested Bitwarden CLI/profile had disappeared. The same official
`2026.7.0` archive was reverified against its published SHA256
`7a35145e205952f7434d2370da359543145ae0c45ba1af0fe9bdd99d40a00180` and is now
at `~/.local/share/owl-red/tools/bitwarden/2026.7.0/bw`, with a separate copied
profile at `~/.local/state/owl-red/bitwarden-cli-2026.7.0`. Direct item/API reads
passed again; scripts do not automatically use this binary or profile unless
explicitly configured. The installed original CLI was not replaced. An original
profile change was observed during setup and was not attributed or reverted;
do not claim the original stayed byte-identical for that whole interval.
The subsequent isolated status check left it unchanged. Protect profiles and
sessions as before; do not persist master passwords or session keys in files.

## Non-Mutating Validation

```bash
shellcheck nix/hosts/technitium/sync.sh nix/hosts/technitium/sync.test.sh
bash -n nix/hosts/technitium/sync.sh nix/hosts/technitium/sync.test.sh
bash nix/hosts/technitium/sync.test.sh
nix-instantiate --parse nix/hosts/technitium/configuration.nix >/dev/null
nix-build nix/hosts/technitium/check.nix -A sync --no-out-link
nix-build nix/hosts/technitium/check.nix -A system --no-out-link --max-jobs 2 --cores 2
pre-commit run --all-files
```

The Technitium tests need Bash, jq, Git and normal GNU file utilities and use
fake Git/API operations; they need no router, LXC or vault access. Nix module
builds must remain non-activating until a rollout is approved: `nixos-rebuild
switch`, the Ansible install role and service starts are not validation-only
commands. See [guarded rollout](../../gitops/technitium/README.md#guarded-rollout).

The [check expression](../../nix/hosts/technitium/check.nix) evaluates the real
NixOS module, asserts disabled scope intent and the host activation lock during
preparation, and builds the packaged sync (`sync`) or complete LXC system closure
(`system`). Its default input is the immutable official NixOS release
`25.11.10830.d7a713c0b7e4`, revision
`d7a713c0b7e47c908258e71cba7a2d77cc8d71d5`, with a fixed unpacked SHA256. It
requires no global `<nixpkgs>` channel. Preparation assertions must be reviewed
explicitly when a future approved handoff changes the activation policy.

The validation input now matches the read-only observed LXC input, rather than
the newer 25.11 revision used for the initial build check. The target still uses
its existing channel: the Ansible opt-out prevents updating it during this role,
but does not pin it against changes by another operator. Recheck the target
revision before any approved rollout. The `technitium_nixos` task tag isolates
Nix-host update tasks from credential bootstrap and the explicit sync stage;
connected `--check` previews skip the asynchronous rebuild. Without check mode,
execution activates the host, and any nonzero rebuild result, including exit
code 4, fails the role.

Verified locally on 2026-10-14: Nix `2.18.1` module parsing, packaged sync build
(including Nix's ShellCheck `0.11.0` gate), full LXC system build, standalone
ShellCheck `0.9.0` and all 20 offline tests passed. Builds only wrote the local
Nix store: no activation, remote copy or channel update occurred. Before a
rollout, compare the validation input and resulting package/unit changes with
the running host; a successful local build does not authorize an implicit OS or
Technitium upgrade. Installed-version API and no-offer packet checks remain
required.

The subsequent approved guard-only rollout on 2026-10-15 used the same input
and activated that reviewed system generation. Installed API version 14.0,
runtime lock false and all five disabled scope states were verified; DNS stayed
healthy without restarting its process, and addresses/routes were unchanged.
This API-only check did not replace packet acceptance or authorize a DNS/DHCP
handoff. See the dated evidence in the [rollout guide](../../gitops/technitium/README.md#guarded-rollout).

Subsequent native-LAN captures passed before and after a sync-unit restart on
2026-10-15 using Nmap `7.95`, tcpdump `4.99.5` / libpcap `1.10.5`, util-linux
`nsenter` `2.41`, existing LXC tooling, Node.js 24 and Python's standard XML
parser. Both captures per phase saw the same DISCOVER and OPNsense offer, with
zero drops and no Technitium offer. The helper has seven passing offline cases;
no package or capture-tool installation was needed. This does not certify a
DNS-daemon/LXC restart, IPv6 policy, future VLANs or real client renewal.

A separately approved daemon-only restart then passed on 2026-10-15. The
additional preflight used Node's built-in byte/hash APIs to verify the saved
version-9 scope header/name/disabled flag against the upstream 14.0.0 format;
this was a narrow prefix check, not a general scope parser. Existing iproute2
`ss` verified no UDP 67 listener. No new dependency or target installation was
needed. With the sync timer paused, startup API flags and file hashes remained
disabled/unchanged before reconciliation; the native-LAN capture again saw only
OPNsense offers. DNS/API recovered and the timer was restored. Whole-container
boot, future VLANs, IPv6/RA and real-client handoff remain outside that result.