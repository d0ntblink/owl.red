Help on function set_port_config in module swos:

sseett__ppoorrtt__ccoonnffiigg(url, username, password, port_number, name=None, enabled=None, auto_negotiation=None)
    Set port/link configuration for a specific port

    Args:
        url: Switch URL
        username: Username
        password: Password
        port_number: Port number (1-based)
        name: Port name (optional)
        enabled: Port enabled state - True/False (optional)
        auto_negotiation: Auto-negotiation enabled - True/False (optional)

    Returns:
        Response text from POST request

    Raises:
        ValueError: If port number is invalid
        requests.HTTPError: If request fails
Help on function set_port_config in module swos:

sseett__ppoorrtt__ccoonnffiigg(url, username, password, port_number, name=None, enabled=None, auto_negotiation=None)
    Set port/link configuration for a specific port

    Args:
        url: Switch URL
        username: Username
        password: Password
        port_number: Port number (1-based)
        name: Port name (optional)
        enabled: Port enabled state - True/False (optional)
        auto_negotiation: Auto-negotiation enabled - True/False (optional)

    Returns:
        Response text from POST request

    Raises:
        ValueError: If port number is invalid
        requests.HTTPError: If request fails
