{ nixpkgs ? builtins.fetchTarball {
    url = "https://releases.nixos.org/nixos/25.11/nixos-25.11.10830.d7a713c0b7e4/nixexprs.tar.xz";
    sha256 = "046szh6p14ffkayjcwa5ixm8kx71s9p4giq03i6v102y91ws1b69";
  }
}:

let
  pkgs = import nixpkgs {
    system = "x86_64-linux";
    config.allowUnfree = true;
  };
  evaluated = import (nixpkgs + "/nixos/lib/eval-config.nix") {
    system = "x86_64-linux";
    modules = [ ./configuration.nix ];
  };
  failures = builtins.filter (item: !item.assertion) evaluated.config.assertions;
in
assert pkgs.lib.assertMsg (failures == [])
  (pkgs.lib.concatStringsSep "\n" (map (item: item.message) failures));
{
  package = import ./package.nix { inherit pkgs; };
  system = evaluated.config.system.build.toplevel;
  unprivileged = !evaluated.config.proxmoxLXC.privileged;
}