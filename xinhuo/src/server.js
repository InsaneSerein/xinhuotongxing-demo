'use strict';

/**
 * 薪火同行 · 服务端
 *
 * 零外部依赖，仅使用 Node 内置模块，便于信息化中心审阅与部署。
 * 认证走 auth.js 的适配层；本地演示用 mock，正式环境切成 cas / oidc。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');
const auth = require('./auth');
const store = require('./store');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/* ============================ 会话 ============================ */

const sessions = new Map();   // sid -> { uid, name, isAdmin, created, csrf }

function sign(sid) {
  return crypto.createHmac('sha256', config.sessionSecret).update(sid).digest('base64url');
}

function newSession(uid, name, isAdmin) {
  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, {
    uid, name, isAdmin,
    created: Date.now(),
    csrf: crypto.randomBytes(18).toString('base64url')
  });
  return sid;
}

function readSession(req) {
  const raw = req.cookies['xh_sid'];
  if (!raw || raw.indexOf('.') < 0) return null;
  const [sid, sig] = raw.split('.');
  // 常量时间比较，避免时序侧信道
  const expect = sign(sid);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.created > config.sessionTtl) { sessions.delete(sid); return null; }
  s.sid = sid;
  return s;
}

function setSessionCookie(res, sid) {
  const secure = config.env === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    'xh_sid=' + sid + '.' + sign(sid) +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(config.sessionTtl / 1000) + secure);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'xh_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/* ============================ 工具 ============================ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, config.securityHeaders));
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, Object.assign({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  }, config.securityHeaders));
  res.end(text);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > (limit || 256 * 1024)) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

/* 登录失败限流（按 IP） */
const loginHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = loginHits.get(ip) || { n: 0, t: now };
  if (now - rec.t > config.loginRateLimit.windowMs) { rec.n = 0; rec.t = now; }
  rec.n++;
  loginHits.set(ip, rec);
  return rec.n > config.loginRateLimit.max;
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  // 防目录穿越
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA 风格：未知路径回落到首页
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, home) => {
        if (e2) return sendText(res, 404, 'Not Found');
        res.writeHead(200, Object.assign({ 'Content-Type': MIME['.html'] }, config.securityHeaders));
        res.end(home);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    }, config.securityHeaders));
    res.end(buf);
  });
}

