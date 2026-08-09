/** Authenticated dashboard: key management, persistent chats, usage. */

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
  .tab{padding:11px 16px;font:inherit;font-size:13.5px;color:var(--muted);cursor:pointer;background:transparent;border:0;border-bottom:2px solid transparent;user-select:none}
  .tab:hover{color:var(--fg)}
  .tab:focus-visible{outline:2px solid var(--accent2);outline-offset:-2px}
  .tab.on{color:var(--fg);border-bottom-color:var(--accent)}
  main{max-width:1280px;margin:0 auto;padding:26px 22px 70px}
  .pane{display:none}.pane.on{display:block}
  .row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  h2{font-size:17px;font-weight:650;letter-spacing:-.01em}
  .hint{font-size:12.5px;color:var(--muted);margin-top:3px}
  .btn{padding:9px 15px;border-radius:8px;background:var(--accent);color:#231400;font-weight:650;font-size:13px;border:none;cursor:pointer}
  .btn:hover{filter:brightness(1.08)}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
  .btn.ghost:hover{color:var(--fg)}
  .btn.small{padding:6px 10px;font-size:12px}
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
  select option:disabled{color:#667085;background:#11151d}
  select:focus,input:focus,textarea:focus{outline:none;border-color:var(--accent2)}
  .hidden{display:none!important}
  .chats-layout{display:grid;grid-template-columns:minmax(220px,270px) minmax(0,1fr);min-height:600px;background:var(--panel);border:1px solid var(--line);border-radius:13px;overflow:hidden}
  .conversation-sidebar{display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--line);background:#10141c}
  .conversation-sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px;border-bottom:1px solid var(--line)}
  .conversation-sidebar-head h3{font-size:13px;font-weight:650}
  .conversation-list{display:flex;flex-direction:column;gap:3px;padding:8px;overflow-y:auto;min-height:0;max-height:610px}
  .conversation-item{width:100%;min-width:0;text-align:left;border:1px solid transparent;background:transparent;color:inherit;border-radius:9px;padding:9px 10px;cursor:pointer}
  .conversation-item:hover{background:#191f2b}.conversation-item.active{background:#1c2638;border-color:#31415d}.conversation-item:disabled{opacity:.55;cursor:not-allowed}
  .conversation-item-title{display:block;color:#dce2ed;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .conversation-item-meta{display:block;color:#707c91;font-size:10.5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .conversation-list-state{padding:28px 14px;text-align:center;color:var(--muted);font-size:12px;line-height:1.5}
  .conversation-list-state .btn{margin-top:10px}
  .conversation-more{margin:0 8px 9px}
  .chat-main{min-width:0;padding:16px;display:flex;flex-direction:column}
  .chat-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px;flex-wrap:wrap}
  .chat-title-row{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
  .chat-title-copy{min-width:0}.chat-title-copy h2{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:460px}
  .chat-controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
  .sidebar-toggle{display:none}
  .rename-form{display:flex;align-items:center;gap:7px;min-width:min(100%,430px);flex-wrap:wrap}
  .rename-form input{min-width:0;flex:1 1 180px}
  .chat-notice{margin:auto;max-width:390px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6;padding:30px}
  .chat-notice b{display:block;color:var(--fg);font-size:14px;margin-bottom:4px}
  .chat-notice .btn{margin-top:12px}
  .history-more{display:flex;justify-content:center;padding:4px 0 12px}
  .chat-wrap{position:relative;margin-bottom:12px}
  .chat{background:#111620;border:1px solid var(--line);border-radius:12px;height:clamp(420px,58vh,640px);overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:14px}
  .chat-empty{margin:auto;text-align:center;color:var(--muted);font-size:13px;line-height:1.6;padding:30px}
  .chat-empty b{display:block;color:var(--fg);font-size:14px;margin-bottom:3px}
  .msg{max-width:84%;padding:11px 14px;border-radius:12px;font-size:13.5px;line-height:1.65;overflow-wrap:anywhere}
  .msg.user{align-self:flex-end;background:#26365e;color:#e8eeff;white-space:pre-wrap}
  .msg.assistant{align-self:flex-start;width:min(880px,94%);max-width:94%;background:var(--panel2);border:1px solid var(--line);padding:14px 16px}
  .msg-content>:first-child{margin-top:0}.msg-content>:last-child{margin-bottom:0}
  .msg-content p{margin:0 0 12px}
  .msg-content h1,.msg-content h2,.msg-content h3,.msg-content h4{line-height:1.3;letter-spacing:-.01em;margin:18px 0 8px;color:#f0f3f9}
  .msg-content h1{font-size:19px}.msg-content h2{font-size:17px}.msg-content h3{font-size:15px}.msg-content h4{font-size:13.5px}
  .msg-content ul,.msg-content ol{margin:8px 0 13px;padding-left:23px}
  .msg-content li{padding-left:2px;margin:4px 0}.msg-content li::marker{color:#aab7d0}
  .msg-content strong{font-weight:700;color:#f2f4f8}.msg-content em{color:#cdd5e3}
  .msg-content a{color:#8eb0ff;text-decoration:none;text-underline-offset:3px}.msg-content a:hover{text-decoration:underline}
  .msg-content code{font-size:.9em;background:#10141d;border:1px solid #2b3445;border-radius:5px;padding:2px 5px;color:#e5c07b}
  .msg-content pre{position:relative;background:#0d1118;border:1px solid #293143;border-radius:9px;padding:34px 13px 13px;margin:12px 0;overflow:auto;line-height:1.55}
  .msg-content pre code{display:block;background:transparent;border:0;border-radius:0;padding:0;color:#dce3ef;font-size:12.5px;white-space:pre;overflow-wrap:normal}
  .code-lang{position:absolute;top:8px;left:11px;color:#768198;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em}
  .copy-code{position:absolute;top:6px;right:7px;border:1px solid #313a4d;background:#171d28;color:#aeb7c8;border-radius:6px;padding:3px 8px;font-size:10.5px;cursor:pointer}
  .copy-code:hover{color:var(--fg);border-color:#46536c}
  .msg-content blockquote{margin:12px 0;padding:4px 0 4px 13px;border-left:3px solid #536b9c;color:#bcc6d8}
  .msg-content hr{border:0;border-top:1px solid var(--line);margin:18px 0}
  .table-scroll{overflow-x:auto;margin:12px 0;border:1px solid var(--line);border-radius:8px}
  .msg-content table{min-width:420px;font-size:12.5px}.msg-content th,.msg-content td{padding:8px 10px}.msg-content th{text-transform:none;letter-spacing:0;font-size:12px}
  .citation{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin:0 1px;border-radius:99px;background:#263b65;color:#aecaFF!important;font-size:10.5px;font-weight:700;line-height:1;text-decoration:none!important;vertical-align:super}
  .citation:hover{background:#355187;color:#e4ecff!important}
  .message-status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12.5px;min-height:22px}
  .message-status.error{color:#ffaaa4}
  .spinner{width:13px;height:13px;border:2px solid #3c4558;border-top-color:#8eb0ff;border-radius:50%;animation:spin .75s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .search-card{margin-top:14px;border-top:1px solid #2a3242;padding-top:11px}
  .search-card summary{display:flex;align-items:center;gap:9px;cursor:pointer;list-style:none;color:#cbd4e4;font-size:12.5px;user-select:none}
  .search-card summary::-webkit-details-marker{display:none}
  .search-icon{width:25px;height:25px;display:grid;place-items:center;border-radius:7px;background:#202d47;color:#9db9ef;flex:0 0 auto}
  .search-icon svg{width:14px;height:14px}
  .search-summary{min-width:0;flex:1}.search-summary b{display:block;font-size:12.5px;font-weight:650;color:#dce3ee}
  .search-summary span{display:block;color:#7f8a9f;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
  .search-chevron{color:#778299;transition:transform .16s}.search-card[open] .search-chevron{transform:rotate(180deg)}
  .search-details{padding:11px 0 1px 34px}
  .query-list{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}
  .query-chip{max-width:100%;padding:3px 7px;border-radius:6px;background:#151b26;color:#8793a8;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .source-list{display:grid;gap:7px}
  .source-link{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;padding:8px;border:1px solid #293244;border-radius:8px;background:#161c27;color:inherit!important;text-decoration:none!important}
  .source-link:hover{border-color:#40506b;background:#192131}
  .source-number{width:20px;height:20px;display:grid;place-items:center;border-radius:6px;background:#243657;color:#abc4f7;font-size:10px;font-weight:700}
  .source-copy{display:block;min-width:0}.source-title{display:block;color:#dce3ef;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .source-host{display:block;color:#768198;font-size:10.5px;margin-top:1px}.source-snippet{color:#909caf;font-size:11px;line-height:1.45;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .source-empty{color:#7f8a9e;font-size:11.5px;padding:3px 0}
  .jump-latest{position:absolute;right:16px;bottom:14px;display:none;align-items:center;gap:6px;border:1px solid #3b4962;background:#202a3a;color:#dce4f3;border-radius:99px;padding:6px 10px;font-size:11.5px;box-shadow:0 6px 20px #0007;cursor:pointer}
  .jump-latest.show{display:flex}
  .composer{display:flex;gap:9px}
  .search-status{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;white-space:nowrap}
  .search-status::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px #3fb95018}
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
  @media(max-width:780px){
    main{padding:20px 12px 50px}.top,.tabs{padding-left:14px;padding-right:14px}
    .chats-layout{display:block;min-height:0}.conversation-sidebar{display:none;border-right:0;border-bottom:1px solid var(--line);max-height:45vh}.conversation-sidebar.open{display:flex}
    .conversation-list{max-height:220px}.sidebar-toggle{display:inline-flex}.chat-main{padding:12px}.chat-title-copy h2{max-width:58vw}
    .chat-controls{width:100%}#model{min-width:0;flex:1}.rename-form{width:100%}
    .chat{height:55vh;padding:12px}.msg{max-width:94%}.msg.assistant{width:97%;max-width:97%;padding:12px 13px}
    .search-details{padding-left:0}.composer .btn{padding-left:13px;padding-right:13px}
  }
  @media(max-width:420px){
    .chat-title-row{flex-wrap:wrap}.rename-form{display:grid;grid-template-columns:1fr 1fr;width:100%;min-width:0}.rename-form input{grid-column:1/-1;width:100%;min-width:0}
    .rename-form .btn{min-height:40px}.chat-controls .btn,.sidebar-toggle{min-height:40px}
  }
`;

/**
 * Small, dependency-free Markdown subset for authenticated Chats.
 * It escapes every model-provided value before adding markup, then allows only
 * the elements emitted below. Exported as source so the exact browser renderer
 * can be exercised in Node tests without maintaining a second implementation.
 */
export const PLAYGROUND_FORMATTER_SCRIPT = String.raw`
function escapeMarkup(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function safeHref(value){
  try {
    var rawHref = String(value).trim();
    if (!rawHref || rawHref.length > 4096) return '';
    var parsed = new URL(rawHref);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    parsed.username = '';
    parsed.password = '';
    return parsed.href;
  } catch(e) {
    return '';
  }
}

function normaliseSources(value){
  return (Array.isArray(value) ? value : []).reduce(function(result, item, index){
    var source = item && typeof item === 'object' ? item : {};
    var href = safeHref(source.url || source.id || '');
    if (!href) return result;
    var parsed = new URL(href);
    var title = typeof source.title === 'string' ? source.title.trim().slice(0, 240) : '';
    var snippet = typeof source.snippet === 'string'
      ? source.snippet.replace(/\s+/g, ' ').trim().slice(0, 600)
      : '';
    var sourceNumber = Number(source.number);
    result.push({
      number: Number.isInteger(sourceNumber) && sourceNumber > 0 ? sourceNumber : index + 1,
      url: href,
      title: title || parsed.hostname.replace(/^www\./, '') || href,
      host: parsed.hostname.replace(/^www\./, ''),
      snippet: snippet
    });
    return result;
  }, []);
}

function createSseDecoder(onEvent){
  var buffer = '';
  var done = false;

  function processLine(line){
    var value = String(line).trim();
    if (!value || value.indexOf('data:') !== 0) return;
    var payload = value.slice(5).trim();
    if (payload === '[DONE]') {
      done = true;
      return;
    }
    if (!payload) return;
    var event;
    try { event = JSON.parse(payload); } catch(e) { return; }
    if (event.error) {
      throw new Error((event.error && event.error.message) || 'The model stream stopped unexpectedly.');
    }
    onEvent(event);
  }

  return {
    push: function(value){
      if (done || !value) return;
      buffer += String(value);
      var lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (var index = 0; index < lines.length && !done; index += 1) processLine(lines[index]);
    },
    finish: function(value){
      if (done) return;
      if (value) buffer += String(value);
      if (buffer.trim()) processLine(buffer);
      buffer = '';
      if (!done) throw new Error('The response stream ended before completion.');
    },
    isDone: function(){ return done; }
  };
}

function renderInline(value, sources, depth){
  var text = String(value == null ? '' : value);
  var sourceList = Array.isArray(sources) ? sources : [];
  var level = Number(depth || 0);
  if (level > 6) return escapeMarkup(text);
  var html = '';
  var i = 0;
  var tick = String.fromCharCode(96);

  while (i < text.length) {
    if (text.charCodeAt(i) === 92 && i + 1 < text.length
      && [92, 96, 42, 95, 91, 93, 40, 41, 126].indexOf(text.charCodeAt(i + 1)) !== -1) {
      html += escapeMarkup(text.charAt(i + 1));
      i += 2;
      continue;
    }

    if (text.charAt(i) === tick) {
      var codeEnd = text.indexOf(tick, i + 1);
      if (codeEnd > i + 1) {
        html += '<code>' + escapeMarkup(text.slice(i + 1, codeEnd)) + '</code>';
        i = codeEnd + 1;
        continue;
      }
    }

    var paired = [
      { marker: '**', tag: 'strong' },
      { marker: '__', tag: 'strong' },
      { marker: '~~', tag: 's' }
    ];
    var pairFound = false;
    for (var p = 0; p < paired.length; p += 1) {
      var pair = paired[p];
      if (text.slice(i, i + pair.marker.length) !== pair.marker) continue;
      var pairEnd = text.indexOf(pair.marker, i + pair.marker.length);
      if (pairEnd <= i + pair.marker.length) continue;
      html += '<' + pair.tag + '>'
        + renderInline(text.slice(i + pair.marker.length, pairEnd), sourceList, level + 1)
        + '</' + pair.tag + '>';
      i = pairEnd + pair.marker.length;
      pairFound = true;
      break;
    }
    if (pairFound) continue;

    if (text.charAt(i) === '*' || text.charAt(i) === '_') {
      var emphasis = text.charAt(i);
      var emphasisEnd = text.indexOf(emphasis, i + 1);
      if (emphasisEnd > i + 1 && !/^\s|\s$/.test(text.slice(i + 1, emphasisEnd))) {
        html += '<em>' + renderInline(text.slice(i + 1, emphasisEnd), sourceList, level + 1) + '</em>';
        i = emphasisEnd + 1;
        continue;
      }
    }

    if (text.charAt(i) === '[' || text.charAt(i) === '【' || text.charAt(i) === '［') {
      var openingBracket = text.charAt(i);
      var closingBracket = openingBracket === '【' ? '】' : openingBracket === '［' ? '］' : ']';
      var labelEnd = text.indexOf(closingBracket, i + 1);
      if (labelEnd > i + 1) {
        var label = text.slice(i + 1, labelEnd);
        if (openingBracket === '[' && text.charAt(labelEnd + 1) === '(') {
          var hrefEnd = text.indexOf(')', labelEnd + 2);
          if (hrefEnd > labelEnd + 2) {
            var markdownHref = safeHref(text.slice(labelEnd + 2, hrefEnd).trim());
            if (markdownHref) {
              html += '<a href="' + escapeMarkup(markdownHref)
                + '" target="_blank" rel="noopener noreferrer">'
                + renderInline(label, sourceList, level + 1) + '</a>';
              i = hrefEnd + 1;
              continue;
            }
          }
        }

        var normalisedCitationLabel = label.replace(/[０-９]/g, function(digit){
          return String.fromCharCode(digit.charCodeAt(0) - 65248);
        });
        var citation = /^(\d+)(?:\s*†\s*(.+))?$/.exec(normalisedCitationLabel);
        if (citation) {
          var number = Number(citation[1]);
          var source = number > 0
            ? sourceList.find(function(item){ return item && item.number === number; })
            : null;
          var citationLabel = '[' + number + ']';
          var citationTitle = source
            ? 'Source ' + number + ': ' + source.title
            : 'Source ' + number;
          if (citation[2]) citationTitle += ' · cited passage ' + citation[2].trim();
          if (source && source.url) {
            html += '<a class="citation" href="' + escapeMarkup(source.url)
              + '" target="_blank" rel="noopener noreferrer" aria-label="'
              + escapeMarkup(citationTitle) + '" title="' + escapeMarkup(citationTitle) + '">'
              + escapeMarkup(citationLabel) + '</a>';
          } else {
            html += '<span class="citation" title="' + escapeMarkup(citationTitle) + '">'
              + escapeMarkup(citationLabel) + '</span>';
          }
          i = labelEnd + 1;
          continue;
        }
      }
    }

    var urlMatch = /^(https?:\/\/[^\s<]+)/i.exec(text.slice(i));
    if (urlMatch) {
      var urlText = urlMatch[1];
      while (/[.,!?;:]$/.test(urlText)) urlText = urlText.slice(0, -1);
      if (urlText.charAt(urlText.length - 1) === ')' && urlText.indexOf('(') === -1) urlText = urlText.slice(0, -1);
      var bareHref = safeHref(urlText);
      if (bareHref) {
        html += '<a href="' + escapeMarkup(bareHref) + '" target="_blank" rel="noopener noreferrer">'
          + escapeMarkup(urlText) + '</a>';
        i += urlText.length;
        continue;
      }
    }

    html += escapeMarkup(text.charAt(i));
    i += 1;
  }
  return html;
}

function tableCells(line){
  return String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function(cell){
    return cell.trim();
  });
}

function isTableDivider(line){
  var cells = tableCells(line);
  return cells.length > 0 && cells.every(function(cell){ return /^:?-{3,}:?$/.test(cell); });
}

function listItem(line){
  var unordered = /^ {0,3}[-+*]\s+(.+)$/.exec(line);
  if (unordered) return { ordered: false, content: unordered[1], start: 1 };
  var ordered = /^ {0,3}(\d+)[.)]\s+(.+)$/.exec(line);
  if (ordered) return { ordered: true, content: ordered[2], start: Number(ordered[1]) || 1 };
  return null;
}

function isBlockStart(lines, index){
  var line = lines[index] || '';
  var trimmed = line.trim();
  var fence = String.fromCharCode(96, 96, 96);
  return trimmed.indexOf(fence) === 0
    || trimmed.indexOf('~~~') === 0
    || /^#{1,6}\s+/.test(trimmed)
    || /^>\s?/.test(trimmed)
    || /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
    || Boolean(listItem(line));
}

function renderMarkdown(value, sources){
  var text = String(value == null ? '' : value).replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';
  var sourceList = Array.isArray(sources) ? sources : [];
  var lines = text.split('\n');
  var output = [];
  var i = 0;
  var fence = String.fromCharCode(96, 96, 96);

  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }

    var trimmed = lines[i].trim();
    var marker = trimmed.indexOf(fence) === 0 ? fence : (trimmed.indexOf('~~~') === 0 ? '~~~' : '');
    if (marker) {
      var language = trimmed.slice(marker.length).trim().replace(/[^A-Za-z0-9_.+-]/g, '').slice(0, 24);
      var code = [];
      i += 1;
      while (i < lines.length && lines[i].trim().indexOf(marker) !== 0) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      output.push('<pre>'
        + (language ? '<span class="code-lang">' + escapeMarkup(language) + '</span>' : '')
        + '<code data-language="' + escapeMarkup(language) + '">' + escapeMarkup(code.join('\n')) + '</code></pre>');
      continue;
    }

    var heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      var headingLevel = Math.min(4, heading[1].length);
      output.push('<h' + headingLevel + '>' + renderInline(heading[2], sourceList, 0) + '</h' + headingLevel + '>');
      i += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lines[i])) {
      output.push('<hr>');
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      var quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      output.push('<blockquote>' + renderMarkdown(quote.join('\n'), sourceList) + '</blockquote>');
      continue;
    }

    var firstItem = listItem(lines[i]);
    if (firstItem) {
      var ordered = firstItem.ordered;
      var tag = ordered ? 'ol' : 'ul';
      var start = ordered && firstItem.start !== 1 ? ' start="' + firstItem.start + '"' : '';
      var items = [];
      while (i < lines.length) {
        var item = listItem(lines[i]);
        if (!item || item.ordered !== ordered) break;
        var itemText = item.content;
        i += 1;
        while (i < lines.length && lines[i].trim() && !listItem(lines[i]) && /^\s{2,}/.test(lines[i])) {
          itemText += ' ' + lines[i].trim();
          i += 1;
        }
        items.push('<li>' + renderInline(itemText, sourceList, 0) + '</li>');
        if (i < lines.length && !lines[i].trim()) {
          var next = i + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          var nextItem = next < lines.length ? listItem(lines[next]) : null;
          if (!nextItem || nextItem.ordered !== ordered) break;
          i = next;
        }
      }
      output.push('<' + tag + start + '>' + items.join('') + '</' + tag + '>');
      continue;
    }

    if (i + 1 < lines.length && lines[i].indexOf('|') !== -1 && isTableDivider(lines[i + 1])) {
      var headers = tableCells(lines[i]);
      var dividers = tableCells(lines[i + 1]);
      var aligns = dividers.map(function(cell){
        return cell.charAt(0) === ':' && cell.charAt(cell.length - 1) === ':' ? 'center'
          : (cell.charAt(cell.length - 1) === ':' ? 'right' : 'left');
      });
      i += 2;
      var bodyRows = [];
      while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
        bodyRows.push(tableCells(lines[i]));
        i += 1;
      }
      var headHtml = headers.map(function(cell, index){
        return '<th style="text-align:' + (aligns[index] || 'left') + '">' + renderInline(cell, sourceList, 0) + '</th>';
      }).join('');
      var bodyHtml = bodyRows.map(function(row){
        return '<tr>' + headers.map(function(_header, index){
          return '<td style="text-align:' + (aligns[index] || 'left') + '">'
            + renderInline(row[index] || '', sourceList, 0) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      output.push('<div class="table-scroll"><table><thead><tr>' + headHtml
        + '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div>');
      continue;
    }

    var paragraph = [lines[i].trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)
      && !(i + 1 < lines.length && lines[i].indexOf('|') !== -1 && isTableDivider(lines[i + 1]))) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    output.push('<p>' + paragraph.map(function(line){ return renderInline(line, sourceList, 0); }).join('<br>') + '</p>');
  }

  return output.join('');
}
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

<div class="tabs" role="tablist" aria-label="Dashboard sections">
  <button class="tab on" id="tab-chats" type="button" role="tab" aria-selected="true" aria-controls="pane-chats" data-pane="chats">Chats</button>
  <button class="tab" id="tab-keys" type="button" role="tab" aria-selected="false" aria-controls="pane-keys" data-pane="keys">API Keys</button>
  <button class="tab" id="tab-usage" type="button" role="tab" aria-selected="false" aria-controls="pane-usage" data-pane="usage">Usage</button>
</div>

<main>
  <section class="pane" id="pane-keys" role="tabpanel" aria-labelledby="tab-keys">
    <div class="row">
      <div><h2>API Keys</h2><div class="hint">Use these as the <code>Authorization: Bearer</code> value with any OpenAI SDK.</div></div>
      <button class="btn" id="new-key">+ Create key</button>
    </div>
    <div id="reveal-slot"></div>
    <div class="panel"><div id="keys-body"><div class="empty">Loading…</div></div></div>
  </section>

  <section class="pane on" id="pane-chats" role="tabpanel" aria-labelledby="tab-chats">
    <div class="row">
      <div><h2>Chats</h2><div class="hint">Your conversations are saved securely and available across signed-in devices.</div></div>
    </div>
    <div class="chats-layout">
      <aside class="conversation-sidebar" id="conversation-sidebar" aria-label="Saved conversations">
        <div class="conversation-sidebar-head">
          <h3>Conversations</h3>
          <button class="btn small" id="new-chat" type="button">+ New</button>
        </div>
        <div class="conversation-list-state" id="conversation-list-state">Loading conversations…</div>
        <div class="conversation-list" id="conversation-list" role="list"></div>
        <button class="btn ghost small conversation-more hidden" id="conversation-more" type="button">Load more</button>
      </aside>
      <div class="chat-main">
        <div class="chat-toolbar">
          <div class="chat-title-row">
            <button class="btn ghost small sidebar-toggle" id="conversation-toggle" type="button" aria-expanded="false" aria-controls="conversation-sidebar">Conversations</button>
            <div class="chat-title-copy" id="chat-title-copy">
              <h2 id="conversation-title">New chat</h2>
              <div class="hint" id="conversation-subtitle">Choose a conversation or start a new one.</div>
            </div>
            <form class="rename-form hidden" id="rename-form">
              <input id="rename-title" type="text" maxlength="120" aria-label="Conversation title">
              <button class="btn small" type="submit">Save</button>
              <button class="btn ghost small" id="rename-cancel" type="button">Cancel</button>
            </form>
          </div>
          <div class="chat-controls">
            <select id="model" aria-label="Chat model"></select>
            <span class="search-status" title="The selected model can call server-managed web tools when needed">Web tools automatic</span>
            <button class="btn ghost small" id="rename-chat" type="button" disabled>Rename</button>
            <button class="btn danger" id="delete-chat" type="button" disabled>Delete</button>
          </div>
        </div>
        <div class="chat-wrap">
          <div class="chat" id="chat" role="log" aria-live="polite" aria-relevant="additions text">
            <div class="chat-notice"><b>Start a conversation</b>Answers can include formatted text, code, and cited web sources.</div>
          </div>
          <button class="jump-latest" id="jump-latest" type="button" aria-label="Jump to the latest message">↓ Latest</button>
        </div>
        <div class="composer">
          <textarea id="prompt" rows="1" placeholder="Ask something… (Enter to send, Shift+Enter for newline)" aria-label="Message"></textarea>
          <button class="btn" id="send">Send</button>
        </div>
      </div>
    </div>
  </section>

  <section class="pane" id="pane-usage" role="tabpanel" aria-labelledby="tab-usage">
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

${PLAYGROUND_FORMATTER_SCRIPT}

/* ---------- tabs ---------- */
function activatePane(name){
  var tab = document.querySelector('.tab[data-pane="' + name + '"]');
  var pane = $('#pane-' + name);
  if (!tab || !pane) return;
  document.querySelectorAll('.tab').forEach(function(t){
    t.classList.remove('on');
    t.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.pane').forEach(function(p){ p.classList.remove('on'); });
  tab.classList.add('on');
  tab.setAttribute('aria-selected', 'true');
  pane.classList.add('on');
  if (name === 'usage') loadUsage();
}

document.querySelectorAll('.tab').forEach(function(tab){
  tab.onclick = function(){
    activatePane(tab.dataset.pane);
  };
  tab.onkeydown = function(event){
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    var tabs = Array.from(document.querySelectorAll('.tab'));
    var direction = event.key === 'ArrowRight' ? 1 : -1;
    var next = tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
    next.focus();
    activatePane(next.dataset.pane);
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

/* ---------- persistent chats ---------- */
var chatHistory = [];
var activeRequest = null;
var autoFollow = true;
var conversations = [];
var conversationCursor = null;
var activeConversation = null;
var conversationMessages = [];
var conversationMessageCursor = null;
var olderMessagesLoading = false;
var conversationListLoading = false;
var conversationLoadToken = 0;
var conversationLoading = false;
var modelsLoaded = false;
var pendingModel = '';
var conversationMutation = null;
var lastDeviceSync = Date.now();

function renderChatNotice(title, detail, actionLabel, action){
  var chat = $('#chat');
  chat.innerHTML = '';
  var notice = document.createElement('div');
  notice.className = 'chat-notice';
  var heading = document.createElement('b');
  heading.textContent = title;
  notice.appendChild(heading);
  var copy = document.createElement('span');
  copy.textContent = detail || '';
  notice.appendChild(copy);
  if (actionLabel && action) {
    var button = document.createElement('button');
    button.className = 'btn ghost small';
    button.type = 'button';
    button.textContent = actionLabel;
    button.onclick = action;
    notice.appendChild(button);
  }
  chat.appendChild(notice);
  autoFollow = true;
  updateJumpButton();
}

function renderChatEmpty(){
  renderChatNotice(
    activeConversation ? 'Continue the conversation' : 'Start a conversation',
    'Answers can include formatted text, code, and cited web sources.'
  );
}

function nearChatBottom(){
  var chat = $('#chat');
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
}

function updateJumpButton(){
  var hasOverflow = $('#chat').scrollHeight > $('#chat').clientHeight + 20;
  $('#jump-latest').classList.toggle('show', hasOverflow && !autoFollow);
}

function scrollChat(force){
  if (force) autoFollow = true;
  requestAnimationFrame(function(){
    if (autoFollow) $('#chat').scrollTop = $('#chat').scrollHeight;
    updateJumpButton();
  });
}

$('#chat').addEventListener('scroll', function(){
  autoFollow = nearChatBottom();
  updateJumpButton();
});

$('#jump-latest').onclick = function(){ scrollChat(true); };

function addBubble(role, text){
  var empty = $('#chat .chat-empty, #chat .chat-notice');
  if (empty) empty.remove();
  var d = document.createElement('div');
  d.className = 'msg ' + role;
  d.setAttribute('aria-label', role === 'user' ? 'You' : 'Assistant');
  var content = document.createElement('div');
  content.className = 'msg-content';
  if (role === 'assistant') content.innerHTML = renderMarkdown(text, []);
  else content.textContent = text;
  d.appendChild(content);
  $('#chat').appendChild(d);
  scrollChat(true);
  return d;
}

function messageStatus(bubble, text, kind, spinning){
  var status = bubble.querySelector('.message-status');
  if (!text) {
    if (status) status.remove();
    return;
  }
  if (!status) {
    status = document.createElement('div');
    status.className = 'message-status';
    status.setAttribute('role', 'status');
    bubble.insertBefore(status, bubble.firstChild);
  }
  status.className = 'message-status' + (kind ? ' ' + kind : '');
  status.innerHTML = '';
  if (spinning) {
    var spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    status.appendChild(spinner);
  }
  var label = document.createElement('span');
  label.textContent = text;
  status.appendChild(label);
}

function copyText(value){
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(value);
  var input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
  return Promise.resolve();
}

function enhanceCodeBlocks(container){
  container.querySelectorAll('pre').forEach(function(pre){
    var code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-code')) return;
    var button = document.createElement('button');
    button.className = 'copy-code';
    button.type = 'button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    button.onclick = function(){
      copyText(code.textContent || '').then(function(){
        button.textContent = 'Copied';
        setTimeout(function(){ button.textContent = 'Copy'; }, 1200);
      }).catch(function(){ toast('Could not copy code'); });
    };
    pre.appendChild(button);
  });
}

function providerName(value){
  return value === 'tavily' ? 'Tavily'
    : value === 'cloudflare' ? 'Cloudflare'
    : value === 'searxng' ? 'SearXNG'
    : 'Web';
}

function searchCard(webSearch, sources){
  if (!webSearch) return null;
  var queries = Array.isArray(webSearch.queries) ? webSearch.queries : [];
  var totalResults = queries.reduce(function(total, query){
    var count = Number(query && query.result_count);
    return total + (Number.isFinite(count) && count > 0 ? count : 0);
  }, 0);

  var details = document.createElement('details');
  details.className = 'search-card';
  var summary = document.createElement('summary');

  var icon = document.createElement('span');
  icon.className = 'search-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
  summary.appendChild(icon);

  var copy = document.createElement('span');
  copy.className = 'search-summary';
  var title = document.createElement('b');
  title.textContent = 'Searched the web';
  var metadata = document.createElement('span');
  var bits = [providerName(webSearch.provider)];
  if (queries.length) bits.push(totalResults + ' result' + (totalResults === 1 ? '' : 's'));
  bits.push(sources.length + ' source' + (sources.length === 1 ? '' : 's'));
  metadata.textContent = bits.join(' · ');
  copy.appendChild(title);
  copy.appendChild(metadata);
  summary.appendChild(copy);

  var chevron = document.createElement('span');
  chevron.className = 'search-chevron';
  chevron.textContent = '⌄';
  chevron.setAttribute('aria-hidden', 'true');
  summary.appendChild(chevron);
  details.appendChild(summary);

  var body = document.createElement('div');
  body.className = 'search-details';
  if (queries.length) {
    var queryList = document.createElement('div');
    queryList.className = 'query-list';
    queries.forEach(function(query){
      if (!query || typeof query.query !== 'string' || !query.query.trim()) return;
      var chip = document.createElement('span');
      chip.className = 'query-chip';
      chip.textContent = query.query.trim().slice(0, 240);
      chip.title = query.query.trim().slice(0, 500);
      queryList.appendChild(chip);
    });
    if (queryList.childNodes.length) body.appendChild(queryList);
  }

  if (sources.length) {
    var list = document.createElement('div');
    list.className = 'source-list';
    sources.forEach(function(source, index){
      var link = document.createElement('a');
      link.className = 'source-link';
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      var number = document.createElement('span');
      number.className = 'source-number';
      number.textContent = String(source.number || index + 1);
      link.appendChild(number);

      var sourceCopy = document.createElement('span');
      sourceCopy.className = 'source-copy';
      var sourceTitle = document.createElement('span');
      sourceTitle.className = 'source-title';
      sourceTitle.textContent = source.title;
      sourceCopy.appendChild(sourceTitle);
      var host = document.createElement('span');
      host.className = 'source-host';
      host.textContent = source.host;
      sourceCopy.appendChild(host);
      if (source.snippet) {
        var snippet = document.createElement('span');
        snippet.className = 'source-snippet';
        snippet.textContent = source.snippet;
        sourceCopy.appendChild(snippet);
      }
      link.appendChild(sourceCopy);
      list.appendChild(link);
    });
    body.appendChild(list);
  } else {
    var noSources = document.createElement('div');
    noSources.className = 'source-empty';
    noSources.textContent = 'The search returned no usable source links.';
    body.appendChild(noSources);
  }
  details.appendChild(body);
  return details;
}

function renderAssistant(bubble, text, sources, webSearch, pending){
  var content = bubble.querySelector('.msg-content');
  content.innerHTML = renderMarkdown(text, sources);
  enhanceCodeBlocks(content);

  var oldCard = bubble.querySelector('.search-card');
  var cardSignature = webSearch
    ? JSON.stringify([webSearch.provider, webSearch.queries, sources.map(function(source){ return source.url; })])
    : '';
  if (bubble.searchCardSignature !== cardSignature) {
    var cardWasOpen = Boolean(oldCard && oldCard.open);
    if (oldCard) oldCard.remove();
    var card = searchCard(webSearch, sources);
    if (card) {
      card.open = cardWasOpen;
      bubble.appendChild(card);
    }
    bubble.searchCardSignature = cardSignature;
  }

  if (pending && !text) {
    messageStatus(
      bubble,
      webSearch && sources.length
        ? 'Preparing an answer from ' + sources.length + ' source' + (sources.length === 1 ? '' : 's') + '…'
        : 'Thinking…',
      '',
      true
    );
  } else {
    messageStatus(bubble, '', '', false);
  }
  scrollChat(false);
}

/* Conversation API adapters keep the UI independent from harmless envelope additions. */
function adaptConversation(value){
  var item = value && typeof value === 'object' ? value : {};
  var id = typeof item.id === 'string' ? item.id : '';
  if (!id) return null;
  var version = Number(item.version);
  return {
    id: id,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 120) : 'New chat',
    last_model: typeof item.last_model === 'string' ? item.last_model : (typeof item.model === 'string' ? item.model : ''),
    version: Number.isFinite(version) && version >= 0 ? version : 0,
    created_at: Number(item.created_at) || 0,
    updated_at: Number(item.updated_at) || Number(item.created_at) || 0
  };
}

function adaptConversationPage(value){
  var body = value && typeof value === 'object' ? value : {};
  var rawItems = Array.isArray(body.items) ? body.items
    : (Array.isArray(body.conversations) ? body.conversations : (Array.isArray(body.data) ? body.data : []));
  return {
    items: rawItems.map(adaptConversation).filter(Boolean),
    nextCursor: typeof body.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null
  };
}

function adaptConversationEnvelope(value){
  var body = value && typeof value === 'object' ? value : {};
  return adaptConversation(body.conversation || body.data || body);
}

function adaptMessage(value){
  var item = value && typeof value === 'object' ? value : {};
  var seq = Number(item.seq);
  return {
    id: typeof item.id === 'string' ? item.id : '',
    seq: Number.isFinite(seq) ? seq : 0,
    role: item.role === 'user' ? 'user' : (item.role === 'assistant' ? 'assistant' : String(item.role || '')),
    content: typeof item.content === 'string' ? item.content : '',
    status: typeof item.status === 'string' ? item.status : 'complete',
    model: typeof item.model === 'string' ? item.model : '',
    metadata: item.metadata,
    created_at: Number(item.created_at) || 0,
    completed_at: Number(item.completed_at) || 0
  };
}

function adaptConversationDetail(value){
  var body = value && typeof value === 'object' ? value : {};
  var rawMessages = Array.isArray(body.messages) ? body.messages
    : (body.data && Array.isArray(body.data.messages) ? body.data.messages : []);
  return {
    conversation: adaptConversation(body.conversation || (body.data && body.data.conversation) || body),
    messages: rawMessages.map(adaptMessage).filter(function(message){
      return message.role === 'user' || message.role === 'assistant';
    }).sort(function(a, b){ return a.seq - b.seq || a.created_at - b.created_at; }),
    nextBeforeSeq: Number.isInteger(Number(body.next_before_seq)) && Number(body.next_before_seq) > 0
      ? Number(body.next_before_seq)
      : null
  };
}

async function conversationApi(path, init){
  var response = await fetch(path, init);
  var data = {};
  if (response.status !== 204) {
    var raw = await response.text();
    if (raw) {
      try { data = JSON.parse(raw); }
      catch(e) { data = { message: raw.slice(0, 300) }; }
    }
  }
  if (!response.ok) {
    var message = data && ((data.error && data.error.message) || data.message || data.error);
    var error = new Error(typeof message === 'string' ? message : 'Request failed (' + response.status + ')');
    error.status = response.status;
    error.code = data && (data.code || (data.error && data.error.code));
    throw error;
  }
  return data;
}

function conversationTimestamp(value){
  var timestamp = Number(value) || 0;
  return timestamp > 0 && timestamp < 100000000000 ? timestamp * 1000 : timestamp;
}

function conversationFromList(id){
  return conversations.find(function(item){ return item.id === id; }) || null;
}

function upsertConversation(conversation, placeFirst){
  if (!conversation) return;
  conversations = conversations.filter(function(item){ return item.id !== conversation.id; });
  if (placeFirst) conversations.unshift(conversation);
  else conversations.push(conversation);
  conversations.sort(function(a, b){
    return conversationTimestamp(b.updated_at) - conversationTimestamp(a.updated_at) || b.id.localeCompare(a.id);
  });
}

function renderConversationListState(message, actionLabel, action){
  var state = $('#conversation-list-state');
  state.innerHTML = '';
  state.classList.remove('hidden');
  var copy = document.createElement('div');
  copy.textContent = message;
  state.appendChild(copy);
  if (actionLabel && action) {
    var button = document.createElement('button');
    button.className = 'btn ghost small';
    button.type = 'button';
    button.textContent = actionLabel;
    button.onclick = action;
    state.appendChild(button);
  }
}

function renderConversationList(){
  var list = $('#conversation-list');
  list.innerHTML = '';
  if (!conversations.length) {
    renderConversationListState('No saved conversations yet.');
  } else {
    $('#conversation-list-state').classList.add('hidden');
    conversations.forEach(function(conversation){
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'conversation-item' + (activeConversation && activeConversation.id === conversation.id ? ' active' : '');
      button.disabled = Boolean(activeRequest || conversationMutation || conversationLoading);
      button.setAttribute('role', 'listitem');
      if (activeConversation && activeConversation.id === conversation.id) button.setAttribute('aria-current', 'true');
      var title = document.createElement('span');
      title.className = 'conversation-item-title';
      title.textContent = conversation.title;
      button.appendChild(title);
      var meta = document.createElement('span');
      meta.className = 'conversation-item-meta';
      var pieces = [];
      if (conversation.last_model) pieces.push(conversation.last_model.replace('@cf/', ''));
      if (conversation.updated_at) pieces.push(new Date(conversationTimestamp(conversation.updated_at)).toLocaleDateString());
      meta.textContent = pieces.join(' · ') || 'Saved chat';
      button.appendChild(meta);
      button.onclick = function(){ openConversation(conversation.id, 'push'); };
      list.appendChild(button);
    });
  }
  var more = $('#conversation-more');
  more.classList.toggle('hidden', !conversationCursor);
  more.disabled = Boolean(conversationListLoading || activeRequest || conversationMutation || conversationLoading);
}

function updateConversationHeader(){
  var title = activeConversation ? activeConversation.title : 'New chat';
  $('#conversation-title').textContent = title;
  $('#conversation-subtitle').textContent = activeConversation
    ? 'Saved across your signed-in devices.'
    : 'Choose a conversation or start a new one.';
  $('#rename-chat').disabled = !activeConversation || Boolean(activeRequest) || Boolean(conversationMutation) || conversationLoading;
  $('#delete-chat').disabled = !activeConversation || Boolean(activeRequest) || Boolean(conversationMutation) || conversationLoading;
  renderConversationList();
}

function setChatBusy(busy){
  $('#send').disabled = busy;
  $('#model').disabled = busy;
  $('#new-chat').disabled = busy;
  $('#rename-chat').disabled = busy || !activeConversation;
  $('#delete-chat').disabled = busy || !activeConversation;
  document.querySelectorAll('.conversation-item').forEach(function(item){ item.disabled = busy; });
  $('#conversation-more').disabled = busy || conversationListLoading;
  var historyMore = $('#history-more');
  if (historyMore) historyMore.disabled = busy || olderMessagesLoading;
  $('#chat').setAttribute('aria-busy', busy ? 'true' : 'false');
}

function refreshChatBusy(){
  setChatBusy(Boolean(activeRequest || conversationMutation || conversationLoading));
}

async function runConversationMutation(operation){
  if (conversationMutation) return null;
  var mutation = Promise.resolve().then(operation);
  conversationMutation = mutation;
  refreshChatBusy();
  try {
    return await mutation;
  } finally {
    if (conversationMutation === mutation) conversationMutation = null;
    refreshChatBusy();
  }
}

function messageMetadata(value){
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string' && value) {
    try {
      var parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch(e) {}
  }
  return {};
}

function messageSearchPresentation(message){
  var metadata = messageMetadata(message.metadata);
  var webSearch = metadata.web_search && typeof metadata.web_search === 'object'
    ? metadata.web_search
    : (metadata.site_search && typeof metadata.site_search === 'object'
      ? metadata.site_search
      : (metadata.webSearch && typeof metadata.webSearch === 'object' ? metadata.webSearch : null));
  var rawSources = webSearch && Array.isArray(webSearch.sources) ? webSearch.sources
    : (Array.isArray(metadata.sources) ? metadata.sources : []);
  var sources = normaliseSources(rawSources);
  if (!webSearch && sources.length) {
    webSearch = { performed: true, provider: metadata.provider || 'web', queries: [], sources: rawSources };
  }
  return { webSearch: webSearch, sources: sources };
}

function renderConversationMessages(messages, nextBeforeSeq, preservePosition){
  var chat = $('#chat');
  var oldHeight = chat.scrollHeight;
  var oldTop = chat.scrollTop;
  chat.innerHTML = '';
  chatHistory = [];
  conversationMessages = messages.slice();
  conversationMessageCursor = nextBeforeSeq || null;
  if (!messages.length) {
    renderChatEmpty();
    return;
  }
  if (conversationMessageCursor) {
    var older = document.createElement('div');
    older.className = 'history-more';
    var olderButton = document.createElement('button');
    olderButton.className = 'btn ghost small';
    olderButton.id = 'history-more';
    olderButton.type = 'button';
    olderButton.textContent = olderMessagesLoading ? 'Loading…' : 'Load older messages';
    olderButton.disabled = olderMessagesLoading || Boolean(activeRequest) || conversationLoading;
    olderButton.onclick = loadOlderMessages;
    older.appendChild(olderButton);
    chat.appendChild(older);
  }
  messages.forEach(function(message){
    if (message.role !== 'user' && message.role !== 'assistant') return;
    var bubble = addBubble(message.role, message.content);
    chatHistory.push({ role: message.role, content: message.content });
    if (message.role === 'assistant') {
      var presentation = messageSearchPresentation(message);
      renderAssistant(bubble, message.content, presentation.sources, presentation.webSearch, false);
      if (message.status === 'pending' || message.status === 'streaming' || message.status === 'generating') {
        messageStatus(bubble, 'Response is still being prepared…', '', true);
      } else if (message.status === 'interrupted') {
        messageStatus(bubble, 'This response was interrupted. Send a new message to continue.', 'error', false);
      } else if (message.status === 'failed' || message.status === 'error') {
        messageStatus(bubble, 'This response could not be completed.', 'error', false);
      }
    }
  });
  if (preservePosition) {
    autoFollow = false;
    requestAnimationFrame(function(){
      chat.scrollTop = Math.max(0, chat.scrollHeight - oldHeight + oldTop);
      updateJumpButton();
    });
  } else {
    scrollChat(true);
  }
}

async function loadOlderMessages(){
  if (!activeConversation || !conversationMessageCursor || olderMessagesLoading || activeRequest) return;
  var id = activeConversation.id;
  var before = conversationMessageCursor;
  olderMessagesLoading = true;
  var button = $('#history-more');
  if (button) { button.disabled = true; button.textContent = 'Loading…'; }
  try {
    var detail = adaptConversationDetail(await conversationApi(
      '/admin/api/conversations/' + encodeURIComponent(id) + '?message_limit=100&before_seq=' + encodeURIComponent(before)
    ));
    if (!activeConversation || activeConversation.id !== id) return;
    var seen = new Set();
    var combined = detail.messages.concat(conversationMessages).filter(function(message){
      var key = message.id || String(message.seq) + ':' + message.role;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function(a, b){ return a.seq - b.seq || a.created_at - b.created_at; });
    renderConversationMessages(combined, detail.nextBeforeSeq, true);
  } catch(error) {
    toast(error && error.message ? error.message : 'Could not load older messages');
  } finally {
    olderMessagesLoading = false;
    var current = $('#history-more');
    if (current) { current.disabled = false; current.textContent = 'Load older messages'; }
  }
}

function conversationIdFromUrl(){
  try { return new URL(location.href).searchParams.get('conversation') || ''; }
  catch(e) { return ''; }
}

function updateConversationUrl(id, mode){
  try {
    var url = new URL(location.href);
    if (id) url.searchParams.set('conversation', id);
    else url.searchParams.delete('conversation');
    if (mode === 'push') history.pushState({ conversation: id || null }, '', url.pathname + url.search + url.hash);
    else history.replaceState({ conversation: id || null }, '', url.pathname + url.search + url.hash);
  } catch(e) {}
}

function closeConversationSidebar(){
  $('#conversation-sidebar').classList.remove('open');
  $('#conversation-toggle').setAttribute('aria-expanded', 'false');
}

function applyConversationModel(model){
  if (!model) return;
  pendingModel = model;
  if (!modelsLoaded) return;
  var option = Array.from($('#model').options).find(function(item){ return item.value === model; });
  if (option) {
    $('#model').value = model;
    pendingModel = '';
  }
}

async function openConversation(id, navigationMode){
  if (!id) return;
  if (activeRequest) {
    toast('Wait for the current response before switching conversations');
    if (activeConversation) updateConversationUrl(activeConversation.id, 'replace');
    return;
  }
  closeRenameForm();
  var token = ++conversationLoadToken;
  conversationLoading = true;
  refreshChatBusy();
  if (navigationMode) updateConversationUrl(id, navigationMode);
  renderChatNotice('Loading conversation…', 'Fetching the latest saved messages.');
  $('#conversation-title').textContent = (conversationFromList(id) || {}).title || 'Loading…';
  try {
    var detail = adaptConversationDetail(await conversationApi('/admin/api/conversations/' + encodeURIComponent(id)));
    if (token !== conversationLoadToken) return;
    if (!detail.conversation) throw new Error('Conversation data was incomplete.');
    activeConversation = detail.conversation;
    upsertConversation(activeConversation, false);
    applyConversationModel(activeConversation.last_model);
    updateConversationHeader();
    renderConversationMessages(detail.messages, detail.nextBeforeSeq, false);
    closeConversationSidebar();
  } catch(error) {
    if (token !== conversationLoadToken) return;
    activeConversation = null;
    updateConversationHeader();
    renderChatNotice(
      error && error.status === 404 ? 'Conversation not found' : 'Could not load this conversation',
      error && error.message ? error.message : 'Please try again.',
      'Retry',
      function(){ openConversation(id, 'replace'); }
    );
  } finally {
    if (token === conversationLoadToken) {
      conversationLoading = false;
      refreshChatBusy();
    }
  }
}

async function loadConversations(reset, chooseInitial, quiet){
  if (conversationListLoading) return;
  conversationListLoading = true;
  if (reset) {
    conversationCursor = null;
    if (!quiet) {
      conversations = [];
      renderConversationListState('Loading conversations…');
    }
  }
  $('#conversation-more').disabled = true;
  try {
    var path = '/admin/api/conversations?limit=30';
    if (!reset && conversationCursor) path += '&cursor=' + encodeURIComponent(conversationCursor);
    var page = adaptConversationPage(await conversationApi(path));
    if (reset && quiet) conversations = [];
    page.items.forEach(function(item){ upsertConversation(item, false); });
    conversationCursor = page.nextCursor;
    renderConversationList();
    if (chooseInitial) {
      var linked = conversationIdFromUrl();
      if (linked) {
        activatePane('chats');
        await openConversation(linked, 'replace');
      } else if (!activeConversation && conversations.length) {
        await openConversation(conversations[0].id, 'replace');
      } else if (!conversations.length) {
        activeConversation = null;
        updateConversationHeader();
        renderChatEmpty();
      }
    }
  } catch(error) {
    if (!conversations.length) {
      renderConversationListState('Could not load conversations.', 'Retry', function(){ loadConversations(true, true, false); });
    } else {
      toast('Could not refresh conversations');
    }
  } finally {
    conversationListLoading = false;
    $('#conversation-more').disabled = false;
  }
}

async function createConversation(){
  if ($('#new-chat').disabled) return null;
  try {
    var payload = {};
    if ($('#model').value) payload.model = $('#model').value;
    var created = await runConversationMutation(function(){
      return conversationApi('/admin/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    });
    var conversation = adaptConversationEnvelope(created);
    if (!conversation) throw new Error('Conversation data was incomplete.');
    activeConversation = conversation;
    chatHistory = [];
    conversationMessages = [];
    conversationMessageCursor = null;
    upsertConversation(conversation, true);
    applyConversationModel(conversation.last_model);
    updateConversationUrl(conversation.id, 'push');
    updateConversationHeader();
    renderChatEmpty();
    closeConversationSidebar();
    return conversation;
  } catch(error) {
    toast(error && error.message ? error.message : 'Could not create conversation');
    return null;
  }
}

async function syncActiveConversation(renderMessages){
  var id = activeConversation && activeConversation.id;
  if (!id) return false;
  try {
    var detail = adaptConversationDetail(await conversationApi('/admin/api/conversations/' + encodeURIComponent(id)));
    if (!activeConversation || activeConversation.id !== id || !detail.conversation) return false;
    activeConversation = detail.conversation;
    upsertConversation(activeConversation, true);
    applyConversationModel(activeConversation.last_model);
    updateConversationHeader();
    if (renderMessages) renderConversationMessages(detail.messages, detail.nextBeforeSeq, false);
    return true;
  } catch(e) {
    return false;
  }
}

async function syncFromAnotherDevice(){
  if (document.hidden || activeRequest || conversationMutation || conversationLoading) return;
  if (!$('#rename-form').classList.contains('hidden')) return;
  var now = Date.now();
  if (now - lastDeviceSync < 5000) return;
  lastDeviceSync = now;
  var before = activeConversation && {
    id: activeConversation.id,
    version: activeConversation.version,
    updated_at: activeConversation.updated_at,
    model: activeConversation.last_model
  };
  var selectedModel = $('#model').value;
  var preserveModel = Boolean(before && selectedModel && selectedModel !== before.model);
  var previousScroll = $('#chat').scrollTop;
  var preserveScroll = !autoFollow;
  await loadConversations(true, false, true);
  if (!before) return;
  var remote = conversationFromList(before.id);
  if (!remote) {
    activeConversation = null;
    chatHistory = [];
    conversationMessages = [];
    conversationMessageCursor = null;
    updateConversationUrl('', 'replace');
    updateConversationHeader();
    if (conversations.length) await openConversation(conversations[0].id, 'replace');
    else renderChatEmpty();
    toast('This conversation was deleted on another device');
    return;
  }
  if (remote.version === before.version && remote.updated_at === before.updated_at) return;
  await openConversation(before.id, null);
  if (preserveModel) {
    var option = Array.from($('#model').options).find(function(item){ return item.value === selectedModel && !item.disabled; });
    if (option) $('#model').value = selectedModel;
  }
  if (preserveScroll) {
    $('#chat').scrollTop = previousScroll;
    autoFollow = false;
    updateJumpButton();
  }
}

function loadModels(){
  fetch('/v1/models').then(function(r){ return r.json(); }).then(function(d){
    var sel = $('#model');
    var previous = pendingModel || (activeConversation && activeConversation.last_model) || sel.value;
    sel.innerHTML = '';
    (d.data || []).filter(function(m){ return m.id.indexOf('bge') === -1 && m.id.indexOf('embedding') === -1; })
      .forEach(function(m){
        var o = document.createElement('option');
        o.value = m.id;
        o.disabled = m.disabled === true;
        o.textContent = (m.provider === 'nvidia' ? 'NVIDIA · ' : '') + m.id.replace('@cf/', '')
          + (o.disabled ? ' · Cloudflare neurons exhausted' : '');
        sel.appendChild(o);
      });
    modelsLoaded = true;
    var saved = Array.from(sel.options).find(function(option){ return option.value === previous; });
    var firstEnabled = sel.querySelector('option:not([disabled])');
    if (saved) sel.value = saved.value;
    else if (firstEnabled) sel.value = firstEnabled.value;
    pendingModel = '';
  }).catch(function(){ $('#model').innerHTML = '<option value="">Models unavailable</option>'; });
}

loadModels();
loadConversations(true, true, false);

$('#conversation-more').onclick = function(){ loadConversations(false, false, false); };
$('#new-chat').onclick = function(){ createConversation(); };
$('#conversation-toggle').onclick = function(){
  var sidebar = $('#conversation-sidebar');
  var open = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  this.setAttribute('aria-expanded', open ? 'true' : 'false');
};

$('#rename-chat').onclick = function(){
  if (!activeConversation || activeRequest) return;
  $('#chat-title-copy').classList.add('hidden');
  $('#rename-form').classList.remove('hidden');
  $('#rename-title').value = activeConversation.title;
  $('#rename-title').focus();
  $('#rename-title').select();
};

function closeRenameForm(){
  $('#rename-form').classList.add('hidden');
  $('#chat-title-copy').classList.remove('hidden');
}

$('#rename-cancel').onclick = closeRenameForm;
$('#rename-form').onsubmit = async function(event){
  event.preventDefault();
  if (!activeConversation) return;
  var title = $('#rename-title').value.trim();
  if (!title) { toast('Enter a conversation title'); return; }
  var id = activeConversation.id;
  var body = { title: title };
  if (Number.isFinite(activeConversation.version)) body.expected_version = activeConversation.version;
  this.querySelectorAll('button,input').forEach(function(control){ control.disabled = true; });
  try {
    var response = await runConversationMutation(function(){
      return conversationApi('/admin/api/conversations/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    });
    var updated = adaptConversationEnvelope(response);
    if (!updated) throw new Error('Conversation data was incomplete.');
    if (activeConversation && activeConversation.id === id) activeConversation = updated;
    upsertConversation(updated, true);
    closeRenameForm();
    updateConversationHeader();
    toast('Conversation renamed');
  } catch(error) {
    toast(error && error.message ? error.message : 'Could not rename conversation');
    if (error && error.status === 409) syncActiveConversation();
  } finally {
    this.querySelectorAll('button,input').forEach(function(control){ control.disabled = false; });
  }
};

$('#delete-chat').onclick = async function(){
  if (!activeConversation || activeRequest) return;
  var conversation = activeConversation;
  if (!confirm('Delete “' + conversation.title + '” and all of its messages? This cannot be undone.')) return;
  this.disabled = true;
  try {
    await runConversationMutation(function(){
      return conversationApi('/admin/api/conversations/' + encodeURIComponent(conversation.id), { method: 'DELETE' });
    });
    conversations = conversations.filter(function(item){ return item.id !== conversation.id; });
    activeConversation = null;
    chatHistory = [];
    conversationMessages = [];
    conversationMessageCursor = null;
    updateConversationUrl('', 'replace');
    updateConversationHeader();
    if (conversations.length) await openConversation(conversations[0].id, 'replace');
    else renderChatEmpty();
    toast('Conversation deleted');
    loadConversations(true, false, true);
  } catch(error) {
    toast(error && error.message ? error.message : 'Could not delete conversation');
  } finally {
    this.disabled = !activeConversation;
  }
};

window.addEventListener('popstate', function(){
  var id = conversationIdFromUrl();
  if (id) {
    activatePane('chats');
    openConversation(id, null);
  } else {
    activeConversation = null;
    chatHistory = [];
    conversationMessages = [];
    conversationMessageCursor = null;
    updateConversationHeader();
    renderChatEmpty();
  }
});

window.addEventListener('focus', syncFromAnotherDevice);
document.addEventListener('visibilitychange', function(){
  if (!document.hidden) syncFromAnotherDevice();
});

async function send(){
  if ($('#send').disabled) return;
  var text = $('#prompt').value.trim();
  if (!text) return;
  if (!$('#model').value) { toast('Choose an available model first'); return; }
  var selectedOption = $('#model').selectedOptions && $('#model').selectedOptions[0];
  if (selectedOption && selectedOption.disabled) { toast('Choose an available model first'); return; }
  if (!activeConversation && !(await createConversation())) return;
  var conversation = activeConversation;
  if (!conversation) return;
  $('#prompt').value = ''; $('#prompt').style.height = 'auto';
  var userBubble = addBubble('user', text);
  chatHistory.push({ role: 'user', content: text });

  var out = addBubble('assistant', '');
  var acc = '';
  var sources = [];
  var webSearch = null;
  var pending = true;
  var assistantStored = false;
  var renderFrame = 0;
  var controller = new AbortController();
  var request = { controller: controller, bubble: out, conversationId: conversation.id };
  activeRequest = request;
  refreshChatBusy();
  renderAssistant(out, acc, sources, webSearch, pending);

  function scheduleRender(){
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(function(){
      renderFrame = 0;
      renderAssistant(out, acc, sources, webSearch, pending);
    });
  }

  function flushRender(){
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    renderAssistant(out, acc, sources, webSearch, pending);
  }

  function handleStreamEvent(event){
    if (event.conversation) {
      var streamedConversation = adaptConversation(event.conversation);
      if (streamedConversation && activeConversation && activeConversation.id === streamedConversation.id) {
        activeConversation = streamedConversation;
        upsertConversation(streamedConversation, true);
        updateConversationHeader();
      }
    }
    if (event.web_search) {
      webSearch = event.web_search;
      if (Array.isArray(event.web_search.sources)) sources = normaliseSources(event.web_search.sources);
      scheduleRender();
    }
    var piece = event.choices && event.choices[0] && event.choices[0].delta && event.choices[0].delta.content;
    if (typeof piece === 'string' && piece) {
      acc += piece;
      scheduleRender();
    }
  }

  try {
    var turnBody = {
      content: text,
      model: $('#model').value,
      client_turn_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      expected_version: conversation.version
    };
    var res = await fetch('/admin/api/conversations/' + encodeURIComponent(conversation.id) + '/turns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnBody),
      signal: controller.signal
    });
    if (!res.ok) {
      var errorBody = null;
      try { errorBody = await res.json(); } catch(e) {}
      var errorMessage = errorBody && ((errorBody.error && errorBody.error.message) || errorBody.message || errorBody.error);
      var responseError = new Error(typeof errorMessage === 'string' ? errorMessage : 'Request failed (' + res.status + ')');
      responseError.status = res.status;
      throw responseError;
    }
    if (!res.body) throw new Error('The response did not include a readable stream.');
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var sseDecoder = createSseDecoder(handleStreamEvent);
    while (!sseDecoder.isDone()) {
      var step = await reader.read();
      if (step.done) break;
      sseDecoder.push(dec.decode(step.value, { stream: true }));
    }
    sseDecoder.finish(dec.decode());

    pending = false;
    flushRender();
    if (acc) {
      chatHistory.push({ role: 'assistant', content: acc });
      assistantStored = true;
    }
    else messageStatus(out, 'No answer was returned.', 'error', false);
  } catch(err) {
    if (controller.signal.aborted || (err && err.name === 'AbortError')) {
      return;
    }
    pending = false;
    flushRender();
    if (acc && !assistantStored) {
      chatHistory.push({ role: 'assistant', content: acc });
      assistantStored = true;
    }
    messageStatus(out, 'Response interrupted: ' + (err && err.message ? err.message : 'Unknown error'), 'error', false);
    scrollChat(false);
    if (err && (err.status === 400 || err.status === 409)) {
      userBubble.remove();
      out.remove();
      chatHistory.pop();
      if (!$('#chat').children.length) renderChatEmpty();
    }
  } finally {
    if (activeRequest === request) {
      activeRequest = null;
      conversationLoading = true;
      refreshChatBusy();
      await syncActiveConversation(true);
      await loadConversations(true, false, true);
      conversationLoading = false;
      refreshChatBusy();
      $('#prompt').focus();
    }
  }
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
  loadModels();
}

function renderCloudflareUsageError(d){
  var setup = d && d.error === 'cloudflare_usage_not_configured';
  $('#cloudflare-usage').className = 'cf-usage ' + (setup ? 'setup' : 'error');
  $('#cloudflare-usage').innerHTML =
    '<div class="cf-usage-head"><div><div class="cf-usage-title">Cloudflare Workers AI</div>'
    + '<div class="cf-usage-sub">Neurons used today</div></div>'
    + '<div class="cf-usage-value">' + (setup ? 'Setup required' : 'Unavailable') + '</div></div>'
    + '<div class="cf-usage-note">' + esc((d && d.message) || 'Refresh to try again.') + '</div>';
  loadModels();
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
