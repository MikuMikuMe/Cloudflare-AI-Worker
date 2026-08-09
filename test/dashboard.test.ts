import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { dashboardPage, PLAYGROUND_FORMATTER_SCRIPT } from '../src/ui/dashboard.ts';

interface FormatterContext {
  createSseDecoder(onEvent: (event: Record<string, unknown>) => void): {
    push(value: string): void;
    finish(value?: string): void;
    isDone(): boolean;
  };
  normaliseSources(value: unknown): Array<{ number: number; url: string; title: string; host: string; snippet: string }>;
  renderMarkdown(value: unknown, sources: unknown[]): string;
  safeHref(value: unknown): string;
}

function formatter(): FormatterContext {
  const context = vm.createContext({ URL });
  vm.runInContext(PLAYGROUND_FORMATTER_SCRIPT, context);
  return context as unknown as FormatterContext;
}

test('chat renderer formats common Markdown and links search citations', () => {
  const format = formatter();
  const sources = format.normaliseSources([
    {
      url: 'https://www.example.com/release?from=search',
      title: 'Release notes',
      snippet: 'The official release notes.',
    },
  ]);
  const html = format.renderMarkdown(
    [
      '## Launch',
      '',
      '* **Preview** began first.',
      '* Public release followed [1†L10-L12].',
      '',
      '```ts',
      'const value = "<safe>";',
      '```',
    ].join('\n'),
    sources,
  );

  assert.match(html, /<h2>Launch<\/h2>/);
  assert.match(html, /<ul><li><strong>Preview<\/strong> began first\.<\/li>/);
  assert.match(html, /class="citation"/);
  assert.match(html, /href="https:\/\/www\.example\.com\/release\?from=search"/);
  assert.match(html, />\[1\]<\/a>/);
  assert.match(html, /<pre><span class="code-lang">ts<\/span><code/);
  assert.match(html, /&lt;safe&gt;/);
});

test('chat renderer turns full-width search citations into compact source links', () => {
  const format = formatter();
  const sources = format.normaliseSources([
    { url: 'https://example.com/preview', title: 'Preview announcement' },
    { url: 'https://example.com/release', title: 'Public release' },
  ]);
  const html = format.renderMarkdown(
    'Previewed in June【1†L1-L3】【2†L7-L11】; unknown source 【3†L2】.',
    sources,
  );

  assert.doesNotMatch(html, /【\d+†L/);
  assert.doesNotMatch(html, /†/);
  assert.equal((html.match(/class="citation"/g) || []).length, 3);
  assert.match(html, /<\/a><a class="citation"/);
  assert.match(html, /href="https:\/\/example\.com\/preview"[^>]*>\[1\]<\/a>/);
  assert.match(html, /title="Source 1: Preview announcement · cited passage L1-L3"/);
  assert.match(html, /href="https:\/\/example\.com\/release"[^>]*>\[2\]<\/a>/);
  assert.match(html, /aria-label="Source 2: Public release · cited passage L7-L11"/);
  assert.match(html, /<span class="citation" title="Source 3 · cited passage L2">\[3\]<\/span>/);
});

test('chat renderer accepts paired full-width brackets and digits without rewriting plain text', () => {
  const format = formatter();
  const sources = format.normaliseSources([
    { url: 'https://example.com/preview', title: 'Preview announcement' },
    { url: 'https://example.com/release', title: 'Public release' },
    { url: 'https://example.com/notes', title: 'Release notes' },
  ]);
  const html = format.renderMarkdown(
    [
      'Full-width digits \u3010\uFF11\u3011.',
      'Full-width square brackets \uFF3B2\u2020L3-L4\uFF3D.',
      'ASCII citation [3].',
      'Plain label 【release note】.',
      'Plain label \uFF3Brelease note\uFF3D.',
    ].join(' '),
    sources,
  );

  assert.equal((html.match(/class="citation"/g) || []).length, 3);
  assert.match(html, /href="https:\/\/example\.com\/preview"[^>]*>\[1\]<\/a>/);
  assert.match(html, /href="https:\/\/example\.com\/release"[^>]*>\[2\]<\/a>/);
  assert.match(html, /title="Source 2: Public release · cited passage L3-L4"/);
  assert.match(html, /href="https:\/\/example\.com\/notes"[^>]*>\[3\]<\/a>/);
  assert.match(html, /【release note】/);
  assert.match(html, /\uFF3Brelease note\uFF3D/);
});

test('chat renderer escapes model HTML and rejects unsafe links', () => {
  const format = formatter();
  const html = format.renderMarkdown(
    '<img src=x onerror=alert(1)> [bad](javascript:alert(1)) https://safe.example/path',
    [],
  );

  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /href="https:\/\/safe\.example\/path"/);
  assert.equal(format.safeHref('data:text/html,boom'), '');
  assert.equal(format.safeHref('javascript:alert(1)'), '');
});

