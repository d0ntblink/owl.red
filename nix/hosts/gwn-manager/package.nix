{ pkgs }:

let
  manifest = builtins.fromJSON (builtins.readFile ../../../ansible/vars/gwn-manager.json);
in
pkgs.stdenv.mkDerivation {
  pname = "gwn-manager";
  version = manifest.version;
  src = pkgs.fetchurl {
    url = manifest.source.url;
    sha256 = manifest.source.sha256;
  };

  nativeBuildInputs = with pkgs; [ dpkg autoPatchelfHook openssl upx jq ];
  buildInputs = with pkgs; [
    stdenv.cc.cc.lib
    zlib
    libaio
    libxcrypt-legacy
    ncurses
    openssl
    fontconfig
    freetype
    xorg.libX11
    xorg.libXext
    xorg.libXrender
    alsa-lib
    xorg.libXtst
    xorg.libXi
  ];

  dontConfigure = true;
  dontBuild = true;
  dontStrip = true;
  installPhase = ''
    runHook preInstall
    mkdir -p extracted "$out"
    for package in packages/*.deb; do
      dpkg-deb --extract "$package" extracted
    done
    upx --decompress extracted/gwn/scripts/enc_file
    autoPatchelf extracted/gwn/scripts/enc_file
    bash extracted/gwn/scripts/decompress.sh \
      "$PWD/packages/GWN_Manager_Upgrade_${manifest.version}.tar.gz" \
      "$TMPDIR/application" notclean allowsameversion
    test -f "$TMPDIR/application/finished"
    cp -a extracted/gwn/. "$out/"
    cp -a "$TMPDIR/application/gwn/." "$out/"
    chmod -R u+w "$out"
    chmod -R 755 "$out/bin" "$out/scripts" "$out/gwn"
    find "$out/conf/sshd" -name 'ssh_host_*' -type f -delete
    substituteInPlace "$out/scripts/functions" \
      --replace-fail '-s /bin/bash' '-s ${pkgs.bash}/bin/bash'
    jq '.port = "8090"' "$out/apps/email/package.json" > "$TMPDIR/email-package.json"
    mv "$TMPDIR/email-package.json" "$out/apps/email/package.json"
    substituteInPlace "$out/bin/gwn/email-ctl" \
      --replace-fail 'sed -i "s/\"port\":.*/\"port\": \"''${listen_port}\"/g" ''${prog_dir}/package.json' \
      'test "$listen_port" = 8090'
    patchShebangs "$out"
    restoreVendorGateway() {
      cp "$TMPDIR/application/gwn/apps/gateway/gateway" "$out/apps/gateway/gateway"
    }
    postFixupHooks+=(restoreVendorGateway)
    runHook postInstall
  '';

  meta = {
    description = "Pinned vendor GWN Manager payload; NixOS runtime qualification required";
    platforms = [ "x86_64-linux" ];
    license = pkgs.lib.licenses.unfree;
  };
}