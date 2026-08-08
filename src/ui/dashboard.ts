/** Authenticated dashboard: key management, streaming playground, usage. */

const STYLES = `
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0b0d12;--panel:#141821;--panel2:#1b2130;--line:#252c3b;--fg:#e6e9ef;--muted:#8b93a7;--accent:#f6821f;--accent2:#5b8cff;--ok:#3fb950;--bad:#f85149}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh}
  .top{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 22px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:11px}
  .logo{width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,var(--accent),#ffb457);display:grid;place-items:center;font-weight:800;color:#231400;font-size:13px}
  .brand h1{font-size:15px;font-weight:650}
  .brand .sub{font-size:11.5px;color:var(--muted)}
  .who{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted)}
  .who b{color:var(--fg);font-weight:600}
  a.plain{color:var(--muted);text-decoration:none;font-size:12.5px;border:1px solid var(--line);padding:6px 11px;border-radius:7px}
  a.plain:hover{color:var(--fg);border-color:#3a4358}
  .tabs{display:flex;gap:4px;padding:0 22px;background:var(--panel);border-bottom:1px solid var(--line)}
  .tab{padding:11px 16px;font-size:13.5px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;user-select:none}
  .tab:hover{color:var(--fg)}
  .tab.on{color:var(--fg);border-bottom-color:var(--accent)}
  main{max-width:1060px;margin:0 auto;padding:26px 22px 70px}
  .pane{display:none}.pane.on{display:block}
  .row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  h2{font-size:17px;font-weight:650;letter-spacing:-.01em}
  .hint{font-size:12.5px;color:var(--muted);margin-top:3px}
  .btn{padding:9px 15px;border-radius:8px;background:var(--accent);color:#231400;font-weight:650;font-size:13px;border:none;cursor:pointer}
  .btn:hover{filter:brightness(1.08)}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
  .btn.ghost:hover{color:var(--fg)}
  .btn.danger{background:transparent;color:var(--bad);border:1px solid #40232a;padding:5px 10px;font-size:12px}
  .btn.danger:hover{background:#2a1418}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line)}
  tr:last-child td{border-bottom:none}
  th{color:var(--muted);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;background:var(--panel2)}
  code{font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace}
  .mono{font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
  .pill.ok{background:#0f2a17;color:var(--ok)}
  .pill.off{background:#2a1418;color:var(--bad)}
  .empty{padding:40px 20px;text-align:center;color:var(--muted);font-size:13.5px}
  .reveal{background:#12240f;border:1px solid #1f4a1a;border-radius:11px;padding:16px;margin-bottom:16px}
  .reveal h3{font-size:13.5px;color:var(--ok);margin-bottom:7px}
  .reveal p{font-size:12.5px;color:var(--muted);margin-bottom:11px}
  .keybox{display:flex;gap:8px;align-items:center}
  .keybox input{flex:1;background:#070a06;border:1px solid #1f4a1a;border-radius:8px;padding:11px;color:#b6f0a8;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:12.5px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:15px}
  .stat .n{font-size:23px;font-weight:700;letter-spacing:-.02em}
  .stat .l{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:3px}
  select,input[type=text],textarea{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 11px;color:var(--fg);font-size:13.5px;font-family:inherit}
  select:focus,input:focus,textarea:focus{outline:none;border-color:var(--accent2)}
  .chat{background:var(--panel);border:1px solid var(--line);border-radius:12px;height:400px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:11px;margin-bottom:12px}
  .msg{max-width:82%;padding:10px 14px;border-radius:11px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word}
  .msg.user{align-self:flex-end;background:#26365e;color:#e8eeff}
  .msg.assistant{align-self:flex-start;background:var(--panel2);border:1px solid var(--line)}
  .composer{display:flex;gap:9px}
  .composer textarea{flex:1;resize:none;max-height:110px}
  .bars{display:flex;align-items:flex-end;gap:3px;height:110px;padding:14px;background:var(--panel);border:1px solid var(--line);border-radius:11px}
  .bar{flex:1;background:linear-gradient(180deg,var(--accent),#a2521200);border-radius:3px 3px 0 0;min-height:2px}
  .cf-usage{background:linear-gradient(135deg,#151c2a,#141821);border:1px solid #30405c;border-radius:12px;padding:17px 19px;margin-bottom:20px}
  .cf-usage-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
  .cf-usage-title{font-size:13px;font-weight:650;color:var(--fg)}
  .cf-usage-sub{font-size:12px;color:var(--muted);margin-top:4px}
  .cf-usage-value{font-size:26px;font-weight:750;letter-spacing:-.03em;color:#dce7ff;text-align:right}
  .cf-usage-value small{font-size:13px;font-weight:500;color:var(--muted);letter-spacing:0}
  .cf-meter{height:7px;background:#20293a;border-radius:99px;overflow:hidden;margin-top:15px}
  .cf-meter span{display:block;height:100%;background:linear-gradient(90deg,var(--accent2),#8caaff);border-radius:99px;min-width:0;transition:width .25s}
  .cf-usage-note{font-size:12px;color:var(--muted);margin-top:9px;line-height:1.5}
  .cf-usage.error{border-color:#55313b}
  .cf-usage.error .cf-usage-value{font-size:16px;color:#ffb5b0;letter-spacing:0}
  .cf-usage.setup{border-color:#5a482a}
  .cf-usage.setup .cf-usage-value{font-size:16px;color:#ffd28c;letter-spacing:0}
  .toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:11px 18px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s}
  .toast.show{opacity:1}
`;

