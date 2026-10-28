{ config, modulesPath, pkgs, lib, ... }:

let
  manifest = builtins.fromJSON (builtins.readFile ../../../ansible/vars/gwn-manager.json);
  package = import ./package.nix { inherit pkgs; };
  runtime = with pkgs; [ bash coreutils curl diffutils findutils gawk gnugrep gnused iproute2 openssl procps shadow util-linux wget ];
  prepare = pkgs.writeShellApplication {
    name = "gwn-manager-prepare";
    runtimeInputs = runtime;
    runtimeEnv = {
      GWN_PACKAGE = toString package;
      GWN_ADDRESS = builtins.head (lib.splitString "/" manifest.container.address);
    };
    text = builtins.readFile ./prepare.sh;
  };
in
{
  imports = [ (modulesPath + "/virtualisation/proxmox-lxc.nix") ];
  nix.settings.sandbox = false;
  nixpkgs.config.allowUnfree = true;
  programs.nix-ld = {
    enable = true;
    libraries = with pkgs; [ stdenv.cc.cc.lib zlib openssl libxcrypt-legacy ];
  };
  proxmoxLXC = {
    manageNetwork = false;
    privileged = false;
  };
  networking.hostName = manifest.container.hostname;
  time.timeZone = "America/Edmonton";
  networking.firewall = {
    enable = true;
    extraCommands = ''
      iptables -A nixos-fw -i eth0 -s 10.0.10.0/24 -p tcp -m multiport --dports 22,8443 -j nixos-fw-accept
      ${lib.optionalString (manifest.qualification.nixos_runtime && manifest.qualification.ap_adoption_allowed) ''
        iptables -A nixos-fw -i eth0 -s 10.0.10.107/32 -p tcp --dport 10014 -j nixos-fw-accept
      ''}
    '';
  };
  services.openssh = {
    enable = true;
    openFirewall = false;
    settings = {
      PermitRootLogin = "prohibit-password";
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
    };
  };
  users.groups.gwn = {};
  users.users.gwn = {
    isSystemUser = true;
    group = "gwn";
    home = "/var/lib/gwn-manager";
    shell = pkgs.bash;
  };
  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDqoyepjR/SOCv/Hc2LRR11sd292weLQrgRmBZFtpdIG ansible@owl.red"
  ];
  environment.systemPackages = runtime ++ [ pkgs.python3 ];
  systemd.services.gwn-manager = {
    description = "Local GWN Manager controller";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    path = runtime;
    environment = {
      inherit (config.environment.variables) NIX_LD NIX_LD_LIBRARY_PATH;
    };
    serviceConfig = {
      User = "gwn";
      Group = "gwn";
      Type = "simple";
      ExecStartPre = "+${prepare}/bin/gwn-manager-prepare";
      ExecStart = "/gwn/scripts/services_checker.sh";
      ExecStop = "+/gwn/gwn stop";
      Restart = "on-failure";
      RestartSec = 10;
      TimeoutStartSec = 300;
      TimeoutStopSec = 90;
      LimitNOFILE = 65535;
      UMask = "0077";
      KillMode = "control-group";
      PrivateTmp = true;
    };
  };
  system.stateVersion = "25.11";
}