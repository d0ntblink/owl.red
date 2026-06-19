# Server identity. updateServerIdentity: name is String! (non-null); comment/sysModel nullable. Returns Server.
resource "graphql_mutation" "server_identity" {
  mutation_variables = {
    name     = var.identity_name
    comment  = var.identity_comment
    sysModel = var.identity_sysmodel
  }
  compute_mutation_keys = { "name" = "vars.name" }

  create_mutation           = "mutation($name: String!, $comment: String, $sysModel: String) { updateServerIdentity(name: $name, comment: $comment, sysModel: $sysModel) { __typename } }"
  update_mutation           = "mutation($name: String!, $comment: String, $sysModel: String) { updateServerIdentity(name: $name, comment: $comment, sysModel: $sysModel) { __typename } }"
  delete_mutation           = "mutation($name: String!) { updateServerIdentity(name: $name) { __typename } }"
  delete_mutation_variables = { name = var.identity_name }
  read_query                = "query { vars { name comment sysModel } }"

  enable_remote_state_verification = false
}
