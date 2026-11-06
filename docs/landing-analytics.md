# Landing analytics

`/specialists` events: `master_landing_view`, `create_profile_click`
(`placement=hero|bottom`), `find_in_catalog_click` (`catalog`),
`login_click` (`login`), `master_landing_exit`.

`analytics_events.metadata.utm` contains source/medium/campaign/content.
The existing `source` column remains available for existing reports.
Explicit UTM tags replace previous attribution in sessionStorage; untagged
navigation retains it. Registration links also contain UTM parameters, so
opening them in another tab works. Specialist registration persists attribution
in `users.acquisition` and Supabase Auth app_metadata.acquisition.

Exit snapshots contain a visitId, cumulative **visible-tab** activeSeconds and
maximum scrollDepth bucket (0/25/50/75/100). Hidden tabs, pagehide and SPA unmount
flush with keepalive fetch; duplicate signals without resuming are suppressed.
For reports group snapshots by visitId and use MAX(activeSeconds) and
MAX(scrollDepth), never SUM. The visible bottom edge determines depth.
Browsers can terminate processes without sending any exit event; no web tracker
can guarantee exit delivery in that case.

Clarity: configure public build variable VITE_CLARITY_PROJECT_ID and rebuild.
Without an ID no script is loaded. Only /specialists and /create-profile load it.
Registration DOM is explicitly masked. Leaving these routes after loading the
script uses a full reload before rendering other pages, preventing Clarity from
following SPA navigation into private screens.

Startup adds nullable analytics_events.metadata and users.acquisition separately
from legacy migrations. No data is deleted. These columns must exist before
deploying the new application; startup ensures this on the external database.