export function dashboardPage(email: string, teamDomain: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — Cloudflare AI Worker</title>
<style>${STYLES}</style>
</head><body>

<div class="top">
  <div class="brand">
    <div class="logo">AI</div>
    <div><h1>Cloudflare AI Worker</h1><div class="sub">OpenAI-compatible gateway</div></div>
  </div>
  <div class="who">
    <span>Signed in as <b>${escapeHtml(email)}</b></span>
    <a class="plain" href="https://${escapeHtml(teamDomain)}/cdn-cgi/access/logout">Sign out</a>
  </div>
</div>

<div class="tabs">
  <div class="tab on" data-pane="keys">API Keys</div>
  <div class="tab" data-pane="play">Playground</div>
  <div class="tab" data-pane="usage">Usage</div>
</div>

<main>
  <section class="pane on" id="pane-keys">
    <div class="row">
      <div><h2>API Keys</h2><div class="hint">Use these as the <code>Authorization: Bearer</code> value with any OpenAI SDK.</div></div>
      <button class="btn" id="new-key">+ Create key</button>
    </div>
    <div id="reveal-slot"></div>
    <div class="panel"><div id="keys-body"><div class="empty">Loading…</div></div></div>
  </section>

  <section class="pane" id="pane-play">
    <div class="row">
      <div><h2>Playground</h2><div class="hint">Streams through <code>/v1/chat/completions</code> using your Access session — no key needed here.</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="model"></select>
        <button class="btn ghost" id="clear">Clear</button>
      </div>
    </div>
    <div class="chat" id="chat"></div>
    <div class="composer">
      <textarea id="prompt" rows="1" placeholder="Ask something… (Enter to send, Shift+Enter for newline)"></textarea>
      <button class="btn" id="send">Send</button>
    </div>
  </section>

  <section class="pane" id="pane-usage">
    <div class="row"><div><h2>Usage</h2><div class="hint">Gateway usage for your keys, plus live Workers AI consumption from Cloudflare.</div></div><button class="btn ghost" id="refresh-usage">Refresh</button></div>
    <div class="cf-usage" id="cloudflare-usage"><div class="cf-usage-head"><div><div class="cf-usage-title">Cloudflare Workers AI</div><div class="cf-usage-sub">Neurons used today</div></div><div class="cf-usage-value">Loading...</div></div></div>
    <div class="stats" id="stats"></div>
    <div style="margin-bottom:8px;font-size:12.5px;color:var(--muted)">Daily requests</div>
    <div class="bars" id="bars"></div>
    <div style="margin:20px 0 8px;font-size:12.5px;color:var(--muted)">By model</div>
    <div class="panel"><div id="models-body"><div class="empty">Loading…</div></div></div>
  </section>
</main>

<div class="toast" id="toast"></div>

<script>
var $ = function(s){ return document.querySelector(s); };
var toastTimer = null;
function toast(msg){
  var t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
}
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function fmtDate(ms){ return ms ? new Date(ms).toLocaleString() : '—'; }
function fmtNum(n){ return (n || 0).toLocaleString(); }

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach(function(tab){
  tab.onclick = function(){
    document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('on'); });
    document.querySelectorAll('.pane').forEach(function(p){ p.classList.remove('on'); });
    tab.classList.add('on');
    $('#pane-' + tab.dataset.pane).classList.add('on');
    if (tab.dataset.pane === 'usage') loadUsage();
  };
});

