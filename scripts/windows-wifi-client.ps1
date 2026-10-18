$ErrorActionPreference = 'Stop'
trap {
    [Console]::Error.WriteLine('Private Wi-Fi client operation failed; credential and response values suppressed.')
    exit 1
}
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$adapter = Get-NetAdapter -Name 'Wi-Fi'
if ($adapter.MacAddress -ne '5C-87-9C-FA-10-F4') { throw 'Unexpected workstation adapter' }
if ($request.phase -notin @('connect', 'test')) { throw 'Unsupported client phase' }

if ($request.phase -eq 'connect') {
    if (-not $request.allowed -or -not $request.key -or $request.key.Length -lt 8 -or $request.key.Length -gt 63) {
        throw 'Approved private Wi-Fi key required'
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OwlWlan {
    [DllImport("wlanapi.dll")]
    public static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
    [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)]
    public static extern uint WlanSetProfile(IntPtr handle, ref Guid guid, uint flags, string xml, string security, bool overwrite, IntPtr reserved, out uint reason);
    [DllImport("wlanapi.dll")]
    public static extern uint WlanCloseHandle(IntPtr handle, IntPtr reserved);
}
'@
    $escaped = [Security.SecurityElement]::Escape([string]$request.key)
    $xml = @"
<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>owl.red</name>
  <SSIDConfig><SSID><name>owl.red</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType><connectionMode>auto</connectionMode>
  <MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
  <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>$escaped</keyMaterial></sharedKey></security></MSM>
  <MacRandomization xmlns="http://www.microsoft.com/networking/WLAN/profile/v3"><enableRandomization>false</enableRandomization></MacRandomization>
</WLANProfile>
"@
    $handle = [IntPtr]::Zero
    $version = [uint32]0
    $reason = [uint32]0
    $guid = [Guid]$adapter.InterfaceGuid
    if ([OwlWlan]::WlanOpenHandle(2, [IntPtr]::Zero, [ref]$version, [ref]$handle) -ne 0) { throw 'WLAN unavailable' }
    try {
        $result = [OwlWlan]::WlanSetProfile($handle, [ref]$guid, 2, $xml, $null, $false, [IntPtr]::Zero, [ref]$reason)
        if ($result -notin @(0, 183)) { throw 'Profile creation refused' }
    } finally {
        [void][OwlWlan]::WlanCloseHandle($handle, [IntPtr]::Zero)
    }
    $null = netsh wlan connect name=owl.red interface=Wi-Fi
    if ($LASTEXITCODE -ne 0) { throw 'Association request refused' }
    [pscustomobject]@{profile='owl.red';associationRequested=$true;keyWrittenToTemporaryFile=$false;routeMetricsChanged=$false;DNSOverridesChanged=$false} | ConvertTo-Json -Compress
    exit 0
}

$configuration = Get-NetIPConfiguration -InterfaceAlias 'Wi-Fi'
$address = @($configuration.IPv4Address | Where-Object {$_.IPAddress -eq '10.0.20.10' -and $_.PrefixLength -eq 24})
if ($adapter.Status -ne 'Up' -or $address.Count -ne 1) { throw 'Expected wireless lease is not ready' }
if ($configuration.IPv4DefaultGateway.NextHop -ne '10.0.20.1') { throw 'Unexpected DHCP gateway' }
if ('10.0.20.1' -notin @($configuration.DNSServer.ServerAddresses)) { throw 'Unexpected DHCP DNS' }
$association = netsh wlan show interfaces
if (-not ($association -match '^\s*SSID\s*:\s*owl\.red\s*$')) { throw 'Unexpected SSID' }

function Open-WirelessTcp([string]$Address, [int]$Port) {
    $client = [Net.Sockets.TcpClient]::new([Net.Sockets.AddressFamily]::InterNetwork)
    $client.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::IP, [Net.Sockets.SocketOptionName]31, [Net.IPAddress]::HostToNetworkOrder([int]$adapter.ifIndex))
    $client.Client.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse('10.0.20.10'), 0))
    $task = $client.ConnectAsync($Address, $Port)
    if (-not $task.Wait(5000)) { $client.Dispose(); throw 'Bound wireless TCP connection timed out' }
    return $client
}

$dns = @{}
foreach ($name in @('dns.owl.red', 'rancher.owl.red', 'ap.owl.red', 'example.com')) {
    $dns[$name] = @(Resolve-DnsName -Name $name -Type A -Server 10.0.20.1 -DnsOnly | Where-Object {$_.Type -eq 'A'} | Select-Object -ExpandProperty IPAddress)
}
if ('10.0.10.201' -notin $dns['dns.owl.red'] -or '10.0.10.201' -notin $dns['rancher.owl.red'] -or '10.0.10.40' -notin $dns['ap.owl.red']) { throw 'Internal DNS mismatch' }
$connection = Open-WirelessTcp $dns['example.com'][0] 443
try {
    $stream = [Net.Security.SslStream]::new($connection.GetStream(), $false)
    $stream.ReadTimeout = 8000
    $stream.WriteTimeout = 8000
    $stream.AuthenticateAsClient('example.com')
    $requestBytes = [Text.Encoding]::ASCII.GetBytes("GET / HTTP/1.1`r`nHost: example.com`r`nConnection: close`r`n`r`n")
    $stream.Write($requestBytes, 0, $requestBytes.Length)
    $reader = [IO.StreamReader]::new($stream)
    $status = $reader.ReadLine()
    if ($status -notmatch '^HTTP/1\.[01] 200') { throw 'Unexpected HTTPS response' }
} finally {
    $connection.Dispose()
}
[pscustomobject]@{success=$true;SSID='owl.red';client='10.0.20.10/24';gateway='10.0.20.1';DNS=$dns;verifiedHTTPSOverWiFi=$true;sourceInterfaceIndex=$adapter.ifIndex;routeMetricsChanged=$false;DNSOverridesChanged=$false;coverageWalkTested=$false;IPv6Tested=$false} | ConvertTo-Json -Depth 5 -Compress