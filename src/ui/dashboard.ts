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
  select option:disabled{color:#667085;background:#11151d}
  select:focus,input:focus,textarea:focus{outline:none;border-color:var(--accent2)}
  .chat-wrap{position:relative;margin-bottom:12px}
  .chat{background:var(--panel);border:1px solid var(--line);border-radius:12px;height:clamp(420px,58vh,640px);overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:14px}
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
  @media(max-width:700px){
    main{padding:20px 12px 50px}.top,.tabs{padding-left:14px;padding-right:14px}
    #pane-play>.row>div:last-child{width:100%;flex-wrap:wrap}#model{min-width:0;flex:1}
    .chat{height:55vh;padding:12px}.msg{max-width:94%}.msg.assistant{width:97%;max-width:97%;padding:12px 13px}
    .search-details{padding-left:0}.composer .btn{padding-left:13px;padding-right:13px}
  }
`;

/**
 * Small, dependency-free Markdown subset for the authenticated playground.
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
    result.push({
      number: index + 1,
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

    if (text.charAt(i) === '[') {
      var labelEnd = text.indexOf(']', i + 1);
      if (labelEnd > i + 1) {
        var label = text.slice(i + 1, labelEnd);
        if (text.charAt(labelEnd + 1) === '(') {
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

        var citation = /^(\d+)(?:\s*†\s*(.+))?$/.exec(label);
        if (citation) {
          var number = Number(citation[1]);
          var source = number > 0
            ? sourceList.find(function(item){ return item && item.number === number; })
            : null;
          var citationLabel = '[' + number + ']';
          var citationTitle = source
            ? 'Source ' + number + ': ' + source.title
            : 'Source ' + number;
          if (citation[2]) citationTitle += ' (' + citation[2] + ')';
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
        <span class="search-status" title="The selected model can call server-managed web tools when needed">Web tools automatic</span>
        <button class="btn ghost" id="clear">Clear</button>
      </div>
    </div>
    <div class="chat-wrap">
      <div class="chat" id="chat" role="log" aria-live="polite" aria-relevant="additions text">
        <div class="chat-empty"><b>Start a conversation</b>Answers can include formatted text, code, and cited web sources.</div>
      </div>
      <button class="jump-latest" id="jump-latest" type="button" aria-label="Jump to the latest message">↓ Latest</button>
    </div>
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

${PLAYGROUND_FORMATTER_SCRIPT}

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
var chatHistory = [];
var activeRequest = null;
var autoFollow = true;

function renderChatEmpty(){
  $('#chat').innerHTML = '<div class="chat-empty"><b>Start a conversation</b>Answers can include formatted text, code, and cited web sources.</div>';
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
  var empty = $('#chat .chat-empty');
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

function loadModels(){
  fetch('/v1/models').then(function(r){ return r.json(); }).then(function(d){
  var sel = $('#model');
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
  var firstEnabled = sel.querySelector('option:not([disabled])');
  if (firstEnabled) sel.value = firstEnabled.value;
  }).catch(function(){ $('#model').innerHTML = '<option value="">Models unavailable</option>'; });
}

loadModels();

$('#clear').onclick = function(){
  if (activeRequest) activeRequest.controller.abort();
  activeRequest = null;
  chatHistory = [];
  autoFollow = true;
  renderChatEmpty();
  $('#send').disabled = false;
  $('#model').disabled = false;
  $('#chat').setAttribute('aria-busy', 'false');
  updateJumpButton();
};

async function send(){
  if ($('#send').disabled) return;
  var text = $('#prompt').value.trim();
  if (!text) return;
  if (!$('#model').value) { toast('Choose an available model first'); return; }
  $('#prompt').value = ''; $('#prompt').style.height = 'auto';
  addBubble('user', text);
  chatHistory.push({ role: 'user', content: text });

  var out = addBubble('assistant', '');
  var acc = '';
  var sources = [];
  var webSearch = null;
  var pending = true;
  var assistantStored = false;
  var renderFrame = 0;
  var controller = new AbortController();
  var request = { controller: controller, bubble: out };
  activeRequest = request;
  $('#send').disabled = true;
  $('#model').disabled = true;
  $('#chat').setAttribute('aria-busy', 'true');
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
    var res = await fetch('/admin/api/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: $('#model').value, messages: chatHistory, stream: true }),
      signal: controller.signal
    });
    if (!res.ok) {
      var errorBody = null;
      try { errorBody = await res.json(); } catch(e) {}
      var errorMessage = errorBody && ((errorBody.error && errorBody.error.message) || errorBody.message || errorBody.error);
      throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Request failed (' + res.status + ')');
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
    if (controller.signal.aborted || (err && err.name === 'AbortError')) return;
    pending = false;
    flushRender();
    if (acc && !assistantStored) {
      chatHistory.push({ role: 'assistant', content: acc });
      assistantStored = true;
    }
    messageStatus(out, 'Response interrupted: ' + (err && err.message ? err.message : 'Unknown error'), 'error', false);
    scrollChat(false);
  } finally {
    if (activeRequest === request) {
      activeRequest = null;
      $('#send').disabled = false;
      $('#model').disabled = false;
      $('#chat').setAttribute('aria-busy', 'false');
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
