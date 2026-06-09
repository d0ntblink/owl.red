variable "opnsense_endpoint" {
  description = "OPNsense base URL"
  type        = string
  default     = "https://10.0.10.1"
}

variable "opnsense_api_key" {
  description = "OPNsense API key (set via OPNSENSE_API_KEY env var or env.secret)"
  type        = string
  sensitive   = true
}

variable "opnsense_api_secret" {
  description = "OPNsense API secret (set via OPNSENSE_API_SECRET env var or env.secret)"
  type        = string
  sensitive   = true
}
