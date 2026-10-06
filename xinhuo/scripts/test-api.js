'use strict';

/**
 * 端到端接口测试
 * 启动服务后运行：node scripts/test-api.js
 * 覆盖：未登录拦截、模拟登录、会话、层级权限、CSRF、频次上限、联系方式隔离。
 */

const BASE = process.env.XH_TEST_BASE || 'http://127.0.0.1:8080';
const crypto = require('crypto');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* 一个极简的 cookie jar */
function jar() {
  const store = {};
  return {
    header() {
      return Object.keys(store).map(k => k + '=' + store[k]).join('; ');
    },
    absorb(res) {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      sc.forEach(c => {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        store[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
      });
    }
  };
}

async function req(path, opts, cookies) {
  const o = Object.assign({ redirect: 'manual', headers: {} }, opts || {});
  if (cookies) o.headers.Cookie = cookies.header();
  const res = await fetch(BASE + path, o);
  if (cookies) cookies.absorb(res);
  return res;
}

async function json(res) { try { return await res.json(); } catch (e) { return null; } }

(async () => {
  console.log('目标服务: ' + BASE);
  console.log('');

  /* ---------- 1. 未登录 ---------- */
  console.log('=== 1. 未登录状态 ===');
  {
    const res = await req('/api/me');
    const b = await json(res);
    ok('GET /api/me 返回 200', res.status === 200, 'got ' + res.status);
    ok('未登录时 tier = guest', b && b.tier === 'guest', JSON.stringify(b));
    ok('未登录不泄漏 uid', b && !b.uid);
  }
  {
    const res = await req('/api/people');
    ok('未登录访问 /api/people 被拦截 401', res.status === 401, 'got ' + res.status);
  }

  /* ---------- 2. 模拟登录（毕业生） ---------- */
  console.log('');
  console.log('=== 2. 模拟登录（毕业生 2022001）===');
  const c1 = jar();
  let csrf1 = '';
  {
    const res = await req('/auth/mock?uid=2022001&name=' + encodeURIComponent('李维'), {}, c1);
    ok('登录后 302 跳转', res.status === 302, 'got ' + res.status);
    const cookie = c1.header();
    ok('下发会话 Cookie', /xh_sid=/.test(cookie), cookie);
  }
  {
    const res = await req('/api/me', {}, c1);
    const b = await json(res);
    ok('会话有效 authed=true', b && b.authed === true, JSON.stringify(b));
    ok('含 CSRF 令牌', b && typeof b.csrf === 'string' && b.csrf.length > 10);
    csrf1 = b ? b.csrf : '';
    ok('层级为 contributor', b && b.tier === 'contributor', b && b.tier);
  }

  /* ---------- 3. 层级权限 ---------- */
  console.log('');
  console.log('=== 3. 层级权限（贡献者可看全文）===');
  {
    const res = await req('/api/people', {}, c1);
    const b = await json(res);
    ok('返回列表', b && Array.isArray(b.items) && b.items.length === 8, b && b.items && b.items.length);
    const withExp = (b.items || []).filter(x => x.exp);
    ok('贡献者可见经验正文', withExp.length > 0, 'exp 非空条数=' + withExp.length);
  }
  {
    // 匿名条目不应暴露真实姓名
    const res = await req('/api/people', {}, c1);
    const b = await json(res);
    const anon = (b.items || []).find(x => x.mode === 'anon');
    ok('匿名条目姓名已脱敏', anon && anon.name !== '匿名学姐', anon && anon.name);
    ok('匿名条目不暴露单位', anon && !anon.org, anon && anon.org);
  }

  /* ---------- 4. 联系方式隔离（最关键） ---------- */
  console.log('');
  console.log('=== 4. 联系方式隔离 ===');
  {
    const res = await req('/api/people', {}, c1);
    const raw = JSON.stringify(await json(res));
    ok('普通接口不返回 phone 字段', !/"phone"/.test(raw));
    ok('普通接口不返回 wechat 字段', !/"wechat"/.test(raw));
    ok('普通接口不含 demo_contact 占位串', raw.indexOf('demo_contact') < 0);
  }
  {
    const res = await req('/api/admin/contact/2022001', {}, c1);
    ok('非管理员读取联系方式被拒 403', res.status === 403, 'got ' + res.status);
  }

  /* ---------- 5. CSRF ---------- */
  console.log('');
  console.log('=== 5. CSRF 防护 ===');
  {
    const res = await req('/api/profile/pause', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true })
    }, c1);
    ok('缺少 CSRF 令牌时被拒 403', res.status === 403, 'got ' + res.status);
  }

  /* ---------- 6. 参与提交 ---------- */
  console.log('');
  console.log('=== 6. 参与提交（在校生）===');
  const c2 = jar();
  let csrf2 = '';
  {
    await req('/auth/mock?uid=2024001&name=' + encodeURIComponent('学弟'), {}, c2);
    const res = await req('/api/me', {}, c2);
    const b = await json(res);
    csrf2 = b.csrf;
    ok('在校生登录成功', b && b.authed, JSON.stringify(b));
    ok('未参与时 tier = none', b && b.tier === 'none', b && b.tier);
  }
  {
    // 未参与者不能发起咨询
    const res = await req('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf': csrf2 },
      body: JSON.stringify({ toId: 'u_seed1', question: '测试', pledge1: true, pledge2: true })
    }, c2);
    ok('未参与时发起咨询被拒 403', res.status === 403, 'got ' + res.status);
  }
  {
    // 缺少知情同意应被拒
    const res = await req('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf': csrf2 },
      body: JSON.stringify({ name: '学弟', grade: '2024级', major: '计算机科学与技术', mode: 'full', dest: '国内升学', consent1: true })
    }, c2);
    ok('知情同意不全时被拒 400', res.status === 400, 'got ' + res.status);
  }
  {
    // 合法提交（仅留寄语模式，不填去向）
    const res = await req('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf': csrf2 },
      body: JSON.stringify({
        name: '学弟', grade: '2024级', major: '计算机科学与技术', mode: 'msg',
        msg: '希望两年后我也能帮到别人。', ask: true, freq: '每学期不超过3次',
        consent1: true, consent2: true, consent3: true
      })
    }, c2);
    const b = await json(res);
    ok('「仅留寄语」提交成功', res.status === 200 && b && b.ok, res.status + ' ' + JSON.stringify(b));
    ok('提交后层级为 peer（同样解锁查看）', b && b.tier === 'peer', b && b.tier);
  }
  {
    const res = await req('/api/me', {}, c2);
    const b = await json(res);
    ok('同行者现在可见经验库', b && b.tier === 'peer');
  }
  {
    const res = await req('/api/people', {}, c2);
    const b = await json(res);
    const withExp = (b.items || []).filter(x => x.exp);
    ok('同行者可见经验正文', withExp.length > 0, 'exp 非空=' + withExp.length);
  }

  /* ---------- 7. 咨询与频次上限 ---------- */
  console.log('');
  console.log('=== 7. 咨询与频次上限 ===');
  {
    // 2022002 的上限是每学期 3 次，已用 1 次；连发 2 次应成功，第 3 次应触发上限
    const target = 'u_seed2';
    let blocked = null;
    for (let i = 0; i < 4; i++) {
      const res = await req('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf': csrf2 },
        body: JSON.stringify({
          toId: target, question: '第' + (i + 1) + '次咨询测试', name: '学弟',
          major: '计算机 2024级', pledge1: true, pledge2: true
        })
      }, c2);
      if (res.status === 409) { blocked = { at: i + 1, body: await json(res) }; break; }
    }
    ok('超出上限时返回 409 并拦截', !!blocked, JSON.stringify(blocked));
    if (blocked) {
      ok('拦截时说明原因', /上限/.test(blocked.body.error || ''), blocked.body.error);
    }
  }
  {
    // 暂停接受咨询后不应再被咨询
    const c3 = jar();
    await req('/auth/mock?uid=2022004', {}, c3);
    const r3 = await req('/api/me', {}, c3);
    const csrf3 = (await json(r3)).csrf;
    const res = await req('/api/profile/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf': csrf3 },
      body: JSON.stringify({ paused: true })
    }, c3);
    const b = await json(res);
    ok('可自行暂停接受咨询', res.status === 200 && b && b.ask === false, JSON.stringify(b));

    const res2 = await req('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf': csrf2 },
      body: JSON.stringify({ toId: 'u_seed4', question: '测试', name: '学弟', major: 'x', pledge1: true, pledge2: true })
    }, c2);
    ok('已暂停者不会被咨询 400', res2.status === 400, 'got ' + res2.status);
  }

  /* ---------- 8. 撤回与删除 ---------- */
  console.log('');
  console.log('=== 8. 撤回与删除 ===');
  {
    const res = await req('/api/profile', { method: 'DELETE', headers: { 'x-csrf': csrf2 } }, c2);
    const b = await json(res);
    ok('可撤回并删除自己的信息', res.status === 200 && b && b.ok, JSON.stringify(b));
    const me = await json(await req('/api/me', {}, c2));
    ok('删除后层级回落', me && me.tier === 'none', me && me.tier);
  }

  /* ---------- 9. 导出 ---------- */
  console.log('');
  console.log('=== 9. 数据导出 ===');
  {
    const res = await req('/api/profile/export', {}, c1);
    const b = await json(res);
    const raw = JSON.stringify(b);
    ok('导出成功', res.status === 200 && b, res.status);
    ok('导出内容不含联系方式', raw.indexOf('demo_contact') < 0 && !/"phone"/.test(raw) && !/"wechat"/.test(raw));
  }

  /* ---------- 10. 登出 ---------- */
  console.log('');
  console.log('=== 10. 登出 ===');
  {
    await req('/auth/logout', {}, c1);
    const res = await req('/api/people', {}, c1);
    ok('登出后会话失效 401', res.status === 401, 'got ' + res.status);
  }

  console.log('');
  console.log('=========================================');
  console.log('  通过 ' + pass + '   失败 ' + fail);
  console.log('=========================================');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('测试过程异常：', e.message);
  process.exit(1);
});