/* ============================ 路由 ============================ */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;
  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });

  req.cookies = parseCookies(req.headers.cookie);
  req.query = query;
  const session = readSession(req);
  req.session = session;

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  try {
    /* ---------- 认证 ---------- */

    if (p === '/auth/login') {
      if (rateLimited(ip)) return sendText(res, 429, '登录尝试过于频繁，请稍后再试');
      if (config.authMode === 'oidc' && req.session) {
        req.session.oidcState = crypto.randomBytes(12).toString('base64url');
      }
      const r = auth.current().begin(req);
      res.writeHead(302, Object.assign({ Location: r.redirect }, config.securityHeaders));
      return res.end();
    }

    // 模拟登录入口：仅在 mock 模式下存在
    if (p === '/auth/mock') {
      if (config.authMode !== 'mock') return sendText(res, 404, 'Not Found');
      const r = auth.current().complete(req);
      // 默认拒绝原则：模拟登录不自动获得管理权限。
      // 仅当显式配置了 XH_MOCK_ADMIN（且非生产环境）时才放开，便于本地测试中转流程。
      const isAdmin = config.env !== 'production' &&
        !!config.mockAdminUid &&
        r.uid === config.mockAdminUid;
      const sid = newSession(r.uid, r.name, isAdmin);
      store.audit(r.uid, 'login', r.uid, 'mock' + (isAdmin ? ' (admin)' : ''));
      setSessionCookie(res, sid);
      res.writeHead(302, Object.assign({ Location: '/?login=ok' }, config.securityHeaders));
      return res.end();
    }

    if (p === '/auth/callback') {
      if (config.authMode === 'mock') return sendText(res, 404, 'Not Found');
      const r = await auth.current().complete(req);
      // 只有白名单内的学号具备管理权限，未配置白名单时无人是管理员
      const isAdmin = config.admins.includes(r.uid);
      const sid = newSession(r.uid, r.name, isAdmin);
      store.audit(r.uid, 'login', r.uid, config.authMode + (isAdmin ? ' (admin)' : ''));
      setSessionCookie(res, sid);
      res.writeHead(302, Object.assign({ Location: '/?login=ok' }, config.securityHeaders));
      return res.end();
    }

    if (p === '/auth/logout') {
      if (session) { sessions.delete(session.sid); store.audit(session.uid, 'logout', '', ''); }
      clearSessionCookie(res);
      res.writeHead(302, Object.assign({ Location: '/?login=out' }, config.securityHeaders));
      return res.end();
    }

    /* ---------- 会话信息（公开） ---------- */

    if (p === '/api/me') {
      if (!session) return sendJson(res, 200, { authed: false, tier: 'guest', authMode: config.authMode });
      const prof = store.findProfile(session.uid);
      const tier = prof ? (prof.grade === '2022级' ? 'contributor' : 'peer') : 'none';
      return sendJson(res, 200, {
        authed: true,
        uid: session.uid,
        name: session.name,
        isAdmin: !!session.isAdmin,
        tier,
        csrf: session.csrf,
        authMode: config.authMode,
        profile: prof ? store.shapeProfile(prof, 'peer') : null
      });
    }

    /* ---------- 以下接口均需登录 ---------- */

    const needAuth = p.startsWith('/api/');
    if (needAuth && !session) return sendJson(res, 401, { error: '请先通过统一身份认证登录' });

    // 写操作校验 CSRF
    const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
    if (isWrite && session) {
      const tok = req.headers['x-csrf'] || query.csrf;
      if (tok !== session.csrf) return sendJson(res, 403, { error: 'CSRF 校验失败，请刷新页面重试' });
    }

    if (p === '/api/stats') return sendJson(res, 200, store.stats());

    // 层级判定：仅在已确认 session 存在时计算。
    // （静态资源请求不需要它，若无条件计算会在 session 为 null 时崩溃。）
    const tier = (() => {
      if (!session) return 'none';
      const prof = store.findProfile(session.uid);
      if (!prof) return 'none';
      return prof.grade === '2022级' ? 'contributor' : 'peer';
    })();

    if (p === '/api/people') {
      const list = store.listProfiles(tier, {
        q: query.q, dest: query.dest, major: query.major, open: query.open
      });
      return sendJson(res, 200, { tier, items: list });
    }

    if (p.startsWith('/api/people/')) {
      const id = decodeURIComponent(p.slice('/api/people/'.length));
      const target = store.allProfiles().find(x => x.id === id);
      if (!target) return sendJson(res, 404, { error: '未找到该记录' });
      // 只有参与过的用户才能看到完整内容
      const t = (tier === 'contributor' || tier === 'peer') ? tier : 'guest';
      return sendJson(res, 200, store.shapeProfile(target, t));
    }

    /* ---------- 参与（提交信息） ---------- */

    if (p === '/api/profile' && req.method === 'POST') {
      const b = await readBody(req);
      const mode = ['full', 'msg', 'anon'].includes(b.mode) ? b.mode : 'full';
      if (!b.major || !b.grade) return sendJson(res, 400, { error: '专业与年级为必填项' });
      if (mode !== 'anon' && !String(b.name || '').trim()) return sendJson(res, 400, { error: '请填写姓名或署名' });
      if (mode === 'full' && !b.dest) return sendJson(res, 400, { error: '「完整共享」需选择去向类型，或改为「仅留寄语」' });
      if (!b.consent1 || !b.consent2 || !b.consent3) return sendJson(res, 400, { error: '请勾选全部三项知情同意' });

      const existing = store.findProfile(session.uid);
      const profile = {
        id: existing ? existing.id : 'u_' + crypto.randomBytes(8).toString('hex'),
        uid: session.uid,
        name: String(b.name || '').trim(),
        grade: b.grade,
        major: b.major,
        dest: mode === 'msg' ? '' : (b.dest || ''),
        org: mode === 'msg' ? '' : String(b.org || '').trim(),
        exp: String(b.exp || '').trim().slice(0, 4000),
        msg: String(b.msg || '').trim().slice(0, 500),
        mode,
        ask: !!b.ask,
        freq: b.ask ? String(b.freq || '') : '',
        time: b.ask ? String(b.time || '') : '',
        requests: existing ? existing.requests || 0 : 0,
        consentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.upsertProfile(profile);

      // 联系方式单独落库，绝不进入 profiles.json
      if (b.contact && String(b.contact).trim()) {
        store.setContact(session.uid, 'value', String(b.contact).trim());
      }

      store.audit(session.uid, 'profile_submit', profile.id, mode);
      return sendJson(res, 200, {
        ok: true,
        tier: profile.grade === '2022级' ? 'contributor' : 'peer',
        profile: store.shapeProfile(profile, 'peer')
      });
    }

    /* ---------- 撤回与删除 ---------- */

    if (p === '/api/profile' && req.method === 'DELETE') {
      const n = store.removeProfile(session.uid);
      store.audit(session.uid, 'profile_delete', session.uid, '撤回并删除 ' + n + ' 条');
      return sendJson(res, 200, { ok: true, removed: n });
    }

    if (p === '/api/profile/pause' && req.method === 'POST') {
      const b = await readBody(req);
      const r = store.setPaused(session.uid, !!b.paused);
      if (!r) return sendJson(res, 404, { error: '尚未参与，无需暂停' });
      store.audit(session.uid, 'pause', session.uid, b.paused ? '暂停' : '恢复');
      return sendJson(res, 200, { ok: true, ask: r.ask });
    }

    if (p === '/api/profile/export' && req.method === 'GET') {
      const prof = store.findProfile(session.uid);
      store.audit(session.uid, 'export_self', session.uid, '');
      return sendJson(res, 200, {
        note: '平台未存储你的联系方式，因此导出内容中不含联络方式。',
        profile: prof
      });
    }

    /* ---------- 咨询 ---------- */

    if (p === '/api/requests' && req.method === 'POST') {
      if (tier !== 'contributor' && tier !== 'peer') {
        return sendJson(res, 403, { error: '请先参与项目（填写信息表）后再发起咨询' });
      }
      const b = await readBody(req);
      const target = store.allProfiles().find(x => x.id === b.toId);
      if (!target) return sendJson(res, 404, { error: '目标记录不存在' });
      if (!target.ask) return sendJson(res, 400, { error: '该同学已暂停接受咨询' });
      if (target.uid === session.uid) return sendJson(res, 400, { error: '不能向自己发起咨询' });
      if (!String(b.question || '').trim()) return sendJson(res, 400, { error: '请填写具体问题' });
      if (!b.pledge1 || !b.pledge2) return sendJson(res, 400, { error: '请勾选两项承诺' });

      const cap = store.checkCap(target.uid);
      if (!cap.ok) {
        return sendJson(res, 409, {
          error: cap.reason || '已达该同学设定的接收上限',
          cap: cap.cap, used: cap.used
        });
      }

      const r = {
        id: 'r_' + crypto.randomBytes(6).toString('hex'),
        toUid: target.uid,
        toId: target.id,
        fromUid: session.uid,
        fromName: String(b.name || session.name).slice(0, 40),
        fromMajor: String(b.major || '').slice(0, 60),
        question: String(b.question).trim().slice(0, 2000),
        // 明确不收集申请人的联系方式
        status: '待管理员转达',
        createdAt: new Date().toISOString()
      };
      store.addRequest(r);
      store.bumpRequestCount(target.uid);
      store.audit(session.uid, 'request_create', r.id, 'to=' + target.uid);
      return sendJson(res, 200, { ok: true, id: r.id, cap: cap.cap, used: cap.used + 1 });
    }

    if (p === '/api/requests/mine' && req.method === 'GET') {
      const rows = store.listRequests().filter(r => r.fromUid === session.uid);
      return sendJson(res, 200, {
        items: rows.map(r => ({
          id: r.id, status: r.status, question: r.question,
          createdAt: r.createdAt,
          toId: r.toId
        }))
      });
    }

    /* ---------- 举报 ---------- */

    if (p === '/api/report' && req.method === 'POST') {
      const b = await readBody(req);
      if (!String(b.detail || '').trim()) return sendJson(res, 400, { error: '请填写情况说明' });
      // 举报走独立审计通道，被举报人不可见
      // 注意：must guard session — this route is reachable by any logged-in user,
      // and an unauthenticated request must not dereference a null session.
      const actor = session ? session.uid : 'anonymous';
      store.audit(actor, 'REPORT', String(b.target || ''), String(b.detail).slice(0, 1000));
      return sendJson(res, 200, { ok: true, note: '举报已提交，辅导员将在 2 个工作日内联系你。' });
    }

    /* ---------- 管理端 ---------- */

    if (p.startsWith('/api/admin/')) {
      if (!session.isAdmin) return sendJson(res, 403, { error: '无管理权限' });

      if (p === '/api/admin/requests') {
        const rows = store.listRequests();
        return sendJson(res, 200, {
          items: rows.map(r => Object.assign({}, r, { toName: (store.findProfile(r.toUid) || {}).name || '已删除' })),
          note: '转达时只发送问题内容，不附带申请人联系方式。'
        });
      }

      if (p === '/api/admin/requests/status' && req.method === 'POST') {
        const b = await readBody(req);
        const r = store.setRequestStatus(String(b.id || ''), String(b.status || ''), session.uid);
        if (!r) return sendJson(res, 404, { error: '未找到该请求' });
        return sendJson(res, 200, { ok: true, request: r });
      }

      if (p === '/api/admin/people') {
        const rows = store.allProfiles().map(x => store.shapeProfile(x, 'peer'));
        return sendJson(res, 200, { items: rows });
      }

      // 读取联系方式：逐次审计
      if (p.startsWith('/api/admin/contact/')) {
        const uid = decodeURIComponent(p.slice('/api/admin/contact/'.length));
        const c = store.getContact(uid, session.uid);
        if (!c) return sendJson(res, 404, { error: '该同学未提供联系方式' });
        return sendJson(res, 200, { uid, contact: c, note: '本次读取已记入审计日志。' });
      }

      if (p === '/api/admin/audit') {
        const file = path.join(config.dataDir, 'audit.log');
        if (!fs.existsSync(file)) return sendJson(res, 200, { lines: [] });
        const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-200);
        return sendJson(res, 200, { lines });
      }
    }

    /* ---------- 静态资源 ---------- */

    // 静态资源无需登录，也不写审计日志（否则每次加载 css/js 都会污染日志）
    if (req.method === 'GET') return serveStatic(req, res, p);

    return sendText(res, 405, 'Method Not Allowed');

  } catch (err) {
    // 认证失败等预期错误给 401，其余 500；不向客户端泄漏堆栈
    const msg = String(err && err.message || err);
    const expected = /票据|授权码|未通过|校验失败|state/.test(msg);
    if (config.env !== 'production') {
      console.error('[error]', req.method, p, msg);
      if (err && err.stack) console.error(err.stack);
    }
    return sendJson(res, expected ? 401 : 500, {
      error: expected ? '认证未通过：' + msg : '服务器内部错误'
    });
  }
});

/* 定期清理过期会话 */
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.created > config.sessionTtl) sessions.delete(sid);
  }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(config.port, config.host, () => {
    console.log('');
    console.log('  薪火同行 · 朋辈经验共享与互助平台');
    console.log('  ------------------------------------------------');
    console.log('  访问地址 : http://' + config.host + ':' + config.port);
    console.log('  认证模式 : ' + config.authMode + (config.authMode === 'mock' ? '（演示，非学校认证）' : ''));
    console.log('  运行环境 : ' + config.env);
    console.log('  数据目录 : ' + config.dataDir);
    if (config.authMode === 'mock') {
      console.log('');
      console.log('  提示：当前为模拟登录。正式上线请设置 XH_AUTH_MODE=cas 并');
      console.log('        填入信息化中心下发的 CAS 地址与回调地址。');
    }
    console.log('');
  });
}

module.exports = server;
