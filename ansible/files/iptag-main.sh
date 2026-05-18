#!/bin/bash
# iptag — IP address tagging service for Proxmox VMs and LXC containers
# Managed by Ansible (deploy-iptag.yml) — do not edit manually.
# Config: /opt/iptag/iptag.conf

readonly CONFIG_FILE="/opt/iptag/iptag.conf"
readonly DEFAULT_TAG_FORMAT="full"
readonly DEFAULT_CHECK_INTERVAL=60

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

DEBUG=${DEBUG:-false}

debug_log() {
    if [[ "$DEBUG" == "true" || "$DEBUG" == "1" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly GRAY='\033[0;37m'
readonly NC='\033[0m'

log_success()   { echo -e "${GREEN}checkmark${NC} $*"; }
log_info()      { echo -e "${BLUE}info${NC} $*"; }
log_warning()   { echo -e "${YELLOW}warn${NC} $*"; }
log_error()     { echo -e "${RED}error${NC} $*"; }
log_change()    { echo -e "${CYAN}changed${NC} $*"; }
log_unchanged() { echo -e "${GRAY}same${NC} $*"; }

ip_in_cidr() {
    local ip="$1" cidr="$2"
    local network prefix
    IFS='/' read -r network prefix <<< "$cidr"
    local ip_int net_int mask a b c d
    IFS='.' read -r a b c d <<< "$ip"
    ip_int=$(( (a << 24) + (b << 16) + (c << 8) + d ))
    IFS='.' read -r a b c d <<< "$network"
    net_int=$(( (a << 24) + (b << 16) + (c << 8) + d ))
    mask=$(( 0xFFFFFFFF << (32 - prefix) ))
    local ip_masked=$((ip_int & mask))
    local net_masked=$((net_int & mask))
    (( ip_masked == net_masked ))
}

format_ip_tag() {
    local ip="$1"
    [[ -z "$ip" ]] && return
    local format="${TAG_FORMAT:-$DEFAULT_TAG_FORMAT}"
    case "$format" in
        "last_octet")      echo "${ip##*.}" ;;
        "last_two_octets") echo "${ip#*.*.}" ;;
        *)                 echo "$ip" ;;
    esac
}

ip_in_cidrs() {
    local ip="$1"
    [[ -z "${CIDR_LIST[*]:-}" ]] && return 1
    for cidr in "${CIDR_LIST[@]}"; do
        ip_in_cidr "$ip" "$cidr" && return 0
    done
    return 1
}

