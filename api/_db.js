// 솔로몬 법정 · 공용 저장소 모듈
//
// Supabase(Postgres)를 REST API(PostgREST)로 씁니다. npm 의존성이 필요 없어서
// "의존성 없는 저장소" 원칙을 그대로 유지합니다.
// 하위 호환으로 Upstash Redis(REST)도 계속 지원합니다 — 둘 중 있는 것을 자동으로 씁니다.
//
// 필요한 환경변수 (Vercel → Settings → Environment Variables, 설정 후 재배포)
//   SUPABASE_URL                 예: https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service_role 키 (서버에서만 씁니다. HTML에 절대 넣지 마세요)
//   TEACHER_PIN                  교사용 PIN — 단계 열기와 결과 조회에 필요
//
// 필요한 테이블 (Supabase → SQL Editor 에서 한 번 실행)
//   create table if not exists solomon_gate (
//     code text primary key,
//     stage int not null default 0,
//     updated_at timestamptz not null default now()
//   );
//   create table if not exists solomon_results (
//     code text not null,
//     name text not null,
//     team text,
//     data jsonb not null default '{}',
//     saved_at timestamptz not null default now(),
//     primary key (code, name)
//   );
//   -- service_role 키로만 접근하므로 RLS 를 켜 두는 편이 안전합니다(정책 없이 켜면 외부 차단)
//   alter table solomon_gate enable row level security;
//   alter table solomon_results enable row level security;

const SB_URL_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const SB_KEY_KEYS = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY'];
const RD_URL_KEYS = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'];
const RD_TOKEN_KEYS = ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'];
const HINT_KEYS = ['REDIS_URL', 'KV_URL', 'POSTGRES_URL', 'DATABASE_URL'];

const pick = keys => keys.map(k => process.env[k]).find(Boolean);

function supa() {
  const url = pick(SB_URL_KEYS);
  const key = pick(SB_KEY_KEYS);
  return url && key && /^https?:\/\//.test(url) ? { url: url.replace(/\/+$/, ''), key: key } : null;
}
function redis() {
  const url = pick(RD_URL_KEYS);
  const token = pick(RD_TOKEN_KEYS);
  return url && token && /^https?:\/\//.test(url) ? { url: url, token: token } : null;
}

function backend() {
  if (supa()) return 'supabase';
  if (redis()) return 'redis';
  return null;
}

// 앞뒤 공백 제거 후 n자로 자르고, 홑화살괄호만 제거(XSS 방지)
function clean(s, n) {
  return String(s == null ? '' : s).trim().slice(0, n).replace(/[<>]/g, '');
}

// 길이가 달라도 같은 시간이 걸리게 비교 (PIN 추측 난이도를 낮추지 않기 위해)
function pinOk(given) {
  const want = process.env.TEACHER_PIN || '';
  if (!want) return false;
  const a = String(given == null ? '' : given);
  if (a.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= a.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// ---------- Supabase REST ----------
async function sbFetch(path, init) {
  const s = supa();
  const r = await fetch(s.url + '/rest/v1/' + path, Object.assign({}, init, {
    headers: Object.assign({
      apikey: s.key,
      Authorization: 'Bearer ' + s.key,
      'Content-Type': 'application/json',
    }, (init && init.headers) || {}),
  }));
  if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---------- Upstash Redis REST ----------
async function rdFetch(cmds) {
  const e = redis();
  const r = await fetch(e.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + e.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}

// ================= 진도 잠금 =================

async function getStage(code) {
  if (supa()) {
    const rows = await sbFetch('solomon_gate?select=stage&code=eq.' + encodeURIComponent(code) + '&limit=1');
    return rows && rows[0] ? (parseInt(rows[0].stage, 10) || 0) : 0;
  }
  const out = await rdFetch([['GET', 'solomon:gate:' + code]]);
  return parseInt(out && out[0] && out[0].result, 10) || 0;
}

async function setStage(code, stage) {
  if (supa()) {
    await sbFetch('solomon_gate', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ code: code, stage: stage, updated_at: new Date().toISOString() }),
    });
    return;
  }
  const key = 'solomon:gate:' + code;
  await rdFetch([['SET', key, String(stage)], ['EXPIRE', key, 60 * 60 * 12]]);
}

// ================= 결과 =================

async function putResult(code, row) {
  if (supa()) {
    await sbFetch('solomon_results', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        code: code, name: row.name, team: row.team,
        data: row.data, saved_at: new Date().toISOString(),
      }),
    });
    return;
  }
  const key = 'solomon:class:' + code;
  await rdFetch([['HSET', key, row.name, JSON.stringify(row)], ['EXPIRE', key, 60 * 60 * 24 * 90]]);
}

async function listResults(code) {
  if (supa()) {
    const rows = await sbFetch('solomon_results?select=name,team,data,saved_at&code=eq.' +
      encodeURIComponent(code) + '&order=saved_at.desc&limit=500');
    return (rows || []).map(r => ({
      name: r.name, team: r.team || null,
      savedAt: r.saved_at ? Date.parse(r.saved_at) : null, data: r.data || {},
    }));
  }
  const out = await rdFetch([['HGETALL', 'solomon:class:' + code]]);
  const flat = (out && out[0] && out[0].result) || [];
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) {
    try { rows.push(JSON.parse(flat[i + 1])); } catch (e) { /* 손상된 행은 건너뛴다 */ }
  }
  return rows;
}

// ================= 설정 진단 =================
// 값은 절대 내보내지 않고, 어떤 변수가 들어와 있는지 이름만 알려준다
function diag() {
  const seen = k => !!process.env[k];
  const all = SB_URL_KEYS.concat(SB_KEY_KEYS, RD_URL_KEYS, RD_TOKEN_KEYS, HINT_KEYS);
  const be = backend();
  let hint;
  if (!be) {
    hint = HINT_KEYS.some(seen)
      ? 'DB 는 연결돼 있지만 REST 로 쓸 수 있는 주소·키가 없습니다. Supabase 라면 SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 등록하세요.'
      : 'Supabase 의 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 환경변수에 등록한 뒤 재배포하세요.';
  } else if (!process.env.TEACHER_PIN) {
    hint = '환경변수 TEACHER_PIN 을 설정한 뒤 재배포하세요.';
  } else {
    hint = '정상입니다.';
  }
  return { db: !!be, backend: be, teacherPin: seen('TEACHER_PIN'), found: all.filter(seen), hint: hint };
}

// 공통 응답 헤더 + 사전요청 처리. 처리를 끝냈으면 true 를 돌려준다
function prelude(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
}

module.exports = {
  backend, clean, pinOk, diag, prelude, body,
  getStage, setStage, putResult, listResults,
};
