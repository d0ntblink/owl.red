{ config, modulesPath, pkgs, lib, ... }:

let
  # Full GitOps sync script — embedded in Nix store with pinned runtime deps.
  # Applies: server settings, DNS zones, DHCP scopes, DHCP reservations.
  # Source of truth: gitops/technitium/ in the owl.red repo.
  syncScript = pkgs.writeShellApplication {
    name = "technitium-sync";
    runtimeInputs = [ pkgs.git pkgs.curl pkgs.jq ];
    text = builtins.readFile ./sync.sh;
  };
in
{
  imports = [ (modulesPath + "/virtualisation/proxmox-lxc.nix") ];

  # LXC containers cannot use user namespaces for the Nix sandbox
  nix.settings.sandbox = false;

  proxmoxLXC = {
    # Proxmox manages the network (IP set via terraform initialization block)
    manageNetwork = false;
    # Must match unprivileged = false in terraform
    privileged = true;
  };

  # ---------------------------------------------------------------------------
  # Technitium DNS + DHCP server
  # Admin account and API token are bootstrapped by Ansible (bootstrap.yml).
  # ---------------------------------------------------------------------------
  services.technitium-dns-server = {
    enable = true;
    openFirewall = true;
  };

  # ---------------------------------------------------------------------------
  # SSH — key-only, Ansible owl.red deploy key only
  # ---------------------------------------------------------------------------
  services.openssh = {
    enable = true;
    openFirewall = true;
    settings = {
      PermitRootLogin = "prohibit-password";
      PasswordAuthentication = false;
    };
  };

  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDqoyepjR/SOCv/Hc2LRR11sd292weLQrgRmBZFtpdIG ansible@owl.red"
  ];

  # ---------------------------------------------------------------------------
  # GitOps sync: pull owl.red repo, apply all Technitium config declaratively.
  # Settings, zones, DHCP scopes, and reservations all sourced from gitops/.
  # Token written to /etc/technitium/sync.token by Ansible bootstrap.yml.
  # State (last applied SHA) in /var/lib/technitium-sync/last-sha.
  # Timer fires 3 min after boot, then every 15 min.
  # ---------------------------------------------------------------------------
  systemd.tmpfiles.rules = [
    "d /var/lib/technitium-sync 0700 root root -"
  ];

  systemd.services.technitium-sync = {
    description = "GitOps sync — apply owl.red Technitium config from git";
    after = [ "network-online.target" "technitium-dns-server.service" ];
    wants = [ "network-online.target" ];
    # Skip silently until Ansible bootstrap writes the API token
    unitConfig.ConditionPathExists = "/etc/technitium/sync.token";
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${syncScript}/bin/technitium-sync";
    };
  };

  systemd.timers.technitium-sync = {
    wantedBy = [ "timers.target" ];
    description = "Periodic GitOps sync for Technitium";
    timerConfig = {
      OnBootSec = "3min";
      OnUnitActiveSec = "15min";
    };
  };

  # python3 is required for Ansible modules
  environment.systemPackages = with pkgs; [ git curl jq python3 ];

  system.stateVersion = "25.11";
}
