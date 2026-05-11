Notes:
- `ap.owl.red` uplink is on `BLUE-C` (`SW19 <-> PP19`) because it is a tagged trunk, not an access/endpoint purple patch.
- Additional purple ports stay unpatched until a real endpoint is added.


### Cable and DAC Shopping List

Clean-cabling rule for front view:
- Keep all panel-to-switch jumpers same length and same bend direction.
- Route `BLUE` links as a separate bundle from `PURPLE` links.
- Route `AQUA` DAC links on a separate path with wide bend radius; do not mix in tight copper bundles.
- Keep `SW17-SW19` visually isolated as infrastructure ports near the router side.
- Do not pre-patch unused ports. Patch only active endpoints.

Recommended cable types:
- Slim CAT6 or CAT6A patch cables for front patching density.
- Stranded patch cables for all short rack jumpers.
- Passive SFP+ DAC cables for short 10G links between nearby devices.

#### Copper Patch Cables (RJ45)

| Length | Color | Qty | Use |
|--------|-------|-----|-----|
| `0.5 ft` | `BLUE` | `4` | Active trunk links + one spare (`SW17`, `SW19`, optional `SW18`) |
| `1 ft` | `BLUE` | `2` | Bend-relief/trunk re-route spare |
| `0.5 ft` | `PURPLE` | `8` | Current active purple links (`PURPLE-01` to `PURPLE-08`) |
| `1 ft` | `PURPLE` | `4` | Overflow if any port alignment needs extra slack |
| `3 ft` | `BLUE` | `2` | Maintenance/test bypass |
| `3 ft` | `PURPLE` | `2` | Temporary move/add/change work |

Optional expansion (if activating PP25-PP48 later):
- Add `20x` additional `0.5 ft PURPLE` cables (beyond the 8 above) for full staged endpoint activation.

#### DAC Cables (SFP+ Direct Attach Copper)

| Length | Type | Qty | Use |
|--------|------|-----|-----|
| `0.5 m` | `SFP+ passive DAC` | `2` | Primary 10G links (`SFP+1` trunk + `SFP+2` storage/uplink) |
| `1.0 m` | `SFP+ passive DAC` | `1` | Spare for reroute or replacement |

DAC install method:
- Run DAC directly through keystone openings using your 3D-printed cable holder.
- Do not terminate DAC to patch panel jacks.
- No fiber patch panel path is used for these links.

#### Cabling Accessories

| Item | Qty | Use |
|------|-----|-----|
| `Velcro ties (reusable)` | `1 pack (50+)` | Bundle separation by color (`BLUE/PURPLE/AQUA`) |
| `1U horizontal cable manager` | `1-2` | Front cable sweep and strain relief |
| `Port labels` | `1 sheet/roll` | Mark active vs reserved ports |
| `3D-printed keystone DAC holder` | `as needed` | Front pass-through support for DAC bend protection |

Minimum buy recommendation:
- Buy at least `20%` extra over planned quantity for spares and failed crimps.
