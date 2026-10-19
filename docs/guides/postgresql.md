# Shared PostgreSQL

One PostgreSQL 17 instance on the NAS serves application-specific databases.
Each application gets its own database, owner/login role, password and connection
URL. Applications never receive the administrator credential. This is logical
isolation, not a separate process, resource quota or availability boundary.

## Configuration

Edit [postgresql.json](../../ansible/vars/postgresql.json). The `applications`
object is the application registry; passwords and URLs are Bitwarden references,
not values in Git. Home Assistant's existing entry preserves its database,
login, secret IDs and recorder history.

From the repository root:

```bash
node scripts/postgresql-run.mjs --validate-config
node scripts/postgresql-run.mjs --apply
```

The runner uses [the shared playbook](../../ansible/playbooks/postgresql.yml).
It validates distinct application databases, roles and secret references before
accessing Bitwarden. It reuses existing credentials and rejects mismatched URLs
instead of silently replacing them. Passwords are passed through a private
child environment with secret-bearing Ansible tasks suppressed by `no_log`.
SDK output is captured; never enable raw credential logging.

The old `home-assistant-db-run.mjs` and playbook paths remain compatibility
wrappers for these shared entry points. There is only one server/configuration
writer, not a second Home Assistant-specific database deployment.

## Add An Application

Merge a new entry into `applications`, retaining existing entries:

```json
{
  "example": {
    "database": "example",
    "role": "example",
    "password_secret": "postgresql__example__password",
    "url_secret": "postgresql__example__db-url",
    "kubernetes_namespace": "example"
  }
}
```

Replace `example` with the real application name, then validate and apply.
The namespace is optional for non-Kubernetes consumers. New secret keys must
be unique; the runner creates them in the existing infrastructure Bitwarden
project and prints only their references. Applications use restricted login
roles without superuser, database-creation, role-management or replication
privileges. PUBLIC access is revoked on each managed database; its owner and
administrators retain access.

Connect the URL secret to the client through that application's configuration
lane. For Kubernetes, declare its BitwardenSecret mapping and namespace through
Fleet, then bootstrap the private operator token if needed:

```bash
node scripts/postgresql-run.mjs --apply --bootstrap-kubernetes --application example
```

That namespace must already exist. The command refuses to overwrite a different
existing bootstrap token. It does not deploy the application or guess a secret
mapping for it. Do not paste URLs/passwords into manifests or command arguments.

Not every application supports PostgreSQL or the same extensions/version.
Qualify the application's documented database and migration requirements first.
Changing a credential reference is not an implicit password rotation procedure.
Removing an entry does not drop its database, role or Bitwarden secrets;
decommissioning requires separate data-retention and consumer review.

## Storage And Operations

The NAS displays the container as `postgresql`, with the PostgreSQL icon supplied
by its Unraid Docker label and native icon caches. The playbook safely adopts
the verified legacy `home-assistant-postgres` name and refuses conflicting
containers rather than starting two servers against the same data.

Data remains at `/mnt/ssd/appdata/home-assistant-db/data`. This retained disk
path and its directory marker avoid an unnecessary data move; they do not limit
the server to HA. The container uses the `shared-postgresql` ownership label.

- Data stays on NAS-local SSD, never SMB. Do not start a second PostgreSQL
  instance against the same directory.
- The endpoint remains `10.0.10.5:15432`, with SCRAM authentication on the
  private management network. Database traffic is not TLS-encrypted; never
  expose this listener to the internet or untrusted networks.
- The administrator password keeps its existing Bitwarden reference. HA's
  Kubernetes Secret and URL do not need to change.
- The current instance has a 768 MiB container limit and 30 maximum connections.
  Review aggregate memory, connection pools, disk growth and contention before
  adding substantial workloads. Per-database grants are not capacity isolation.
- Images are digest-pinned to PostgreSQL 17. A major upgrade needs a separate
  migration, not a tag replacement against existing data.
- A restart or NAS outage affects every consumer. Offsite cloud/rclone backups
  remain deferred; sharing the server does not provide redundancy or recovery.

Controller requirements remain Node 20.12+, pinned-key OpenSSH, the existing
Ansible environment with `community.docker` 5.2.0 and `community.postgresql`
4.2.0, `psycopg[binary]` 3.3.6, and official `@bitwarden/sdk-napi` 1.0.0 in
the private controller tool prefix. Docker uses a temporary SSH-forwarded Unix
socket, never a TCP Docker API. No NAS Python installation is required.