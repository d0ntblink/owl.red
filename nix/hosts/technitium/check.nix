{ nixpkgs ? builtins.fetchTarball {
    url = "https://releases.nixos.org/nixos/25.11/nixos-25.11.10830.d7a713c0b7e4/nixexprs.tar.xz";
    sha256 = "046szh6p14ffkayjcwa5ixm8kx71s9p4giq03i6v102y91ws1b69";
  }
}:

let
  evaluated = import (nixpkgs + "/nixos/lib/eval-config.nix") {
    system = builtins.currentSystem;
    modules = [ ./configuration.nix ];
  };
  inherit (evaluated) config pkgs;
  failedAssertions = builtins.filter (item: !item.assertion) config.assertions;
  scopes = builtins.fromJSON (builtins.readFile ../../../gitops/technitium/dhcp/scopes.json);
in
assert pkgs.lib.assertMsg (failedAssertions == [ ])
  (pkgs.lib.concatStringsSep "\n" (map (item: item.message) failedAssertions));
assert pkgs.lib.assertMsg
  (config.systemd.services.technitium-sync.environment.DHCP_ENABLE_ALLOWED == "false")
  "Technitium DHCP activation must remain locked during preparation";
assert pkgs.lib.assertMsg (builtins.all (scope: scope.enabled == false) scopes)
  "Technitium DHCP scopes must remain disabled during preparation";
assert pkgs.lib.assertMsg
  (!(builtins.elem 22 config.networking.firewall.allowedTCPPorts)
    && !(builtins.elem 5380 config.networking.firewall.allowedTCPPorts)
    && !(builtins.elem 67 config.networking.firewall.allowedUDPPorts)
    && builtins.elem 22 config.networking.firewall.interfaces.eth0.allowedTCPPorts
    && builtins.elem 5380 config.networking.firewall.interfaces.eth0.allowedTCPPorts)
  "Technitium management must stay native-only and DHCP must stay blocked during VLAN preparation";
assert pkgs.lib.assertMsg
  (config.environment.etc."resolv.conf".source == "/run/systemd/resolve/resolv.conf"
    && pkgs.lib.hasInfix "DNSStubListener=no" config.services.resolved.extraConfig)
  "The OS resolver must not occupy Technitium's wildcard IPv4 TCP53 listener";
{
  sync = pkgs.runCommandLocal "owl-red-technitium-sync-check" {
    syncExecutable = config.systemd.services.technitium-sync.serviceConfig.ExecStart;
  } ''
    test -x "$syncExecutable"
    touch "$out"
  '';

  system = config.system.build.toplevel;
}