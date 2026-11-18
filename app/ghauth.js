// GitHub credentials. Two kinds, both kept in wh:keys and never exported:
//   keys.github  a personal access token pasted by the user (used as is)
//   keys.ghapp   {appId, pem}: a GitHub App's id and private key. Each request
//                gets an installation token minted for exactly the repository it
//                touches, with only the permission the call needs, valid one
//                hour. Commits made with it are attributed to the app's bot.
// There is no API for creating personal access tokens; App installation tokens
// are the only kind a program can mint. api.github.com allows the mint call from
// a page, so this runs client-side.

const API = 'https://api.github.com';
export const PERMS = { read: { contents: 'read' }, write: { contents: 'write' }, pr: { contents: 'read', pull_requests: 'write' } };

// ---- RS256 JWT from the PEM GitHub hands out (PKCS#1 "RSA PRIVATE KEY", or PKCS#8) ----
const derLen = n => { if (n < 128) return [n]; const b = []; while (n) { b.unshift(n & 255); n >>>= 8; } return [0x80 | b.length, ...b]; };
const der = (tag, bytes) => new Uint8Array([tag, ...derLen(bytes.length), ...bytes]);
const RSA_ALG = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
function pkcs8(pem) {
  const body = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), c => c.charCodeAt(0));
  if (!/BEGIN RSA PRIVATE KEY/.test(pem)) return body; // already PKCS#8
  return der(0x30, [0x02, 0x01, 0x00, ...RSA_ALG, ...der(0x04, body)]);
}
const b64u = b => btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function appJwt({ appId, pem }) {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const data = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  return data + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data)));
}

// keys() -> state.keys. trace: optional array for request records (no secrets in them).
export function auth(keys, trace) {
  const minted = new Map(); // `${repo}|${level}` -> {token, until}
  const installs = new Map(); // repo -> installation id
  async function req(method, path, bearer, body) {
    const t0 = performance.now();
    const rec = { t: new Date().toISOString(), url: API + path, request: { method, body }, status: 0, chunks: [] };
    trace?.push(rec);
    try {
      const r = await fetch(API + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + bearer, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      rec.status = r.status;
      const j = await r.json().catch(() => null);
      rec.chunks.push([Math.round(performance.now() - t0), JSON.stringify(j && j.token ? { ...j, token: '[minted]' } : j)]);
      if (!r.ok) throw new Error(`GitHub ${r.status}: ${j?.message || ''}`);
      return j;
    } catch (e) { rec.error = String(e.message || e); throw e; }
    finally { rec.ms = Math.round(performance.now() - t0); }
  }
  const app = () => { const a = keys().ghapp; return a?.appId && a?.pem ? a : null; };
  async function installation(repo) {
    if (installs.has(repo)) return installs.get(repo);
    const j = await req('GET', `/repos/${repo}/installation`, await appJwt(app()));
    installs.set(repo, j.id);
    return j.id;
  }
  return {
    mode: () => app() ? 'app' : keys().github ? 'token' : null,
    // a token for one repository and one level (read | write | pr)
    async token(repo, level = 'read') {
      if (!app()) return keys().github || '';
      if (!repo) throw new Error('an app token is minted per repository; this call names none');
      const k = repo + '|' + level, hit = minted.get(k);
      if (hit && hit.until > Date.now() + 5 * 60e3) return hit.token;
      const j = await req('POST', `/app/installations/${await installation(repo)}/access_tokens`, await appJwt(app()), { repositories: [repo.split('/')[1]], permissions: PERMS[level] || PERMS.read });
      minted.set(k, { token: j.token, until: Date.parse(j.expires_at) });
      return j.token;
    },
    // every secret this holds, for redaction
    secrets: () => [keys().github, app()?.pem, ...[...minted.values()].map(m => m.token)].filter(Boolean),
    async whoami() {
      if (app()) { const a = await req('GET', '/app', await appJwt(app())); return `app ${a.slug} (installed on ${a.installations_count ?? '?'} accounts)`; }
      return 'signed in as ' + (await req('GET', '/user', keys().github)).login;
    },
  };
}
