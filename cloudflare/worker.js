// Cloudflare Worker prototype: same-origin OAuth code + PKCE and Drive proxy.
// Not deployed. Required bindings: DB, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// TOKEN_ENCRYPTION_KEY (32 random bytes, base64), PUBLIC_ORIGIN.
// Set secrets only via Cloudflare secrets; never in Git or Vite.
const enc = new TextEncoder();
const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
const pkce = async verifier => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const fail = (status, error) => json({error}, status);
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = name => cookie(name, '', 0);
const parseCookies = req => Object.fromEntries((req.headers.get('Cookie') || '').split(';').map(p => p.trim().split('=')).filter(x => x.length === 2));
const origin = env => new URL(env.PUBLIC_ORIGIN).origin;
const callbackUrl = env => origin(env) + '/api/auth/google/callback';
const assertConfig = env => {
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.PUBLIC_ORIGIN) throw new Error('Server is not configured');
  const u = new URL(env.PUBLIC_ORIGIN);
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.origin !== env.PUBLIC_ORIGIN) throw new Error('Invalid PUBLIC_ORIGIN');
};
async function aesKey(env) {
  const raw = Uint8Array.from(atob(env.TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function seal(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await aesKey(env), enc.encode(plain)));
  return b64url(iv) + '.' + b64url(encrypted);
}
function unb64url(s) {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4, '=')), c => c.charCodeAt(0));
}
async function unseal(env, value) {
  const [iv, encrypted] = value.split('.');
  if (!iv || !encrypted) throw new Error('Invalid encrypted token');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64url(iv)}, await aesKey(env), unb64url(encrypted)));
}
async function exchange(env, data) {
  const response = await fetch('https://oauth2.googleapis.com/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
  if (!response.ok) throw new Error('Google token exchange failed');
  return response.json();
}
async function session(req, env) {
  const sid = parseCookies(req).pc_session;
  if (!sid || !/^[A-Za-z0-9_-]{40,60}$/.test(sid)) return null;
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE session_hash = ? AND expires_at > ?').bind(await sha(sid),Date.now()).first();
  return row || null;
}
async function accessToken(env, row) {
  const refresh = await unseal(env, row.encrypted_refresh_token);
  const t = await exchange(env,{client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'});
  if (!t.access_token) throw new Error('Google refresh failed');
  if (t.refresh_token) {
    await env.DB.prepare('UPDATE sessions SET encrypted_refresh_token = ? WHERE session_hash = ?').bind(await seal(env,t.refresh_token),row.session_hash).run();
  }
  return t.access_token;
}
function checkMutationOrigin(req, env) {
  const supplied = req.headers.get('Origin');
  return supplied === origin(env);
}
async function route(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (path === '/api/auth/google/start' && req.method === 'GET') {
    const state = random(), verifier = random(), challenge = await pkce(verifier);
    await env.DB.prepare('INSERT INTO oauth_flows(state_hash,verifier,created_at) VALUES(?,?,?)').bind(await sha(state),verifier,Date.now()).run();
    const params = new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callbackUrl(env),response_type:'code',scope:'openid email https://www.googleapis.com/auth/drive.file',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
    return new Response(null,{status:302,headers:{Location:'https://accounts.google.com/o/oauth2/v2/auth?'+params,'Set-Cookie':cookie('pc_oauth_state',state,600),'Cache-Control':'no-store'}});
  }
  if (path === '/api/auth/google/callback' && req.method === 'GET') {
    const state = url.searchParams.get('state'), code = url.searchParams.get('code'), expected = parseCookies(req).pc_oauth_state;
    if (!state || !code || !expected || state !== expected) return fail(400,'Invalid OAuth state');
    const stateHash = await sha(state);
    const flow = await env.DB.prepare('DELETE FROM oauth_flows WHERE state_hash = ? AND created_at > ? RETURNING verifier').bind(stateHash,Date.now()-600000).first();
    if (!flow) return fail(400,'OAuth flow expired or reused');
    const t = await exchange(env,{client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:flow.verifier,redirect_uri:callbackUrl(env),grant_type:'authorization_code'});
    if (!t.access_token || !t.refresh_token) return fail(400,'Google did not issue offline access; reconnect with consent');
    const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+t.access_token}});
    if (!identityResponse.ok) return fail(502,'Google identity verification failed');
    const identity = await identityResponse.json();
    if (!identity.sub || !identity.email || identity.email_verified !== true) return fail(400,'Google identity incomplete');
    const sid = random(), sidHash = await sha(sid);
    await env.DB.prepare('INSERT INTO sessions(session_hash,google_sub,email,encrypted_refresh_token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(sidHash,identity.sub,identity.email,await seal(env,t.refresh_token),Date.now()+30*86400000,Date.now()).run();
    const headers = new Headers({Location:origin(env)+'/','Cache-Control':'no-store'});
    headers.append('Set-Cookie',cookie('pc_session',sid,30*86400));
    headers.append('Set-Cookie',clearCookie('pc_oauth_state'));
    return new Response(null,{status:303,headers});
  }
  if (path === '/api/session' && req.method === 'GET') {
    const s = await session(req,env);
    return json(s ? {signedIn:true,email:s.email,accountId:s.google_sub} : {signedIn:false});
  }
  if (path === '/api/session/logout' && req.method === 'POST') {
    if (!checkMutationOrigin(req,env)) return fail(403,'Origin rejected');
    const s = await session(req,env);
    if (s) await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(s.session_hash).run();
    return json({signedIn:false},200,{'Set-Cookie':clearCookie('pc_session')});
  }
  if (path === '/api/drive' && ['GET','POST','PATCH'].includes(req.method)) {
    if (req.method !== 'GET' && !checkMutationOrigin(req,env)) return fail(403,'Origin rejected');
    const s = await session(req,env);
    if (!s) return fail(401,'Sign in required');
    // Strict allowlist: only the exact Google Drive endpoints used by Prompt Cloud.
    const kind = url.searchParams.get('kind'), id = url.searchParams.get('id');
    const validId = id && /^[A-Za-z0-9_-]{10,200}$/.test(id);
    let target, method = req.method;
    if (kind === 'list' && method === 'GET') {
      const q = encodeURIComponent("name = 'prompt-cloud-sync-v1.json' and trashed = false");
      target = 'https://www.googleapis.com/drive/v3/files?spaces=drive&q='+q+'&fields=nextPageToken,files(id,name,modifiedTime)&page_size=100';
    } else if (kind === 'read' && validId && method === 'GET') target = 'https://www.googleapis.com/drive/v3/files/'+id+'?alt=media';
    else if (kind === 'create' && method === 'POST') target = 'https://www.googleapis.com/drive/v3/files?fields=id';
    else if (kind === 'archive' && validId && method === 'POST') target = 'https://www.googleapis.com/drive/v3/files/'+id+'/copy?fields=id';
    else if (kind === 'upload' && validId && method === 'PATCH') target = 'https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=media';
    else return fail(400,'Unsupported Drive operation');
    const contentLength = Number(req.headers.get('Content-Length') || 0);
    if (contentLength > 20*1024*1024) return fail(413,'Request too large for this preview backend');
    const body = method === 'GET' ? undefined : await req.text();
    if (body && body.length > 20*1024*1024) return fail(413,'Request too large');
    if (kind === 'create' && body !== JSON.stringify({name:'prompt-cloud-sync-v1.json',mimeType:'application/json'})) return fail(400,'Invalid create request');
    if (kind === 'archive') {
      try {const obj=JSON.parse(body);if(!/^prompt-cloud-recovery-[0-9TZ-]+\.json$/.test(obj.name))return fail(400,'Invalid archive name');}
      catch{return fail(400,'Invalid archive request');}
    }
    const token = await accessToken(env,s);
    const response = await fetch(target,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body,redirect:'manual'});
    const payload = await response.arrayBuffer();
    return new Response(payload,{status:response.status,headers:{'Content-Type':response.headers.get('Content-Type') || 'application/json','Cache-Control':'no-store'}});
  }
  return fail(404,'Not found');
}
export default {
  async fetch(req,env) {
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { assertConfig(env); return await route(req,env); }
    catch (err) { console.error('OAuth backend request failed',err instanceof Error ? err.message : 'unknown'); return fail(500,'Server operation failed'); }
  }
};
