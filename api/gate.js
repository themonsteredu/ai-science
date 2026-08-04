// 솔로몬 법정 · 수업코드별 진도 잠금(게이트) API
// 교사가 단계를 열면 그 수업코드로 접속한 학생 화면이 모두 함께 열립니다.
//
// 단계: 0 = 현장 조사만 / 1 = 과학 수사 / 2 = AI 분석·기소장 / 3 = 마무리(모의 재판·최종 보고)
//
// DB: Upstash Redis (Vercel Marketplace에서 Upstash 연결 시 env 자동 주입)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Vercel KV의 KV_REST_API_* 도 인식)
// 데이터 구조: SET solomon:gate:{수업코드} = "0"~"3"  (12시간 후 자동 삭제 → 수업이 끝나면 저절로 닫힘)
//
// 교사 PIN은 Vercel 환경변수 TEACHER_PIN 에 둡니다.
// HTML에 넣지 않는 것이 핵심입니다 — 학생이 소스를 봐도 알 수 없습니다.
// TEACHER_PIN을 설정하지 않으면 단계를 여는 POST가 항상 거부됩니다(잠금 해제 불가).

const MAX_STAGE = 3;
const TTL = 60 * 60 * 12;

function env() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url, token: token } : null;
}

async function redis(cmds) {
  const e = env();
  const r = await fetch(e.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + e.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!env()) return res.status(503).json({ error: 'no-db' });

  try {
    if (req.method === 'GET') {
      const code = clean(req.query.code, 24).toUpperCase();
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      const out = await redis([['GET', 'solomon:gate:' + code]]);
      const raw = out && out[0] && out[0].result;
      const stage = Math.max(0, Math.min(MAX_STAGE, parseInt(raw, 10) || 0));
      return res.status(200).json({ stage: stage });
    }

    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const code = clean(b.code, 24).toUpperCase();
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      if (!pinOk(b.pin)) return res.status(403).json({ error: 'bad-pin' });
      // 교사 로그인: PIN만 확인하고 단계는 바꾸지 않는다
      if (b.verify) return res.status(200).json({ ok: true, verified: true });
      const stage = Math.max(0, Math.min(MAX_STAGE, parseInt(b.stage, 10) || 0));
      const key = 'solomon:gate:' + code;
      await redis([['SET', key, String(stage)], ['EXPIRE', key, TTL]]);
      return res.status(200).json({ ok: true, stage: stage });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String((e && e.message) || e) });
  }
};
