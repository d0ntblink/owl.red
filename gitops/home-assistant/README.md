# Home Assistant

Home Assistant Container runs through Fleet at `https://ha.owl.red`, with one
replica and a Recreate update strategy. It is not Home Assistant OS: Supervisor
and its add-on store are not included. Supporting services are separate workloads.

## Storage

- The retained `config` PVC uses `nas-appdata-smb` and only its own generated
  directory. The workload runs as `1001:100`; no existing appdata permissions
  are changed. The requested size is not an enforced SMB quota.
- Recorder uses the dedicated `home-assistant-postgres` container on the NAS.
  Its bind mount is `/mnt/ssd/appdata/home-assistant-db/data`, directly on local
  SSD storage, never through SMB. Its separate application role is not a superuser.
- PostgreSQL listens on the NAS management address, TCP 15432, using SCRAM
  authentication. Database traffic currently uses the private management network,
  not TLS; never expose that port to the internet or untrusted networks.
- `configuration.yaml` is Git-managed and mounted read-only. UI onboarding,
  integration state, automations, scripts and scenes remain on the config PVC.
  The initializer creates missing YAML files only; it never replaces existing ones.

SMB configuration plus a separate recorder does not make the NAS redundant.
Retained storage is not a backup. Cloud/rclone backups and power work remain
deferred; existing NAS applications and production media are not migrated here.

## Recorder Management

Use the [dedicated playbook](../../ansible/playbooks/home-assistant-db.yml)
through its private credential/socket runner, from the repository root:

```bash
node scripts/home-assistant-db-run.mjs --apply
```

The runner reuses three Bitwarden entries, creating them only if absent:

- `home-assistant__postgres__admin-password`
- `k8s__home-assistant__recorder__password`
- `k8s__home-assistant__recorder__db-url`

It rejects duplicate keys or mismatched existing values rather than rotating
credentials. SDK authentication runs in a captured child with verified Error
logging; private values enter Ansible only through its child environment and
secret-bearing tasks use `no_log`. Never run the SDK worker directly or enable
verbose credential logging. Failed output is retained only in owner-only
controller state outside Git.

The Docker API is reached through a temporary, owner-only SSH-forwarded Unix
socket; no TCP Docker API is enabled. Only the named recorder container and its
marked directory are managed. Do not recreate it through an unrelated Unraid
template or remove its local data during an image upgrade.

Controller requirements: Node 20.12+; the existing Ansible/OpenSSH environment;
`community.docker` 5.2.0, `community.postgresql` 4.2.0 and controller Python
`psycopg[binary]` 3.3.6; official `@bitwarden/sdk-napi` 1.0.0 at the controller's
private tool prefix. The NAS needs Docker, the existing pinned SSH key and its
mounted SSD pool; this lane does not install NAS Python or manage array settings.
Images are digest-pinned. Changing a database major version requires a separate
migration procedure, not a tag replacement against the same data directory.

## Initial Onboarding

Fleet declares the namespace and recorder Secret mapping through the existing
Bitwarden bundle. Once the namespace exists, bootstrap its private operator
token without putting it in a manifest or overwriting an existing token:

```bash
node scripts/home-assistant-db-run.mjs --apply --bootstrap-kubernetes
```

Initial ingress is limited to `10.0.10.0/24` and the administration workstation
at `10.0.20.10/32`. Open `https://ha.owl.red` from that path and create the owner
account yourself; account passwords and integration credentials do not belong
in chat or Git. User accounts are not pre-created by deployment automation.

The container uses ordinary pod networking, with no host network, USB/Bluetooth
mapping or new inter-VLAN firewall permissions. Device-specific discovery,
thermostat/printer setup and any broader client access remain separate work.
The HTTP proxy trusts the cluster pod CIDR for Traefik headers; this is not a
multi-tenant security boundary.

ConfigMap and environment-Secret changes require a controlled restart to be
loaded. Keep one active writer during updates; never start a parallel Home
Assistant instance against the same config volume or recorder database.