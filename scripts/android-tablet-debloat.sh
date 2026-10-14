#!/system/bin/sh
set -eu
export PATH=/system/bin:/system/xbin:/sbin

[[ "$(id -u)" = 0 ]]
[[ "$(getprop ro.serialno)" = HVA0GSZV ]]
[[ "$(getprop ro.build.display.id)" = TB-X606FA_S300623_230730_BMP ]]
[[ "$(getprop ro.boot.veritymode)" = disabled ]]

mode=${1:-apply}
case "$mode" in
    apply|--check) ;;
    *) printf 'Usage: %s [apply|--check]\n' "$0" >&2; exit 2 ;;
esac

apps='com.android.egg|/system/app/EasterEgg
com.android.bips|/system/app/BuiltInPrintService
com.android.printspooler|/system/app/PrintSpooler
com.google.android.printservice.recommendation|/system/app/GooglePrintRecommendationService
com.google.android.gm|/system/product/app/Gmail2
com.google.android.apps.docs|/system/product/app/Drive
com.google.android.apps.maps|/system/product/app/Maps
com.google.android.apps.tachyon|/system/product/app/Duo
com.google.android.videos|/system/product/app/Videos
com.google.android.calendar|/system/product/app/CalendarGoogle
com.tblenovo.kidslauncher|/system/priv-app/KidsLauncher
cn.sinoangel.monsterclass|/data/app-3rd/MonsterClasscomm
cn.sinoangel.color|/data/app-3rd/MonsterColor
cn.sinoangel.kidcamera|/data/app-3rd/MonsterCamera
com.microsoft.bing.wallpapers|/data/app-3rd/BingWallpaper
com.google.android.calculator|/data/app-3rd/CalculatorGoogle
com.tblenovo.soundrecorder|/data/app-3rd/LenovoSoundRecorder
com.google.android.youtube|/system/product/app/YouTube
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
com.dolby.daxappui|/system/app/DaxUI
amazon.speech.sim|/system/priv-app/Vega
com.google.android.inputmethod.latin|/system/product/app/LatinImeGoogle
com.lenovo.ota|/system/priv-app/LenovoOTA'

if [[ -d /system/product/app/LatinImeGoogle ]]; then
    [[ -n "$(pm path juloo.keyboard2 2>/dev/null || true)" ]]
    [[ "$(settings get secure default_input_method)" = juloo.keyboard2/.Keyboard2 ]]
fi

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

if [[ "$mode" = --check ]]; then
    printf 'Removal preflight passed; no device changes made.\n'
    exit 0
fi

for setting in assistant voice_interaction_service voice_recognition_service; do
    case "$(settings get secure "$setting")" in
        amazon.speech.sim/*) settings put secure "$setting" "" ;;
    esac
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

if [[ -n "$(pm path com.github.muellerma.coffee 2>/dev/null || true)" ]]; then
    am force-stop com.github.muellerma.coffee
    pm uninstall com.github.muellerma.coffee
    removed_count=$((removed_count + 1))
    printf 'Uninstalled com.github.muellerma.coffee\n'
fi

sync
restore_readonly
trap - EXIT
printf '%s apps removed. No reboot or backup performed.\n' "$removed_count"