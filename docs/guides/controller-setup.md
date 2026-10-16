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