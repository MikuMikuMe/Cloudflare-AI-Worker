/** Public landing page: API docs + a way in. Contains nothing sensitive. */

const STYLES = `
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0b0d12;--panel:#141821;--panel2:#1b2130;--line:#252c3b;--fg:#e6e9ef;--muted:#8b93a7;--accent:#f6821f;--accent2:#5b8cff}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6}
  .wrap{max-width:880px;margin:0 auto;padding:56px 24px 80px}
  header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:40px}
  .brand{display:flex;align-items:center;gap:12px}
  .logo{width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#ffb457);display:grid;place-items:center;font-weight:800;color:#231400}
  h1{font-size:20px;font-weight:650;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:13px}
  .btn{display:inline-block;padding:10px 18px;border-radius:9px;background:var(--accent);color:#231400;font-weight:650;text-decoration:none;font-size:14px;border:none;cursor:pointer}
  .btn:hover{filter:brightness(1.08)}
  .hero{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:28px;margin-bottom:28px}
  .hero h2{font-size:26px;letter-spacing:-.02em;margin-bottom:10px}
  .hero p{color:var(--muted);max-width:60ch}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:28px 0}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
  .card h3{font-size:14px;margin-bottom:6px}
  .card p{font-size:13px;color:var(--muted)}
  h4{margin:30px 0 10px;font-size:15px}
  pre{background:#080a0e;border:1px solid var(--line);border-radius:11px;padding:16px;overflow-x:auto;font-size:12.5px;line-height:1.65}
  code{font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace}
  .tag{display:inline-block;background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:999px;padding:3px 10px;font-size:11.5px;margin-right:6px}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:8px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td code{color:var(--accent2)}
  footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
`;

export function landingPage(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cloudflare AI Worker — OpenAI-compatible API</title>
<style>${STYLES}</style>
</head><body><div class="wrap">

<header>
  <div class="brand">
    <div class="logo">AI</div>
    <div><h1>Cloudflare AI Worker</h1><div class="sub">OpenAI-compatible gateway on Workers AI</div></div>
  </div>
  <a class="btn" href="/admin">Sign in &rarr;</a>
</header>

<div class="hero">
  <h2>Drop-in OpenAI API, running on the edge</h2>
  <p>Point any OpenAI SDK at this host, use a key you minted yourself, and you're done. Streaming, embeddings, model listing and opt-in web search all fit the OpenAI chat-completions shape.</p>
  <div style="margin-top:16px">
    <span class="tag">SSE streaming</span><span class="tag">Opt-in web search</span><span class="tag">Cloudflare Access SSO</span><span class="tag">Self-service keys</span><span class="tag">Usage tracking</span>
  </div>
</div>

<div class="grid">
  <div class="card"><h3>Sign in with Cloudflare</h3><p>The dashboard sits behind Cloudflare Access. No shared password, no bootstrap API key.</p></div>
  <div class="card"><h3>Mint your own keys</h3><p>Create, name and revoke keys yourself. Only SHA-256 hashes are ever stored.</p></div>
  <div class="card"><h3>Know what you spent</h3><p>Per-key request and token counters, so a runaway script is obvious.</p></div>
</div>

<h4>Endpoints</h4>
<table>
  <tr><th>Method</th><th>Path</th><th>Purpose</th></tr>
  <tr><td>GET</td><td><code>/v1/models</code></td><td>List available models</td></tr>
  <tr><td>POST</td><td><code>/v1/chat/completions</code></td><td>Chat, streaming, buffered or opt-in web search</td></tr>
  <tr><td>POST</td><td><code>/v1/embeddings</code></td><td>Text embeddings</td></tr>
  <tr><td>GET</td><td><code>/health</code></td><td>Liveness probe</td></tr>
</table>

<h4>Python</h4>
<pre><code>from openai import OpenAI

client = OpenAI(
    api_key="sk-cfai-...",
    base_url="${origin}/v1",
)

stream = client.chat.completions.create(
    model="@cf/meta/llama-3.1-8b-instruct-fp8",
    messages=[{"role": "user", "content": "Explain edge computing in one line."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")</code></pre>

<h4>Node.js</h4>
<pre><code>import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-cfai-...",
  baseURL: "${origin}/v1",
});

const stream = await client.chat.completions.create({
  model: "@cf/meta/llama-3.1-8b-instruct-fp8",
  messages: [{ role: "user", content: "Explain edge computing in one line." }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}</code></pre>

<h4>curl</h4>
<pre><code>curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer sk-cfai-..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"@cf/meta/llama-3.1-8b-instruct-fp8","messages":[{"role":"user","content":"Hi"}],"stream":true}'</code></pre>

<h4>Opt-in web search</h4>
<pre><code>curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer sk-cfai-..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"@cf/meta/llama-3.1-8b-instruct-fp8","messages":[{"role":"user","content":"What is on my website?"}],"web_search":true,"stream":true}'</code></pre>

<footer>Powered by Cloudflare Workers AI · Keys are hashed with SHA-256 and never stored in plaintext</footer>
</div></body></html>`;
}
