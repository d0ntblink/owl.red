#!/system/bin/sh
set -eu

[[ "$(id -u)" = 0 ]]
[[ "$(getprop ro.serialno)" = HVA0GSZV ]]
[[ "$(getprop ro.build.display.id)" = TB-X606FA_S300623_230730_BMP ]]
[[ "$(getprop ro.boot.veritymode)" = disabled ]]

apps='com.google.android.youtube|/system/product/app/YouTube
com.google.android.apps.youtube.music|/system/app/YTMusic
com.amazon.mp3|/data/app-3rd/AmazonMusic
com.google.android.googlequicksearchbox|/system/product/priv-app/Velvet
com.google.android.apps.googleassistant|/system/priv-app/GoogleAssistant
com.android.hotwordenrollment.xgoogle|/system/product/priv-app/HotwordEnrollmentXGoogleRISCV
com.android.hotwordenrollment.okgoogle|/system/product/priv-app/HotwordEnrollmentOKGoogleRISCV
com.google.android.apps.photos|/system/product/app/Photos
com.mediatek.camera|/system/priv-app/LenovoCamera
com.android.contacts|/system/product/priv-app/MtkContacts
com.android.fmradio|/system/product/app/FMRadio
com.google.android.apps.wellbeing|/system/product/priv-app/Wellbeing
com.google.android.marvin.talkback|/system/product/app/talkback
com.lenovo.screencapture|/system/priv-app/LenovoScreenRecorder
com.android.traceur|/system/app/Traceur
com.android.wallpaper.livepicker|/system/app/LiveWallpapersPicker
com.amazon.dee.app|/data/app-3rd/Vox
com.tblenovo.center|/system/priv-app/TabletCenter
com.android.chrome|/system/product/app/Chrome
com.google.android.deskclock|/system/product/app/DeskClockGoogle
com.dolby.daxappui|/system/app/DaxUI'

if [[ -d /system/product/app/Chrome ]]; then
    [[ -n "$(pm path de.baumann.browser 2>/dev/null || true)" ]]
fi
if [[ -d /system/product/app/DeskClockGoogle ]]; then
    [[ -n "$(pm path com.best.deskclock 2>/dev/null || true)" ]]
fi
[[ -n "$(pm path com.dolby.daxservice 2>/dev/null || true)" ]]

for entry in $apps; do
    package=${entry%%\|*}
    app_dir=${entry#*\|}
    if [[ ! -e "$app_dir" ]]; then
        [[ -z "$(pm path "$package" 2>/dev/null || true)" ]]
        continue
    fi
    [[ -d "$app_dir" && ! -L "$app_dir" ]]
    [[ -f "$app_dir/${app_dir##*/}.apk" ]]
    paths=$(pm path "$package")
    [[ -n "$paths" ]]
    for path_entry in $paths; do
        apk=${path_entry#package:}
        case "$apk" in
            "$app_dir/"*.apk|/data/app/"$package"-*/*.apk) ;;
            *) printf 'Unexpected APK path: %s\n' "$apk" >&2; exit 1 ;;
        esac
    done
done

restore_readonly() {
    if ! mount -o remount,ro /; then
        printf 'Read-only remount is busy; no reboot was requested.\n' >&2
    fi
}

trap restore_readonly EXIT
if [[ "$(settings get secure screensaver_components)" = com.google.android.deskclock/com.android.deskclock.Screensaver ]]; then
    settings put secure screensaver_components com.best.deskclock/.screensaver.Screensaver
fi
mount -o remount,rw /
removed_count=0

for entry in $apps; do
    package=${entry%%\|*}
    app_dir=${entry#*\|}
    if [[ ! -e "$app_dir" ]]; then
        continue
    fi
    update_dirs=''
    for path_entry in $(pm path "$package"); do
        apk=${path_entry#package:}
        case "$apk" in
            /data/app/"$package"-*/*.apk)
                update_dirs="$update_dirs ${apk%/*}"
                ;;
        esac
    done
    am force-stop "$package"
    pm uninstall --user 0 "$package"
    if [[ -e "$app_dir" ]]; then
        rm -r -- "$app_dir"
    fi
    [[ ! -e "$app_dir" ]]
    for update_dir in $update_dirs; do
        if [[ -e "$update_dir" ]]; then
            [[ -d "$update_dir" && ! -L "$update_dir" ]]
            rm -r -- "$update_dir"
        fi
        [[ ! -e "$update_dir" ]]
    done
    removed_count=$((removed_count + 1))
    printf 'Removed %s, including factory and update APKs\n' "$package"
done

sync
restore_readonly
trap - EXIT
printf '%s apps removed. No reboot or backup performed.\n' "$removed_count"