is_valid_ipv4() {
    local ip="$1"
    [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
    local IFS='.' parts
    read -ra parts <<< "$ip"
    for part in "${parts[@]}"; do
        (( part >= 0 && part <= 255 )) || return 1
    done
    return 0
}

get_vm_ips() {
    local vmid=$1
    local ips=""
    local vm_config="/etc/pve/qemu-server/${vmid}.conf"
    [[ ! -f "$vm_config" ]] && return

    local vm_status=""
    if command -v qm >/dev/null 2>&1; then
        vm_status=$(qm status "$vmid" 2>/dev/null | awk '{print $2}')
    fi
    [[ "$vm_status" != "running" ]] && return

    local mac_addresses
    mac_addresses=$(grep -E "^net[0-9]+:" "$vm_config" | grep -oE "([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}" | head -3)

    # Method 1: QEMU guest agent (best — real-time)
    if command -v qm >/dev/null 2>&1; then
        local qm_ips
        qm_ips=$(timeout 8 qm guest cmd "$vmid" network-get-interfaces 2>/dev/null \
            | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | grep -v "127.0.0.1" | head -3)
        for qm_ip in $qm_ips; do
            is_valid_ipv4 "$qm_ip" && ips+="$qm_ip "
        done
    fi

    # Method 2: ARP table fallback (works for Talos/no-agent VMs)
    if [[ -z "$ips" && -n "$mac_addresses" ]]; then
        for mac in $mac_addresses; do
            local mac_lower
            mac_lower=$(echo "$mac" | tr '[:upper:]' '[:lower:]')
            local current_ip
            current_ip=$(ip neighbor show | grep "$mac_lower" \
                | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
            if [[ -n "$current_ip" ]] && is_valid_ipv4 "$current_ip"; then
                if timeout 2 ping -c 1 "$current_ip" >/dev/null 2>&1; then
                    ips+="$current_ip "
                fi
            fi
        done
    fi

    echo "$ips" | tr ' ' '\n' | sort -u | tr '\n' ' ' | xargs
}

get_lxc_ips() {
    local vmid=$1
    local ips=""
    local ct_config="/etc/pve/lxc/${vmid}.conf"
    [[ ! -f "$ct_config" ]] && return

    local ct_status=""
    if command -v pct >/dev/null 2>&1; then
        ct_status=$(pct status "$vmid" 2>/dev/null | awk '{print $2}')
    fi
    [[ "$ct_status" != "running" ]] && return

    local raw_ips
    raw_ips=$(pct exec "$vmid" -- ip -4 addr show 2>/dev/null \
        | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | grep -v "127.0.0.1")
    for ip in $raw_ips; do
        is_valid_ipv4 "$ip" && ips+="$ip "
    done

    echo "$ips" | tr ' ' '\n' | sort -u | tr '\n' ' ' | xargs
}

declare -A IP_CACHE

update_tags() {
    local type="$1" vmid="$2"
    local current_ips_full
    local current_tags_raw=""

    local cache_key="${type}_${vmid}"
    if [[ -n "${IP_CACHE[$cache_key]:-}" ]]; then
        current_ips_full="${IP_CACHE[$cache_key]}"
    else
        if [[ "$type" == "lxc" ]]; then
            current_ips_full=$(get_lxc_ips "${vmid}")
        else
            current_ips_full=$(get_vm_ips "${vmid}")
        fi
        IP_CACHE[$cache_key]="$current_ips_full"
    fi

    if [[ "$type" == "lxc" ]]; then
        local config_file="/etc/pve/lxc/${vmid}.conf"
        [[ -f "$config_file" ]] && current_tags_raw=$(grep "^tags:" "$config_file" 2>/dev/null \
            | cut -d: -f2 | sed 's/^[[:space:]]*//')
    else
        local vm_config="/etc/pve/qemu-server/${vmid}.conf"
        [[ -f "$vm_config" ]] && current_tags_raw=$(grep "^tags:" "$vm_config" 2>/dev/null \
            | cut -d: -f2 | sed 's/^[[:space:]]*//')
    fi

    local current_tags=() next_tags=() current_ip_tags=()
    if [[ -n "$current_tags_raw" ]]; then
        mapfile -t current_tags < <(echo "$current_tags_raw" | sed 's/;/\n/g')
    fi

    for tag in "${current_tags[@]}"; do
        if is_valid_ipv4 "${tag}" || [[ "$tag" =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
            current_ip_tags+=("${tag}")
        else
            next_tags+=("${tag}")
        fi
    done

    local formatted_ips=()
    for ip in $current_ips_full; do
        [[ -z "$ip" ]] && continue
        if is_valid_ipv4 "$ip" && ip_in_cidrs "$ip"; then
            local formatted_ip
            formatted_ip=$(format_ip_tag "$ip")
            [[ -n "$formatted_ip" ]] && formatted_ips+=("$formatted_ip")
        fi
    done

    if [[ "$type" == "lxc" && ${#formatted_ips[@]} -eq 0 ]]; then
        log_unchanged "LXC ${vmid}: no IP detected, tags unchanged"
        return
    fi

    local final_tags=()
    for new_ip in "${formatted_ips[@]}"; do
        final_tags+=("$new_ip")
    done
    for tag in "${next_tags[@]}"; do
        final_tags+=("$tag")
    done
    next_tags=("${final_tags[@]}")

    local old_tags_str new_tags_str
    old_tags_str=$(IFS=';'; echo "${current_tags[*]}")
    new_tags_str=$(IFS=';'; echo "${next_tags[*]}")

    if [[ "$old_tags_str" != "$new_tags_str" ]]; then
        if [[ "$type" == "lxc" ]]; then
            pct set "$vmid" -tags "$(IFS=';'; echo "${next_tags[*]}")" 2>/dev/null \
                && log_change "LXC ${vmid}: tags updated -> ${next_tags[*]}" \
                || log_error "LXC ${vmid}: failed to update tags"
        else
            qm set "$vmid" -tags "$(IFS=';'; echo "${next_tags[*]}")" 2>/dev/null \
                && log_change "VM  ${vmid}: tags updated -> ${next_tags[*]}" \
                || log_error "VM  ${vmid}: failed to update tags"
        fi
    else
        log_unchanged "${type} ${vmid}: tags unchanged (${old_tags_str:-none})"
    fi
}

run_once() {
    unset IP_CACHE
    declare -A IP_CACHE

    log_info "Scanning VMs..."
    while IFS= read -r vmid; do
        [[ -z "$vmid" ]] && continue
        update_tags "vm" "$vmid"
    done < <(qm list 2>/dev/null | awk 'NR>1 {print $1}')

    log_info "Scanning LXC containers..."
    while IFS= read -r vmid; do
        [[ -z "$vmid" ]] && continue
        update_tags "lxc" "$vmid"
    done < <(pct list 2>/dev/null | awk 'NR>1 {print $1}')
}

if [[ "${FORCE_SINGLE_RUN:-false}" == "true" ]]; then
    run_once
    exit 0
fi

log_info "IP-Tag service starting (interval: ${LOOP_INTERVAL:-300}s, format: ${TAG_FORMAT:-full})"
while true; do
    run_once
    sleep "${LOOP_INTERVAL:-300}"
done
