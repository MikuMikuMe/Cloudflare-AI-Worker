/**
 * Shown at /admin while Cloudflare Access is not yet configured.
 *
 * Deliberately fail-closed: the dashboard stays unreachable and no keys can be
 * minted until ACCESS_TEAM_DOMAIN and ACCESS_AUD are set. This page only
 * explains how to finish the setup; it exposes no data.
 */

export function setupPage(host: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Finish setup — Cloudflare AI Worker</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:#0b0d12;color:#e6e9ef;line-height:1.65}
  .wrap{max-width:720px;margin:0 auto;padding:60px 24px}
  .badge{display:inline-block;background:#3a2a10;color:#f6821f;border:1px solid #5a3f14;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;margin-bottom:16px}
  h1{font-size:24px;letter-spacing:-.02em;margin-bottom:10px}
  p{color:#8b93a7;margin-bottom:18px}
  ol{margin:0 0 22px 20px;color:#c8cedb}
  li{margin-bottom:12px}
  code{font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;background:#141821;border:1px solid #252c3b;border-radius:5px;padding:2px 6px;font-size:12.5px;color:#5b8cff}
  pre{background:#080a0e;border:1px solid #252c3b;border-radius:10px;padding:15px;overflow-x:auto;font-size:12.5px;margin-bottom:18px}
  pre code{background:none;border:none;padding:0;color:#c8cedb}
  .note{background:#141821;border:1px solid #252c3b;border-left:3px solid #f6821f;border-radius:8px;padding:14px 16px;font-size:13.5px;color:#8b93a7}
</style>
</head><body><div class="wrap">
  <div class="badge">Setup required</div>
  <h1>Cloudflare Access isn't connected yet</h1>
  <p>The dashboard is locked until single sign-on is wired up. Nobody can sign in or create API keys until you finish these steps — that's intentional.</p>

  <ol>
    <li>Open <strong>Cloudflare Zero Trust</strong> and, if prompted, choose a team name. Review the plan shown before saving; this Worker does not create or require another compute/database service.</li>
    <li>Go to <strong>Access &rarr; Applications &rarr; Add an application &rarr; Self-hosted</strong>.</li>
    <li>Set the application domain to <code>${escapeHtml(host)}</code> with path <code>/admin*</code>.</li>
    <li>Add a policy: action <strong>Allow</strong>, rule <strong>Emails</strong> &rarr; your own address.</li>
    <li>Copy the <strong>Application Audience (AUD) tag</strong> from the app's overview page.</li>
    <li>Put the team domain and AUD into <code>wrangler.jsonc</code> and redeploy:</li>
  </ol>

  <pre><code>"vars": {
  "ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
  "ACCESS_AUD": "&lt;the AUD tag&gt;"
}</code></pre>

  <div class="note">The Worker verifies every Access JWT against your team's public keys, so the <code>/admin</code> area stays protected even on the <code>*.workers.dev</code> hostname where Access does not run.</div>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
