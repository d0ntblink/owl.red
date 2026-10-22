<?php

function owl_escape($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function owl_link($parameters) {
    $parameters['fas'] = $GLOBALS['fas'] ?? '';
    return '/index.php?' . http_build_query($parameters, '', '&', PHP_QUERY_RFC3986);
}

function splash_header() {
    header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');
    echo <<<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>owl.red guest</title>
<style>
:root{color-scheme:dark;--paper:#161918;--ink:#f2f5ed;--muted:#a8b1aa;--line:#3c4640;--signal:#c9f45d;--link:#86d7dc}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Georgia,"Times New Roman",serif;letter-spacing:0}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.11;background-image:repeating-linear-gradient(0deg,transparent,transparent 3px,#829486 4px)}
.portal{position:relative;max-width:680px;margin:auto;padding:24px 24px 36px}.masthead{display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:16px}
.stamp,.eyebrow,.meta,footer,summary,button,label,nav{font-family:"Courier New",monospace}.stamp{font-size:12px;color:var(--signal)}.network{font-size:12px;text-align:right;color:var(--muted)}
h1{font-size:32px;line-height:1.1;margin:27px 0 9px}h2{font-size:25px;line-height:1.2;margin:0 0 18px}h3{font-size:19px}.eyebrow{font-size:11px;text-transform:uppercase;color:var(--signal);margin:0 0 15px}.intro{font-size:20px;line-height:1.35;margin:0 0 24px}
.transmission{display:grid;grid-template-columns:128px minmax(0,1fr);gap:20px;align-items:center;border-block:1px solid var(--line);padding:20px 0;margin:24px 0}.transmission img{display:block;width:128px;height:128px;object-fit:contain;image-rendering:auto}.transmission p{margin:0}.meta{font-size:11px;color:var(--muted);margin-top:10px!important}
details{border-bottom:1px solid var(--line);padding:14px 0}summary{cursor:pointer;font-size:13px;color:var(--link)}.clauses{font-size:14px;color:#c5cec7;padding-left:22px}.clauses li{padding:8px 0 8px 3px}.consent{margin:25px 0 15px;display:flex;align-items:flex-start;gap:12px;font-size:13px}input[type=checkbox]{width:19px;height:19px;flex:none;margin:2px 0 0;accent-color:var(--signal)}
button,.button{display:block;width:100%;border:1px solid var(--signal);border-radius:3px;background:var(--signal);color:#17200b;padding:17px 16px;font-size:16px;line-height:1.35;font-weight:bold;text-align:center;text-decoration:none;cursor:pointer;white-space:normal;overflow-wrap:anywhere}button small{display:block;font-size:11px;font-weight:normal;margin-top:4px}button:hover,.button:hover{background:#d8ff83}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--link);outline-offset:4px}
nav{display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;margin-top:22px;font-size:12px}a{color:var(--link)}footer{border-top:1px solid var(--line);margin-top:32px;padding-top:14px;display:flex;justify-content:space-between;gap:16px;font-size:10px;color:var(--muted)}.status{padding:24px 0;border-block:1px solid var(--line);margin:24px 0}.status strong{color:var(--signal)}.quiet{color:var(--muted);font-size:13px}
@media(max-width:420px){.portal{padding:18px 18px 28px}.transmission{grid-template-columns:88px minmax(0,1fr);gap:14px}.transmission img{width:88px;height:88px}.intro{font-size:18px}footer{flex-wrap:wrap}}
@media(prefers-reduced-motion:no-preference){main{animation:arrive .35s ease-out}@keyframes arrive{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}}
</style>
</head>
<body><div class="portal">
<header class="masthead"><span class="stamp">OWL.RED / GUEST DIVISION</span><span class="network">silence of the lans</span></header>
<main>
HTML;
}

function login_page() {
    echo <<<'HTML'
<h1>owl.red guest</h1>
<p class="eyebrow">Experimental Wireless Psyop Network</p>
<p class="intro">A small offering of bandwidth.<br>A voluntary enrollment in the flock.</p>
<div class="transmission">
<img src="/psyop-cat.png" alt="The guest network's appointed observer" width="128" height="128">
<div><p>By connecting, you acknowledge that you are entering an experimental wireless psyop network.</p><p class="meta">VOLUNTARY PARTICIPATION NOTICE / EST. 2024</p></div>
</div>
<details><summary>Network Notice</summary>
<ol class="clauses">
<li>Your device will be conscripted as a passive node in our distributed consciousness realignment network. You may experience sudden urges to hoot at the moon. This is normal and expected.</li>
<li>All thoughts formed while connected to this network become the intellectual property of owl.red. We appreciate your contributions to the collective.</li>
<li>We reserve the right to replace your browser homepage with owl facts at any time without prior notice. This is a feature, not a bug.</li>
<li>Your connection is monitored by a team of highly trained owls who rotate in eight-hour shifts. They do not blink. They do not forget.</li>
<li>Any attempt to disconnect will be logged, timestamped, and discussed at our next coven meeting. Disconnection is forgiven but never forgotten.</li>
<li>owl.red assumes no liability for feelings of paranoia, enlightenment, sudden interest in ornithology, or the persistent sensation of being watched.</li>
<li>By continuing, you waive all rights to a reasonable expectation of normalcy for three lunar cycles.</li>
<li>This agreement is binding in all dimensions, including ones you have not discovered yet. Especially those ones.</li>
<li>If you have read this far, the psyop is already working. Welcome to the flock.</li>
</ol>
<p class="quiet">The notice above is satire. The actual connection and privacy terms are below.</p>
</details>
<form action="/index.php" method="get">
HTML;
    echo '<input type="hidden" name="fas" value="' . owl_escape($GLOBALS['fas'] ?? '') . '">';
    echo <<<'HTML'
<input type="hidden" name="auth" value="yes">
<label class="consent"><input type="checkbox" name="consent" value="yes" required><span>I accept the guest connection terms and understand that this is a shared, experimental network.</span></label>
<button type="submit">Grant Me Internet, My Liege<small>I Need to Speak with the Gods</small></button>
</form>
HTML;
    echo '<nav><a href="' . owl_escape(owl_link(['terms' => 'yes'])) . '">Privacy &amp; Connection Terms</a><a href="' . owl_escape(owl_link(['security' => 'yes'])) . '">Guaranteed Security*</a></nav>';
}

function display_terms() {
    echo <<<'HTML'
<h1>Privacy &amp; Connection Terms</h1>
<p class="eyebrow">The non-satirical part</p>
<p>This is shared guest internet access, provided without an availability or security guarantee. Use it lawfully and respect other devices and users.</p>
<h3>Connection Data</h3>
<p>The gateway and DHCP service need your device's network address, randomized or hardware MAC address, lease expiry and session timing to provide access. The portal does not request your name or email address.</p>
<h3>A Shared Network</h3>
<p>Use HTTPS and keep your device updated. Do not treat the guest network as a trusted environment. The portal does not install certificates, inspect encrypted web content or promise anonymity.</p>
<h3>Temporary Access</h3>
<p>Sessions expire. Access may be interrupted or withdrawn, including when the gateway or its lease synchronization is unavailable. Reconnecting may require accepting the terms again.</p>
HTML;
    echo '<nav><a href="' . owl_escape(owl_link([])) . '">Return to the Guest Network</a></nav>';
}

function owl_security_page() {
    echo <<<'HTML'
<h1>Guaranteed Security*</h1>
<p class="eyebrow">*No such guarantee exists</p>
<div class="status"><strong>Certified by the owl.red Department of Looking Very Serious.</strong></div>
<p>Our highly trained observers have reviewed the situation and declined to make any promises.</p>
<p class="quiet">The joke ends here: this is a shared guest network. Keep HTTPS enabled, keep your device updated, and never install a certificate just to use Wi-Fi.</p>
HTML;
    echo '<nav><a href="' . owl_escape(owl_link([])) . '">Return to the Guest Network</a></nav>';
}

function landing_page() {
    echo '<h1>Access Granted</h1><p class="eyebrow">Welcome to the Flock</p><div class="status"><strong>Your cooperation has been noted.</strong><p>You are connected through owl.red guest.</p></div><p>You may close this window.</p>';
}

function status_page() {
    echo '<h1>owl.red guest</h1><p class="eyebrow">Session Status</p><p>Your device has returned to the guest portal.</p><p class="quiet">Access is managed by the network gateway. An expired session requires accepting the connection terms again.</p>';
    echo '<nav><a href="' . owl_escape(owl_link([])) . '">Guest Network</a></nav>';
}

function footer() {
    echo '</main><footer><span>owl.red Wireless Psyop Division</span><span>WE SEE YOU.</span></footer></div></body></html>';
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    splash_header();
    login_page();
    footer();
}