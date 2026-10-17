#!/bin/sh
set -eu
nft -f - <<'NFT'
add table inet owl_boot_guard
add chain inet owl_boot_guard incoming { type filter hook prerouting priority -500; policy drop; }
add rule inet owl_boot_guard incoming iifname "lo" accept
add rule inet owl_boot_guard incoming iifname "eth0" meta nfproto ipv4 udp sport 67 udp dport 68 accept
add rule inet owl_boot_guard incoming iifname "eth0" meta nfproto ipv6 udp sport 547 udp dport 546 accept
add rule inet owl_boot_guard incoming iifname "eth0" ip6 saddr { ::/128, fe80::/10 } ip6 hoplimit 255 icmpv6 type { nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert } accept
add rule inet owl_boot_guard incoming iifname "eth1" ip6 saddr { ::/128, fe80::/10 } ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } accept
NFT