/* ---------- keys ---------- */
function renderKeys(keys){
  if (!keys.length){
    $('#keys-body').innerHTML = '<div class="empty">No keys yet. Create one to start calling the API.</div>';
    return;
  }
  var rows = keys.map(function(k){
    var status = k.revoked_at
      ? '<span class="pill off">revoked</span>'
      : '<span class="pill ok">active</span>';
    var action = k.revoked_at
      ? '<button class="btn danger" data-del="' + esc(k.id) + '" data-hard="1">Delete</button>'
      : '<button class="btn danger" data-del="' + esc(k.id) + '">Revoke</button>';
    return '<tr>'
      + '<td>' + esc(k.name) + '</td>'
      + '<td class="mono">' + esc(k.key_prefix) + '…</td>'
      + '<td>' + status + '</td>'
      + '<td>' + fmtNum(k.request_count) + '</td>'
      + '<td>' + fmtNum(k.total_tokens) + '</td>'
      + '<td style="color:var(--muted);font-size:12.5px">' + fmtDate(k.last_used_at) + '</td>'
      + '<td style="text-align:right">' + action + '</td>'
      + '</tr>';
  }).join('');

  $('#keys-body').innerHTML =
    '<table><tr><th>Name</th><th>Key</th><th>Status</th><th>Requests</th><th>Tokens</th><th>Last used</th><th></th></tr>'
    + rows + '</table>';

  document.querySelectorAll('[data-del]').forEach(function(btn){
    btn.onclick = function(){
      var hard = btn.dataset.hard === '1';
      if (!confirm(hard ? 'Permanently delete this key?' : 'Revoke this key? Apps using it will stop working immediately.')) return;
      fetch('/admin/api/keys/' + btn.dataset.del + (hard ? '?hard=true' : ''), { method: 'DELETE' })
        .then(function(r){ return r.json(); })
        .then(function(){ toast(hard ? 'Key deleted' : 'Key revoked'); loadKeys(); })
        .catch(function(){ toast('Something went wrong'); });
    };
  });
}

function loadKeys(){
  fetch('/admin/api/keys').then(function(r){ return r.json(); })
    .then(function(d){ renderKeys(d.keys || []); })
    .catch(function(){ $('#keys-body').innerHTML = '<div class="empty">Could not load keys.</div>'; });
}

$('#new-key').onclick = function(){
  var name = prompt('Name this key (e.g. "laptop", "n8n", "raycast")', 'My key');
  if (name === null) return;
  fetch('/admin/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d.key){ toast(d.message || 'Could not create key'); return; }
      $('#reveal-slot').innerHTML =
        '<div class="reveal"><h3>Key created — copy it now</h3>'
        + '<p>This is the only time it will ever be shown. We store a SHA-256 hash, so it cannot be recovered.</p>'
        + '<div class="keybox"><input id="new-val" readonly value="' + esc(d.key) + '">'
        + '<button class="btn" id="copy-key">Copy</button></div></div>';
      $('#copy-key').onclick = function(){
        var el = $('#new-val'); el.select();
        navigator.clipboard.writeText(el.value).then(function(){ toast('Copied to clipboard'); },
          function(){ document.execCommand('copy'); toast('Copied'); });
      };
      loadKeys();
    })
    .catch(function(){ toast('Could not create key'); });
};

/* ---------- playground ---------- */
var history = [];

function addBubble(role, text){
  var d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = text;
  $('#chat').appendChild(d);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return d;
}

fetch('/v1/models').then(function(r){ return r.json(); }).then(function(d){
  var sel = $('#model');
  (d.data || []).filter(function(m){ return m.id.indexOf('bge') === -1 && m.id.indexOf('embedding') === -1; })
    .forEach(function(m){
      var o = document.createElement('option');
      o.value = m.id; o.textContent = m.id.replace('@cf/', '');
      sel.appendChild(o);
    });
});

$('#clear').onclick = function(){ history = []; $('#chat').innerHTML = ''; };

function send(){
  var text = $('#prompt').value.trim();
  if (!text) return;
  $('#prompt').value = ''; $('#prompt').style.height = 'auto';
  addBubble('user', text);
  history.push({ role: 'user', content: text });

  var out = addBubble('assistant', '');
  var acc = '';
  $('#send').disabled = true;

  fetch('/admin/api/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: $('#model').value, messages: history, stream: true })
  }).then(function(res){
    if (!res.ok) return res.json().then(function(e){ throw new Error((e.error && e.error.message) || 'Request failed'); });
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    function pump(){
      return reader.read().then(function(step){
        if (step.done){
          history.push({ role: 'assistant', content: acc });
          $('#send').disabled = false;
          return;
        }
        buf += dec.decode(step.value, { stream: true });
        var lines = buf.split('\\n');
        buf = lines.pop();
        lines.forEach(function(line){
          line = line.trim();
          if (!line || line.indexOf('data:') !== 0) return;
          var payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            var j = JSON.parse(payload);
            var piece = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (piece){ acc += piece; out.textContent = acc; $('#chat').scrollTop = $('#chat').scrollHeight; }
          } catch(e){}
        });
        return pump();
      });
    }
    return pump();
  }).catch(function(err){
    out.textContent = 'Error: ' + err.message;
    $('#send').disabled = false;
  });
}

