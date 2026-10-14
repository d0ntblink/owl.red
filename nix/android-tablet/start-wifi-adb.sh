#!/system/bin/sh
set -eu

[[ "$(id -u)" = 0 ]]
[[ "$(getprop ro.serialno)" = HVA0GSZV ]]
[[ "$(getprop ro.adb.secure)" = 1 ]]

setprop persist.adb.tcp.port 5555
if [[ "$(getprop service.adb.tcp.port)" != 5555 || "$(getprop init.svc.adbd)" != running ]]; then
    setprop service.adb.tcp.port 5555
    setprop ctl.restart adbd
fi