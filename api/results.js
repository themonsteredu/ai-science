// 솔로몬 법정 · 수업코드별 결과 저장/조회 API
// DB: Upstash Redis (Vercel Marketplace에서 Upstash 연결 시 아래 env가 자동 주입됩니다)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   (Vercel KV를 쓰면 KV_REST_API_URL / KV_REST_API_TOKEN 도 인식)
// 데이터 구조: HSET solomon:class:{수업코드} {학생이름} = 결과 JSON (90일 후 자동 삭제)

const MAX_BODY = 20000;

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!env()) return res.status(503).json({ error: 'no-db' });

  try {
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const code = clean(b.code, 24).toUpperCase();
      const name = clean(b.name, 20);
      if (!code || !name) return res.status(400).json({ error: 'code와 name이 필요합니다' });
      const row = JSON.stringify({
        name: name,
        team: clean(b.team, 20) || null,
        savedAt: Date.now(),
        data: b.data || {},
      });
      if (row.length > MAX_BODY) return res.status(413).json({ error: 'too-big' });
      const key = 'solomon:class:' + code;
      await redis([['HSET', key, name, row], ['EXPIRE', key, 60 * 60 * 24 * 90]]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const code = clean(req.query.code, 24).toUpperCase();
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      const out = await redis([['HGETALL', 'solomon:class:' + code]]);
      const flat = (out && out[0] && out[0].result) || [];
      const rows = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { rows.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip corrupt row */ }
      }
      return res.status(200).json({ rows: rows });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String((e && e.message) || e) });
  }
};
