# UPS / NUT — count-gated OFF (no UPS wired; NUT disabled). Flip var.ups_present=true
# and extend UPSConfigInput when a UPS is connected. configureUps returns Boolean (no selection).
resource "graphql_mutation" "ups" {
  count = var.ups_present ? 1 : 0

  mutation_variables    = { service = var.ups_service }
  compute_mutation_keys = { "service" = "upsConfiguration.service" }

  create_mutation = "mutation($service: UPSServiceState) { configureUps(config: {service: $service}) }"
  update_mutation = "mutation($service: UPSServiceState) { configureUps(config: {service: $service}) }"
  delete_mutation = "mutation { configureUps(config: {service: DISABLE}) }"
  read_query      = "query { upsConfiguration { service } }"

  enable_remote_state_verification = false
}
