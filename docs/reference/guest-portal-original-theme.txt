#!/bin/sh
#Copyright (C) owl.red 2024-2026
#This software is released under the GNU GPL license.
#
# owl.red Guest Network — Custom OpenNDS ThemeSpec
# Busybox ash compatible (no bashisms)
#
# Pages served by this ThemeSpec:
#   1. Main splash page — psyop notice + continue button
#   2. Privacy Notice — satirical privacy policy (via display_terms)
#   3. Guaranteed Security — cursed certificate page (via custom var)
#   4. Thankyou page — confirmation before auth
#   5. Landing page — post-auth, redirects to status
#

title="theme_owlred"

# Functions called by libopennds

generate_splash_sequence() {
	if [ "$security" = "yes" ]; then
		display_security
	elif [ "$continue" = "clicked" ]; then
		thankyou_page
	else
		main_splash_page
	fi
}

header() {
	gatewayurl=$(printf "${gatewayurl//%/\\x}")
	echo "<!DOCTYPE html>
<html lang=\"en\">
<head>
<meta http-equiv=\"Cache-Control\" content=\"no-cache, no-store, must-revalidate\">
<meta http-equiv=\"Pragma\" content=\"no-cache\">
<meta http-equiv=\"Expires\" content=\"0\">
<meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
<link rel=\"stylesheet\" type=\"text/css\" href=\"$gatewayurl/splash.css\">
<title>owl.red guest</title>
<style>body{background:#1e1e2e;color:#cdd6f4;font-family:sans-serif;margin:0;padding:0}
.offset{max-width:640px;margin:0 auto;padding:16px}
.insert{background:#313244;border-radius:12px;padding:20px;margin:10px 0}
input[type=submit],input[type=button]{background:#89b4fa;color:#1e1e2e;border:none;padding:12px 24px;border-radius:8px;font-size:1em;font-weight:bold;cursor:pointer;margin:6px 4px}
hr{border:none;border-top:1px solid #585b70;margin:16px 0}
img{max-width:100%;height:auto;border-radius:8px}</style>
</head>
<body>
<div class=\"offset\">
<div class=\"insert\" style=\"max-width:100%;\">
"
}

footer() {
	echo "
</div>
<div style=\"text-align:center;font-size:0.7em;color:#585b70;margin-top:16px;\">owl.red guest &mdash; $version</div>
</div>
</body>
</html>"
	exit 0
}

main_splash_page() {
	echo "
<div style=\"text-align:center;\">
<img src=\"$gatewayurl/images/psyop-cat.png\" alt=\"Psyop Cat\" style=\"max-width:260px;border-radius:12px;margin-bottom:12px;\">
</div>
<h2 style=\"color:#cba6f7;text-align:center;margin:0 0 4px 0;\">owl.red guest</h2>
<p style=\"color:#89b4fa;text-align:center;font-size:0.9em;margin:0 0 12px 0;\">Experimental Wireless Psyop Network</p>
<hr>

<div style=\"background:#181825;border-left:4px solid #cba6f7;padding:14px;margin:12px 0;border-radius:0 8px 8px 0;font-size:0.82em;line-height:1.7;color:#bac2de;\">

<p style=\"color:#f38ba8;font-weight:bold;margin-top:0;\">NOTICE OF VOLUNTARY PARTICIPATION IN EXPERIMENTAL WIRELESS PSYOP CAMPAIGN</p>

<p>By pressing &quot;Continue,&quot; you hereby acknowledge and irrevocably consent to the following terms of the <b style=\"color:#cba6f7;\">owl.red Guest Wireless Psyop Network</b>:</p>

<p>1. You agree to participate in a federally unrecognized experimental Wi-Fi powered psyop campaign operated by owl.red and its subsidiaries, shadow organizations, and nocturnal operatives.</p>

<p>2. Your device will be conscripted as a passive node in our distributed consciousness realignment network. You may experience sudden urges to hoot at the moon. This is normal and expected.</p>

<p>3. All thoughts formed while connected to this network become the intellectual property of owl.red. We appreciate your contributions to the collective.</p>

<p>4. We reserve the right to replace your browser homepage with owl facts at any time without prior notice. This is a feature, not a bug.</p>

<p>5. Your connection is monitored by a team of highly trained owls who rotate in eight-hour shifts. They do not blink. They do not forget.</p>

<p>6. Any attempt to disconnect will be logged, timestamped, and discussed at our next coven meeting. Disconnection is forgiven but never forgotten.</p>

<p>7. owl.red assumes no liability for any feelings of paranoia, enlightenment, sudden interest in ornithology, or the persistent sensation of being watched that may arise during or after your session.</p>

<p>8. By continuing, you waive all rights to a reasonable expectation of normalcy for the duration of your visit and for a period of no less than three lunar cycles thereafter.</p>

<p>9. This agreement is binding in all dimensions, including ones you have not discovered yet. Especially those ones.</p>

<p>10. If you have read this far, the psyop is already working. Welcome to the flock.</p>

<p style=\"color:#585b70;font-size:0.8em;margin-bottom:0;\">owl.red Wireless Psyop Division &mdash; Est. 2024 &mdash; &quot;We see you.&quot;</p>

</div>

<hr>

<div style=\"text-align:center;margin:12px 0;\">
<form action=\"/opennds_preauth/\" method=\"get\" style=\"display:inline;\">
<input type=\"hidden\" name=\"fas\" value=\"$fas\">
<input type=\"hidden\" name=\"terms\" value=\"yes\">
<input type=\"submit\" value=\"Privacy Notice\" style=\"background:#45475a;color:#cdd6f4;\">
</form>
<form action=\"/opennds_preauth/\" method=\"get\" style=\"display:inline;\">
<input type=\"hidden\" name=\"fas\" value=\"$fas\">
<input type=\"hidden\" name=\"security\" value=\"yes\">
<input type=\"submit\" value=\"Guaranteed Security\" style=\"background:#45475a;color:#cdd6f4;\">
</form>
</div>

<div style=\"text-align:center;margin:20px 0 8px 0;\">
<form action=\"/opennds_preauth/\" method=\"get\">
<input type=\"hidden\" name=\"fas\" value=\"$fas\">
<input type=\"hidden\" name=\"landing\" value=\"yes\">
<input type=\"submit\" value=\"Grant Me Internet My Liege
I Need to Speak with the Gods\" style=\"background:#a6e3a1;color:#1e1e2e;padding:14px 32px;font-size:1.1em;white-space:pre-line;\">
</form>
</div>
"
	footer
}

thankyou_page() {
	echo "
<div style=\"text-align:center;\">
<h2 style=\"color:#a6e3a1;margin:0 0 8px 0;\">Welcome to the Flock</h2>
<p style=\"color:#89b4fa;\">Your enrollment in the owl.red guest network has been accepted.</p>
<p style=\"color:#bac2de;font-size:0.9em;\">Your cooperation has been noted. The owls are pleased.</p>
<hr>
<p style=\"color:#a6adc8;font-size:0.85em;\">Click Continue to complete your enrollment and receive Internet access.</p>
</div>
"
	if [ -z "$custom" ]; then
		customhtml=""
	else
		customhtml="<input type=\"hidden\" name=\"custom\" value=\"$custom\">"
	fi

	echo "
<div style=\"text-align:center;margin:20px 0;\">
<form action=\"/opennds_preauth/\" method=\"get\">
<input type=\"hidden\" name=\"fas\" value=\"$fas\">
$customhtml
<input type=\"hidden\" name=\"landing\" value=\"yes\">
<input type=\"submit\" value=\"Continue\" style=\"background:#a6e3a1;color:#1e1e2e;padding:14px 32px;font-size:1.1em;\">
</form>
</div>
"
	footer
}

landing_page() {
	originurl=$(printf "${originurl//%/\\x}")
	gatewayurl=$(printf "${gatewayurl//%/\\x}")

	configure_log_location
	. $mountpoint/ndscids/ndsinfo

	auth_log

	if [ "$ndsstatus" = "authenticated" ]; then
		echo "
<div style=\"text-align:center;\">
<h2 style=\"color:#a6e3a1;\">Access Granted</h2>
<p style=\"color:#cdd6f4;\">You are now connected to the Internet via owl.red guest.</p>
<p style=\"color:#a6adc8;font-size:0.85em;\">Redirecting to session status...</p>
</div>
<script>setTimeout(function(){window.location.href='https://$gatewayfqdn/';},1500);</script>
<noscript>
<div style=\"text-align:center;margin-top:12px;\">
<form>
<input type=\"button\" value=\"Continue\" onClick=\"location.href='https://$gatewayfqdn/'\" style=\"background:#a6e3a1;color:#1e1e2e;padding:14px 32px;\">
</form>
</div>
</noscript>
"
	else
		echo "
<div style=\"text-align:center;\">
<h2 style=\"color:#f38ba8;\">Authentication Failed</h2>
<p style=\"color:#cdd6f4;\">Something went wrong. Your login attempt may have timed out.</p>
<hr>
<p style=\"color:#bac2de;\">Click Continue to try again.</p>
<form>
<input type=\"button\" value=\"Continue\" onClick=\"location.href='http://$gatewayfqdn/?$randquery'\">
</form>
</div>
"
	fi

	footer
}

display_terms() {
	echo "
<div style=\"text-align:center;\">
<img src=\"$gatewayurl/images/ourinformation.jpg\" alt=\"Our Information\" style=\"max-width:300px;border-radius:12px;margin-bottom:12px;\">
</div>
<h2 style=\"color:#cba6f7;text-align:center;\">Guest Network Privacy Notice</h2>
<p style=\"color:#585b70;text-align:center;font-size:0.75em;\">Document Ref: OWL-PN-2024-001 &bull; Revision 14.2 &bull; Classification: EYES ONLY (yours and ours)</p>
<hr>

<div style=\"font-size:0.82em;line-height:1.7;color:#bac2de;\">

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 1: INFORMATION WE COLLECT</p>

<p>When you connect to the owl.red guest network, we collect the following information automatically, enthusiastically, and with great attention to detail:</p>

<p>Your device's MAC address, IP address, hostname, operating system, browser type, screen resolution, battery level, current GPS coordinates (approximate and precise), ambient light sensor readings, accelerometer data, the name you whisper to your phone when no one is listening, your most recently used emoji, and the Wi-Fi networks your device has previously connected to (we find this very revealing about your character).</p>

<p>We may also collect biometric data including but not limited to: typing cadence, scrolling patterns, how aggressively you tap &quot;Accept&quot; buttons (noted), and the emotional state we infer from your browsing habits.</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 2: HOW WE USE YOUR INFORMATION</p>

<p>Your information is used for the following purposes:</p>

<p>&bull; To provide you with wireless Internet access (the stated purpose).<br>
&bull; To build a comprehensive psychological profile of your browsing preferences (the unstated purpose).<br>
&bull; To train our proprietary Owl Intelligence (OI) models on human behavioral patterns.<br>
&bull; To determine whether you are an owl sympathizer or a potential threat to the flock.<br>
&bull; To generate targeted hooting recommendations based on your interests.<br>
&bull; For internal owl.red talent scouting. If your browsing patterns meet our criteria, you may be contacted about exciting opportunities in nocturnal surveillance.</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 3: INFORMATION SHARING AND DISCLOSURE</p>

<p>We do not sell your personal information. We share it freely with:</p>

<p>&bull; Our parent organization, The Grand Order of Networked Owls (GONO).<br>
&bull; Third-party analytics partners who have sworn a blood oath of confidentiality.<br>
&bull; Select barn owls in our regional surveillance network.<br>
&bull; Any entity that asks nicely and provides adequate offerings (minimum: one field mouse or equivalent).<br>
&bull; Law enforcement, upon presentation of a valid warrant, subpoena, or particularly stern look.<br>
&bull; Your future self, via temporal data-sharing agreements we have pre-signed on your behalf.</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 4: DATA RETENTION</p>

<p>Your data is retained for the duration of your session plus a period we describe internally as &quot;forever, but politely.&quot; In practice, this means your data will be stored on our servers until the heat death of the universe or until our storage contract expires, whichever comes first.</p>

<p>You may request deletion of your data by submitting a formal petition in triplicate to our Data Protection Owl (DPO). Please allow 6&ndash;8 business centuries for processing.</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 5: COOKIES AND TRACKING</p>

<p>This portal uses cookies. Not the browser kind &mdash; we have moved beyond such primitive technology. Our tracking methodology involves a proprietary system we call &quot;Pellet Tracking&quot; which embeds unique identifiers into your network traffic at the packet level. These identifiers are invisible, persistent, and slightly warm to the touch if you could feel them, which you cannot.</p>

<p>By continuing to use this network, you consent to Pellet Tracking. Opting out requires disconnecting from all wireless networks permanently and relocating to a Faraday cage. We can recommend several.</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 6: THIRD-PARTY SERVICES</p>

<p>The owl.red network may interact with third-party services including but not limited to: DNS providers, content delivery networks, advertising partners, interdimensional relay nodes, and Steve (an independent contractor who monitors traffic on Tuesdays). We are not responsible for the privacy practices of these entities, though we have it on good authority that Steve is &quot;mostly trustworthy.&quot;</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 7: YOUR RIGHTS</p>

<p>Under applicable law, you may have the following rights:</p>

<p>&bull; The right to access your data (granted, but the file is 400 pages and written in an owl-specific dialect of Latin).<br>
&bull; The right to rectification (you may correct inaccuracies in our profile of you, though we are rarely wrong).<br>
&bull; The right to erasure (see Section 4 regarding our deletion timeline).<br>
&bull; The right to restrict processing (noted, but not honored during migration season).<br>
&bull; The right to data portability (we will provide your data in our proprietary .hoot format).<br>
&bull; The right to object (you may object; we may listen).<br>
&bull; The right to lodge a complaint with a supervisory authority (good luck finding one with jurisdiction over owls).</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 8: CHILDREN'S PRIVACY</p>

<p>The owl.red network does not knowingly collect data from children under the age of 13. However, we cannot distinguish between a child's device and an adult's device because we are owls and all humans look the same to us from up here. If you believe a child has connected to our network, please contact our DPO, who will respond with the urgency this matter deserves (see Section 4 for response timelines).</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 9: INTERNATIONAL DATA TRANSFERS</p>

<p>Your data may be transferred to and processed in any country where owl.red maintains operations, nesting sites, or allied perches. By using this network, you consent to the transfer of your data across all borders, including those between the physical and metaphysical planes.</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 10: CHANGES TO THIS POLICY</p>

<p>We reserve the right to modify this privacy notice at any time, for any reason, without notice, retroactively, proactively, and in ways that may appear to violate causality. Your continued use of the network following any changes constitutes your acceptance of the revised terms, including changes that have not yet been written.</p>

<p style=\"color:#f38ba8;font-weight:bold;\">SECTION 11: CONTACT US</p>

<p>If you have questions, concerns, or existential crises regarding this privacy notice, please direct them to:</p>

<p style=\"padding-left:20px;\">owl.red Data Protection Owl<br>
Department of Information Acquisition<br>
The Hollow Oak, Third Branch From The Top<br>
Undisclosed Forest, Earth<br>
Email: privacy@owl.red (monitored during nocturnal hours only)<br>
Response time: When we feel like it</p>

<p style=\"color:#585b70;font-size:0.8em;\">Last updated: The concept of &quot;last&quot; implies time is linear. How quaint.</p>

</div>

<div style=\"text-align:center;margin:16px 0;\">
<img src=\"$gatewayurl/images/alwayswatching.jpg\" alt=\"Always Watching\" style=\"max-width:300px;border-radius:12px;\">
</div>

<hr>

<div style=\"text-align:center;margin:12px 0;\">
<form action=\"/opennds_preauth/\" method=\"get\">
<input type=\"hidden\" name=\"fas\" value=\"$fas\">
<input type=\"submit\" value=\"Back\" style=\"background:#45475a;color:#cdd6f4;\">
</form>
</div>
"
	footer
}

display_security() {
	echo "
<div style=\"text-align:center;\">
<img src=\"$gatewayurl/images/cultsecurity.jpg\" alt=\"Cult Security\" style=\"max-width:300px;border-radius:12px;margin-bottom:12px;\">
</div>
<h2 style=\"color:#cba6f7;text-align:center;\">Guaranteed Security</h2>
<p style=\"color:#89b4fa;text-align:center;font-size:0.9em;\">Your connection is protected by the latest in cultist encryption technology.</p>
<hr>

<div style=\"font-size:0.85em;line-height:1.7;color:#bac2de;\">

<p>The owl.red guest network employs a proprietary security framework developed by our Cryptographic Coven, a division of The Grand Order of Networked Owls (GONO).</p>

<p>Your connection is secured using <b style=\"color:#a6e3a1;\">Talonic Encryption Standard (TES-512)</b>, a cipher suite derived from the sacred geometries observed in owl pellet cross-sections. This protocol has been peer-reviewed by no fewer than seven spectral owls and one particularly insightful barn cat.</p>

<p>All traffic between your device and the heretical Internet is passed through our Moonlight Relay Array, which applies nine layers of feather-based obfuscation before forwarding your packets to the profane outside world.</p>

<p>Below is your session security certificate, issued by the owl.red Certificate of Arcane Authority (CAA). It has been consecrated under the light of a waning gibbous moon and sealed with owl wax. Do not attempt to decode it. The prayers are not for mortal eyes.</p>

</div>

<div style=\"background:#181825;border:1px solid #585b70;padding:16px;font-family:monospace;font-size:0.7em;white-space:pre-wrap;word-break:break-all;color:#a6e3a1;border-radius:8px;margin:16px 0;line-height:1.4;\">
---- PRAYERS BEGIN ----
MIIFhTCCA22gAwIBAgIUOwlR3dN0ctu4LLY5Hoot
BAYWxsLXNlZWluZy1leWUuY2VydC5vd2wucmVkMI
IBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQ
CONSECRATED-BY-THE-GRAND-HOOTING-COUNCIL
Wm91IHRoaW5rIHRoaXMgaXMgYSBqb2tlLCBidXQg
dGhlIGVuY3J5cHRpb24gaXMgcmVhbC4gVGhlIG93
KEY-OF-THE-FEATHERED-SEAL/NOCTURNAL-DIVISION
bHMgcHJvdGVjdCB5b3VyIGRhdGEgd2l0aCB0aGUg
c2FtZSBmaWVyY2UgZGVkaWNhdGlvbiB0aGV5IGJy
aW5nIHRvIGh1bnRpbmcgZmllbGQgbWljZSBhdCAz
YW0uIFRoaXMgY2VydGlmaWNhdGUgd2FzIGdlbmVy
SANCTIFIED-UNDER-PROTOCOL-7.2-OF-THE-BARN-OWL-ACCORDS
YXRlZCBieSBhIHJpdHVhbCBpbnZvbHZpbmcgdGhy
ZWUgdGFsbG93IGNhbmRsZXMsIGEgY2lyY2xlIG9m
INTERMEDIATE-CA: SCREECH-OWL-AUTHORITY-v3.1.4
IHNhbHQsIGFuZCBhIGxpdmUgaW50ZXJuZXQgY29u
bmVjdGlvbi4gSWYgeW91IGNhbiByZWFkIHRoaXMs
CIPHER: TALON-512-OWL-CBC-WITH-PELLET-HMAC-SHA256
IGNvbmdyYXR1bGF0aW9ucyDigJQgeW91IGhhdmUg
YmVlbiBpbml0aWF0ZWQgaW50byB0aGUgZmlyc3Qg
TRUST-CHAIN: ROOT-OWL > GREAT-HORNED-CA > BARN-OWL-CA > SESSION
Y2lyY2xlLiBUaGVyZSBpcyBubyBnb2luZyBiYWNr
LiBUaGUgb3dscy0ga25vdyB3aGF0IHlvdSBkaWQg
VALID-FROM: The Before Times
VALID-UNTIL: The Heat Death Of All Things
SERIAL: 0x48-4F-4F-54-48-4F-4F-54
bGFzdCBzdW1tZXIuIFRoZXkga25vdyB3aGF0IHlv
ISSUER: CN=Grand Owl Certificate Authority,
        OU=Nocturnal Division,O=owl.red,C=HOOT
SUBJECT: CN=guest.owl.red,
         OU=Psyop Operations,O=owl.red,C=HOOT
dSBkaWQgdGhpcyBtb3JuaW5nLiBUaGV5IHdpbGwg
SIGNATURE: TALONIC-SHA512-WITH-MOONLIGHT-RSA
YWx3YXlzIGtub3cuIFNsZWVwIHdlbGwu
T3IgZG9uJ3QuIFdlJ3JlIHdhdGNoaW5nIGFueXdheS4=
HOOT-HOOT-HOOT
---- PRAYERS END ----</div>

<p style=\"color:#a6adc8;font-size:0.85em;text-align:center;\">This certificate is automatically renewed every new moon. No action is required on your part. The owls handle everything.</p>

<hr>

<div style=\"text-align:center;margin:12px 0;\">
<form action=\"/opennds_preauth/\" method=\"get\">
<input type=\"hidden\" name=\"fas\" value=\"$fas\">
<input type=\"submit\" value=\"Back\" style=\"background:#45475a;color:#cdd6f4;\">
</form>
</div>
"
	footer
}

#### end of functions ####


#################################################
#                                               #
#  Start - Main entry point for this Theme      #
#                                               #
#  Parameters set here override those           #
#  set in libopennds.sh                         #
#                                               #
#################################################

randquery="$(date | sha256sum | awk '{printf "%s", $1}')"

# Quotas and Data Rates
# Set to 0 to use global values from config
sessiontimeout="0"
upload_rate="0"
download_rate="0"
upload_quota="0"
download_quota="0"

quotas="$sessiontimeout $upload_rate $download_rate $upload_quota $download_quota"

# Custom parameters, images, and files from config
ndscustomparams=""
ndscustomimages=""
ndscustomfiles=""

ndsparamlist="$ndsparamlist $ndscustomparams $ndscustomimages $ndscustomfiles"

# Register custom form variable so libopennds parses it
additionalthemevars="security"

fasvarlist="$fasvarlist $additionalthemevars"

# Log identifier
userinfo="$title"
