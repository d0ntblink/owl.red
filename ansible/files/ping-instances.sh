#!/usr/bin/env bash
# ping-instances watchdog — QEMU VMs only, opt-in via 'mon-restart' tag.
# LXC containers are excluded intentionally.
# Managed by Ansible (deploy-monitor-all.yml) — do not edit manually.
#
# To opt a VM in: qm set <vmid> -tags mon-restart
# NOTE: Do NOT tag Talos VMs — they have no QEMU guest agent.

excluded_instances=("$@")
echo "$(date): monitor-all starting. Excluded VMIDs: ${excluded_instances[*]:-none}"

while true; do

  for instance in $(qm list 2>/dev/null | awk 'NR>1 {print $1}'); do

    # Skip explicitly excluded VMIDs
    if [[ " ${excluded_instances[*]} " =~ " ${instance} " ]]; then
      echo "$(date): VM ${instance}: skipped (excluded)"
      continue
    fi

    # Skip templates
    if qm config "$instance" 2>/dev/null | grep -q "^template:"; then
      continue
    fi

    # Skip VMs explicitly set to not autostart
    if qm config "$instance" 2>/dev/null | grep -q "onboot: 0"; then
      echo "$(date): VM ${instance}: skipped (onboot disabled)"
      continue
    fi

    # Only monitor VMs with the mon-restart tag
    if ! qm config "$instance" 2>/dev/null | grep -q "tags:.*mon-restart"; then
      continue
    fi

    # If not running, start it
    vm_status=$(qm status "$instance" 2>/dev/null | awk '{print $2}')
    if [[ "$vm_status" != "running" ]]; then
      echo "$(date): VM ${instance}: not running (${vm_status}), starting..."
      qm start "$instance" >/dev/null 2>&1 \
        || echo "$(date): VM ${instance}: failed to start"
      continue
    fi

    # Check responsiveness via QEMU guest agent
    if qm guest cmd "$instance" ping >/dev/null 2>&1; then
      echo "$(date): VM ${instance}: OK (guest agent responded)"
    else
      echo "$(date): VM ${instance}: no guest agent response — restarting"
      qm stop "$instance" --timeout 30 >/dev/null 2>&1 || true
      sleep 5
      qm start "$instance" >/dev/null 2>&1 \
        || echo "$(date): VM ${instance}: failed to restart"
    fi

  done

  echo "$(date): cycle complete, sleeping 5 minutes..."
  sleep 300

done >> /var/log/ping-instances.log 2>&1
