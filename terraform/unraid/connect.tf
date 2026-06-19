# Unraid Connect / remote access — PINNED to DISABLED (ADR 012: no internet exposure
# of the NAS). updateApiSettings returns ConnectSettingsValues.
resource "graphql_mutation" "connect_settings" {
  mutation_variables = {
    accessType = var.connect_access_type
  }
  compute_mutation_keys = { "accessType" = "remoteAccess.accessType" }

  create_mutation = "mutation($accessType: WAN_ACCESS_TYPE) { updateApiSettings(input: {accessType: $accessType}) { __typename } }"
  update_mutation = "mutation($accessType: WAN_ACCESS_TYPE) { updateApiSettings(input: {accessType: $accessType}) { __typename } }"
  delete_mutation = "mutation { updateApiSettings(input: {accessType: DISABLED}) { __typename } }"
  read_query      = "query { remoteAccess { accessType forwardType port } }"

  enable_remote_state_verification = false
}
