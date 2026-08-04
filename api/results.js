// 솔로몬 법정 · 수업코드별 결과 저장/조회 API
//
// POST — 학생이 수사를 끝내면 결과를 올립니다 (인증 없음: 아이들이 제출해야 하므로)
// GET  — 반 전체 결과를 조회합니다
//        · 순위판용(이름·점수만)은 인증 없이  → ?code=5A반
//        · 전문(수첩 메모·기소장 서술 포함)은 교사 PIN 필요 → ?code=5A반&pin=...&full=1
//
// 저장소 설정과 필요한 테이블은 api/_db.js 주석을 보세요.

const db = require('./_db');

const MAX_BODY = 20000;

// 순위판에 필요한 값만 남긴다 — 아이가 쓴 메모·서술은 내보내지 않는다
function publicRow(r) {
  const d = r.data || {};
  return {
    name: r.name,
    team: r.team || null,
    savedAt: r.savedAt || null,
    data: {
      total: d.total || 0,
      indictScore: d.indictScore || 0,
      quizScore: d.quizScore || 0,
      deduceScore: d.deduceScore || 0,
    },
  };
}

module.exports = async (req, res) => {
  if (db.prelude(req, res)) return;

  if (!db.backend()) return res.status(503).json({ error: 'no-db', diag: db.diag() });

  try {
    if (req.method === 'POST') {
      const b = db.body(req);
      const code = db.clean(b.code, 24).toUpperCase();
      const name = db.clean(b.name, 20);
      if (!code || !name) return res.status(400).json({ error: 'code와 name이 필요합니다' });
      const row = {
        name: name,
        team: db.clean(b.team, 20) || null,
        data: b.data || {},
      };
      if (JSON.stringify(row).length > MAX_BODY) return res.status(413).json({ error: 'too-big' });
      await db.putResult(code, row);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const code = db.clean(req.query.code, 24).toUpperCase();
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      const rows = await db.listResults(code);
      // 전문 조회는 교사 PIN 이 있어야 한다 (수첩 메모·기소장 서술이 들어 있으므로)
      if (req.query.full) {
        if (!db.pinOk(req.query.pin)) return res.status(403).json({ error: 'bad-pin' });
        return res.status(200).json({ rows: rows, full: true });
      }
      return res.status(200).json({ rows: rows.map(publicRow) });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String((e && e.message) || e) });
  }
};
