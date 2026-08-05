// 솔로몬 법정 · 수업코드별 진도 잠금(게이트) API
// 교사가 단계를 열면 그 수업코드로 접속한 학생 화면이 모두 함께 열립니다.
//
// 단계: 0 = 현장 조사만 / 1 = 과학 수사 / 2 = AI 분석·기소장 / 3 = 마무리
//
// 수업코드는 서버에서 정규화합니다 — 한글·영문·숫자만 남기고 대문자로 맞춥니다.
// 그래서 "5-1" 과 "5 1" 과 "51" 이 같은 반으로 취급되고, 코드를 살짝 다르게 적은
// 학생만 열기가 안 먹는 사고가 생기지 않습니다.
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
      const code = db.normCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      const stage = clampStage(await db.getStage(code));
      // 학생 화면이 물어볼 때마다 접속 명단을 갱신한다 (표가 없으면 조용히 넘어간다)
      const who = db.clean(req.query.who, 20);
      if (who) await db.touchPresence(code, who, stage);
      return res.status(200).json({ stage: stage, code: code });
    }

    if (req.method === 'POST') {
      const b = db.body(req);
      const code = db.normCode(b.code);
      if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
      if (!db.pinOk(b.pin)) return res.status(403).json({ error: 'bad-pin' });
      // 교사 로그인: PIN 만 확인하고 단계는 바꾸지 않는다
      if (b.verify) return res.status(200).json({ ok: true, verified: true, code: code });
      // 접속 명단 조회 — 누가 몇 단계까지 열렸는지 (PIN 이 URL 에 남지 않게 POST 로 받는다)
      if (b.roster) {
        return res.status(200).json({
          ok: true, code: code,
          stage: clampStage(await db.getStage(code)),
          roster: await db.listPresence(code),
        });
      }
      const stage = clampStage(b.stage);
      await db.setStage(code, stage);
      return res.status(200).json({ ok: true, stage: stage, code: code });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String((e && e.message) || e) });
  }
};
