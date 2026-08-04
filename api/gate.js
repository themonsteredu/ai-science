// 솔로몬 법정 · 수업코드별 진도 잠금(게이트) API
// 교사가 단계를 열면 그 수업코드로 접속한 학생 화면이 모두 함께 열립니다.
//
// 단계: 0 = 현장 조사만 / 1 = 과학 수사 / 2 = AI 분석·기소장 / 3 = 마무리
//
// 저장소 설정과 필요한 테이블은 api/_db.js 주석을 보세요.
// 교사 PIN 은 환경변수 TEACHER_PIN 에 둡니다 — 서버에만 있으므로 학생이
// HTML 소스를 봐도 알 수 없습니다. 설정하지 않으면 단계를 열 수 없습니다.

const db = require('./_db');

const MAX_STAGE = 3;
const clampStage = v => Math.max(0, Math.min(MAX_STAGE, parseInt(v, 10) || 0));

module.exports = async (req, res) => {
  if (db.prelude(req, res)) return;

  // 설정 진단: /api/gate?diag=1 — 어떤 환경변수가 들어와 있는지 이름만 보여준다
  if (req.method === 'GET' && req.query && req.query.diag) return res.status(200).json(db.diag());

  if (!db.backend()) return res.status(503).json({ error: 'no-db', diag: db.diag() });

  try {
    if (req.method === 'GET') {
      const code = db.clean(req.query.code, 24).toUpperCase();
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      return res.status(200).json({ stage: clampStage(await db.getStage(code)) });
    }

    if (req.method === 'POST') {
      const b = db.body(req);
      const code = db.clean(b.code, 24).toUpperCase();
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      if (!db.pinOk(b.pin)) return res.status(403).json({ error: 'bad-pin' });
      // 교사 로그인: PIN 만 확인하고 단계는 바꾸지 않는다
      if (b.verify) return res.status(200).json({ ok: true, verified: true });
      const stage = clampStage(b.stage);
      await db.setStage(code, stage);
      return res.status(200).json({ ok: true, stage: stage });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String((e && e.message) || e) });
  }
};