$('#send').onclick = send;
$('#prompt').addEventListener('keydown', function(e){
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});
$('#prompt').addEventListener('input', function(){
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 110) + 'px';
});

/* ---------- usage ---------- */
function neurons(n){
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderCloudflareUsage(d){
  var used = Number(d.used_neurons || 0);
  var limit = Number(d.daily_limit_neurons || 10000);
  var percent = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  $('#cloudflare-usage').className = 'cf-usage';
  $('#cloudflare-usage').innerHTML =
    '<div class="cf-usage-head"><div><div class="cf-usage-title">Cloudflare Workers AI</div>'
    + '<div class="cf-usage-sub">Neurons used today · UTC reset at 00:00</div></div>'
    + '<div class="cf-usage-value">' + neurons(used) + ' <small>/ ' + neurons(limit) + ' neurons</small></div></div>'
    + '<div class="cf-meter"><span style="width:' + percent.toFixed(2) + '%"></span></div>'
    + '<div class="cf-usage-note">Live account-level data from Cloudflare. This is separate from the gateway counters below.</div>';
}

function renderCloudflareUsageError(d){
  var setup = d && d.error === 'cloudflare_usage_not_configured';
  $('#cloudflare-usage').className = 'cf-usage ' + (setup ? 'setup' : 'error');
  $('#cloudflare-usage').innerHTML =
    '<div class="cf-usage-head"><div><div class="cf-usage-title">Cloudflare Workers AI</div>'
    + '<div class="cf-usage-sub">Neurons used today</div></div>'
    + '<div class="cf-usage-value">' + (setup ? 'Setup required' : 'Unavailable') + '</div></div>'
    + '<div class="cf-usage-note">' + esc((d && d.message) || 'Refresh to try again.') + '</div>';
}

function loadCloudflareUsage(){
  $('#cloudflare-usage').className = 'cf-usage';
  $('#cloudflare-usage').innerHTML = '<div class="cf-usage-head"><div><div class="cf-usage-title">Cloudflare Workers AI</div><div class="cf-usage-sub">Neurons used today</div></div><div class="cf-usage-value">Loading...</div></div>';
  fetch('/admin/api/cloudflare-usage')
    .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
    .then(function(result){
      if (!result.ok) { renderCloudflareUsageError(result.data); return; }
      renderCloudflareUsage(result.data);
    })
    .catch(function(){ renderCloudflareUsageError({ message: 'Could not reach the Cloudflare usage endpoint.' }); });
}

function loadUsage(){
  loadCloudflareUsage();
  fetch('/admin/api/usage').then(function(r){ return r.json(); }).then(function(d){
    var t = d.totals || {};
    $('#stats').innerHTML =
      '<div class="stat"><div class="n">' + fmtNum(t.requests) + '</div><div class="l">Total requests</div></div>'
      + '<div class="stat"><div class="n">' + fmtNum(t.tokens) + '</div><div class="l">Total tokens</div></div>'
      + '<div class="stat"><div class="n">' + fmtNum(t.keys) + '</div><div class="l">Keys created</div></div>';

    var daily = d.daily || [];
    var max = daily.reduce(function(m, r){ return Math.max(m, r.requests || 0); }, 1);
    $('#bars').innerHTML = daily.length
      ? daily.map(function(r){
          var h = Math.max(2, Math.round((r.requests / max) * 100));
          return '<div class="bar" style="height:' + h + '%" title="' + esc(r.day) + ': ' + fmtNum(r.requests) + ' requests"></div>';
        }).join('')
      : '<div style="color:var(--muted);font-size:13px;margin:auto">No traffic recorded yet.</div>';

    var models = d.by_model || [];
    $('#models-body').innerHTML = models.length
      ? '<table><tr><th>Model</th><th>Requests</th><th>Tokens</th></tr>'
        + models.map(function(m){
            return '<tr><td class="mono">' + esc(m.model) + '</td><td>' + fmtNum(m.requests) + '</td><td>' + fmtNum(m.tokens) + '</td></tr>';
          }).join('') + '</table>'
      : '<div class="empty">No model usage yet.</div>';
  }).catch(function(){ $('#stats').innerHTML = ''; });
}

$('#refresh-usage').onclick = loadUsage;

loadKeys();
</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