test('SSE decoder handles fragmented events and requires a completion sentinel', () => {
  const format = formatter();
  const events: Array<Record<string, unknown>> = [];
  const decoder = format.createSseDecoder((event) => events.push(event));

  decoder.push('da');
  decoder.push('ta: {"choices":[{"delta":{"content":"Hello"}}]}\r');
  decoder.push('\n\r\ndata: [DO');
  decoder.push('NE]\n\n');
  decoder.finish();

  assert.equal(decoder.isDone(), true);
  assert.equal(JSON.stringify(events), '[{"choices":[{"delta":{"content":"Hello"}}]}]');

  const truncated = format.createSseDecoder(() => undefined);
  truncated.push('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  assert.throws(() => truncated.finish(), /ended before completion/i);

  const errored = format.createSseDecoder(() => undefined);
  assert.throws(
    () => errored.push('data: {"error":{"message":"upstream failed"}}\n\n'),
    /upstream failed/i,
  );
});

test('source normalization preserves citation ordinals and strips embedded credentials', () => {
  const format = formatter();
  const sources = format.normaliseSources([
    { url: 'javascript:alert(1)', title: 'Unsafe' },
    { url: 'https://user:secret@example.com/page', title: '' },
    { url: 'https://example.com/page', title: 'Duplicate' },
  ]);

  assert.equal(sources.length, 2);
  assert.equal(sources[0].url, 'https://example.com/page');
  assert.equal(sources[0].title, 'example.com');
  assert.equal(sources[0].host, 'example.com');
  assert.deepEqual(Array.from(sources, (source) => source.number), [2, 3]);

  const citation = format.renderMarkdown('Unsafe [1], valid [2].', sources);
  assert.match(citation, /<span class="citation"[^>]*>\[1\]<\/span>/);
  assert.match(citation, /class="citation"/);
  assert.match(citation, /href="https:\/\/example\.com\/page"/);
});

test('dashboard serves rich answer presentation instead of a plain-text search footer', () => {
  const dashboard = dashboardPage('user@example.com', 'example.cloudflareaccess.com');

  assert.match(dashboard, /function renderMarkdown/);
  assert.match(dashboard, /Searched the web/);
  assert.match(dashboard, /className = 'source-link'/);
  assert.match(dashboard, /class="jump-latest"/);
  assert.match(dashboard, /response stream ended before completion/i);
  assert.match(dashboard, /if \(acc && !assistantStored\)/);
  assert.match(dashboard, /controller\.signal\.aborted/);
  assert.doesNotMatch(dashboard, /var footer = 'Web search:/);
});

test('dashboard exposes persistent Chats navigation and conversation API actions', () => {
  const dashboard = dashboardPage('user@example.com', 'example.cloudflareaccess.com');

  assert.match(dashboard, /class="tab on" id="tab-chats"[^>]+aria-selected="true"[^>]+data-pane="chats">Chats</);
  assert.match(dashboard, /class="pane on" id="pane-chats"/);
  assert.match(dashboard, /event\.key === 'ArrowRight'/);
  assert.match(dashboard, /class="conversation-sidebar"/);
  assert.match(dashboard, /Loading conversations…/);
  assert.match(dashboard, /No saved conversations yet/);
  assert.match(dashboard, /Could not load conversations/);
  assert.match(dashboard, /\/admin\/api\/conversations\?limit=30/);
  assert.match(dashboard, /\/admin\/api\/conversations\//);
  assert.match(dashboard, /\/turns/);
  assert.match(dashboard, /client_turn_id/);
  assert.match(dashboard, /expected_version/);
  assert.match(dashboard, /last_model/);
  assert.match(dashboard, /payload\.model = \$\('#model'\)\.value/);
  assert.match(dashboard, /runConversationMutation/);
  assert.match(dashboard, /conversationLoading/);
  assert.match(dashboard, /button\.disabled = Boolean\(activeRequest \|\| conversationMutation \|\| conversationLoading\)/);
  assert.match(dashboard, /Load older messages/);
  assert.match(dashboard, /\?message_limit=100&before_seq=/);
  assert.match(dashboard, /await syncActiveConversation\(true\)/);
  assert.match(dashboard, /history\.pushState/);
  assert.match(dashboard, /searchParams\.get\('conversation'\)/);
  assert.match(dashboard, /normaliseSources\(rawSources\)/);
  assert.match(dashboard, /metadata\.site_search/);
  assert.match(dashboard, /window\.addEventListener\('focus', syncFromAnotherDevice\)/);
  assert.match(dashboard, /visibilitychange/);
  assert.doesNotMatch(dashboard, />Playground</);
  assert.doesNotMatch(dashboard, /\/admin\/api\/chat\/completions/);
  assert.doesNotMatch(dashboard, /body = \{ last_model:/);
});

test('dashboard emits syntactically valid browser JavaScript', () => {
  const dashboard = dashboardPage('user@example.com', 'example.cloudflareaccess.com');
  const script = /<script>([\s\S]*)<\/script>/.exec(dashboard)?.[1];

  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
});
