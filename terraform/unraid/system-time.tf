# NTP / system time. updateSystemTime maps to emhttp Settings > Date & Time (writes
# ident.cfg NTP_SERVER*/USE_NTP). Reverting (destroy) restores the public pool.
resource "graphql_mutation" "system_time" {
  mutation_variables = {
    useNtp     = tostring(var.use_ntp)
    ntpServers = jsonencode(var.ntp_servers)
  }
  compute_mutation_keys = { "useNtp" = "systemTime.useNtp" }

  create_mutation = "mutation($useNtp: Boolean, $ntpServers: [String!]) { updateSystemTime(input: {useNtp: $useNtp, ntpServers: $ntpServers}) { useNtp ntpServers } }"
  update_mutation = "mutation($useNtp: Boolean, $ntpServers: [String!]) { updateSystemTime(input: {useNtp: $useNtp, ntpServers: $ntpServers}) { useNtp ntpServers } }"
  delete_mutation = "mutation { updateSystemTime(input: {useNtp: true, ntpServers: [\"0.pool.ntp.org\",\"1.pool.ntp.org\",\"2.pool.ntp.org\",\"3.pool.ntp.org\"]}) { useNtp } }"
  read_query      = "query { systemTime { useNtp ntpServers timeZone } }"

  # Code is the source of truth; external (UI) drift is not auto-reconciled. The padded
  # ntpServers array does not round-trip cleanly, so server-side verification is off.
  enable_remote_state_verification = false
}
