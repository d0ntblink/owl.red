variable "unraid_api_key" {
  description = "Unraid GraphQL API key (x-api-key). Export TF_VAR_unraid_api_key from bw."
  type        = string
  sensitive   = true
}

variable "unraid_graphql_url" {
  description = "Unraid GraphQL endpoint. Must use the hostname that matches the self-signed cert (CN=nas.owl.red) and resolve to 10.0.10.5 on the runner."
  type        = string
  default     = "https://nas.owl.red/graphql"
}

# --- system time / NTP (ROADMAP 16.1: single internal authority) ---
variable "use_ntp" {
  type    = bool
  default = true
}
variable "ntp_servers" {
  type    = list(string)
  default = ["10.0.10.1"]
}

# --- SSH ---
variable "ssh_enabled" {
  type    = bool
  default = true
}
variable "ssh_port" {
  type    = number
  default = 22
}

# --- server identity ---
variable "identity_name" {
  type    = string
  default = "nas"
}
variable "identity_comment" {
  type    = string
  default = ""
}
variable "identity_sysmodel" {
  type    = string
  default = "Rosewill RSV-L4500U"
}

# --- Unraid Connect / remote access (pinned OFF per ADR 012: no inbound exposure) ---
variable "connect_access_type" {
  description = "WAN_ACCESS_TYPE. Keep DISABLED — owl.red does not expose the NAS to the internet."
  type        = string
  default     = "DISABLED"
}

# --- UPS (NUT currently disabled / no UPS wired) ---
variable "ups_present" {
  description = "Set true only when a UPS is wired and NUT should be managed."
  type        = bool
  default     = false
}
variable "ups_service" {
  type    = string
  default = "DISABLE"
}
