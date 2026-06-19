# SSH service (enabled + port). UpdateSshInput fields are non-null. Returns Vars.
resource "graphql_mutation" "ssh" {
  mutation_variables = {
    enabled = tostring(var.ssh_enabled)
    port    = tostring(var.ssh_port)
  }
  compute_mutation_keys = { "useSsh" = "vars.useSsh" }

  create_mutation = "mutation($enabled: Boolean!, $port: Int!) { updateSshSettings(input: {enabled: $enabled, port: $port}) { useSsh portssh } }"
  update_mutation = "mutation($enabled: Boolean!, $port: Int!) { updateSshSettings(input: {enabled: $enabled, port: $port}) { useSsh portssh } }"
  delete_mutation = "mutation { updateSshSettings(input: {enabled: true, port: 22}) { useSsh } }"
  read_query      = "query { vars { useSsh portssh } }"

  enable_remote_state_verification = false
}
