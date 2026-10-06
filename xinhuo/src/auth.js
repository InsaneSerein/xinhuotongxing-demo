'use strict';

/**
 * 统一身份认证适配层
 *
 * 三种 provider 暴露同一套接口，业务代码完全不感知学校用的是哪种协议：
 *   begin(req)             -> { redirect } 让浏览器跳去认证页
 *   complete(req, query)   -> { uid, name, raw } 校验通过后的用户标识
 *
 * 'mock' 仅用于本地演示；正式环境必须使用 'cas' 或 'oidc'。
 */

const config = require('./config');

function qs(params) {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
}

/* ------------------------------------------------------------------ *
 * 模拟认证：本地演示用。把「登录」简化为选择一个测试身份。
 * ------------------------------------------------------------------ */
const mockProvider = {
  name: 'mock',
  begin(req) {
    return { redirect: '/auth/mock?uid=' + encodeURIComponent(req.query.uid || '') };
  },
  complete(req) {
    const uid = String(req.query.uid || '').trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(uid)) {
      throw new Error('模拟登录需要一个合法的 uid');
    }
    return { uid, name: req.query.name || uid, raw: { provider: 'mock' } };
  }
};

/* ------------------------------------------------------------------ *
 * CAS 协议（国内高校最常用）
 *   1. 跳转 cas/login?service=<回调地址>
 *   2. 学校认证后带 ?ticket=xxx 回到回调地址
 *   3. 服务端用 cas/serviceValidate?service=..&ticket=.. 校验并取回学号
 * ------------------------------------------------------------------ */
const casProvider = {
  name: 'cas',
  begin() {
    if (!config.cas.loginUrl) throw new Error('未配置 CAS 登录地址');
    return { redirect: config.cas.loginUrl + '?' + qs({ service: config.cas.serviceUrl }) };
  },
  async complete(req) {
    const ticket = req.query.ticket;
    if (!ticket) throw new Error('缺少 CAS 票据');
    if (!config.cas.validateUrl) throw new Error('未配置 CAS 校验地址');

    const url = config.cas.validateUrl + '?' + qs({
      service: config.cas.serviceUrl,
      ticket,
      format: 'JSON'
    });

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('CAS 校验请求失败：HTTP ' + res.status);
    const text = await res.text();

    let uid = null, name = null;

    // CAS 3.0 允许返回 JSON；部分学校仍只返回 XML，两种都兼容
    try {
      const data = JSON.parse(text);
      const ok = data.serviceResponse && data.serviceResponse.authenticationSuccess;
      if (ok) {
        uid = ok[config.cas.userField] || ok.user;
        name = (ok.attributes && (ok.attributes.cn || ok.attributes.name || ok.attributes.displayName)) || uid;
      }
    } catch (e) {
      // 退回 XML 解析
      const m = /<cas:user>([^<]+)<\/cas:user>/.exec(text);
      if (m) uid = m[1];
      const n = /<cas:cn>([^<]+)<\/cas:cn>/.exec(text) || /<cas:name>([^<]+)<\/cas:name>/.exec(text);
      if (n) name = n[1];
    }

    if (!uid) throw new Error('CAS 校验未通过或未返回用户标识');
    return { uid: String(uid), name: name || String(uid), raw: { provider: 'cas' } };
  }
};

/* ------------------------------------------------------------------ *
 * OAuth2 / OIDC（部分高校采用）
 * ------------------------------------------------------------------ */
const oidcProvider = {
  name: 'oidc',
  begin(req) {
    const state = req.session ? req.session.oidcState : '';
    return {
      redirect: config.oidc.authorizeUrl + '?' + qs({
        response_type: 'code',
        client_id: config.oidc.clientId,
        redirect_uri: config.oidc.redirectUri,
        scope: config.oidc.scope,
        state
      })
    };
  },
  async complete(req) {
    const code = req.query.code;
    if (!code) throw new Error('缺少授权码');
    if (req.session && req.session.oidcState && req.query.state !== req.session.oidcState) {
      throw new Error('state 校验失败，疑似 CSRF');
    }
    if (!config.oidc.tokenUrl || !config.oidc.userInfoUrl) throw new Error('未配置 OIDC 端点');

    const body = qs({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.oidc.redirectUri,
      client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret
    });

    const tokRes = await fetch(config.oidc.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body
    });
    if (!tokRes.ok) throw new Error('换取令牌失败：HTTP ' + tokRes.status);
    const tok = await tokRes.json();
    if (!tok.access_token) throw new Error('令牌响应中没有 access_token');

    const uiRes = await fetch(config.oidc.userInfoUrl, {
      headers: { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/json' }
    });
    if (!uiRes.ok) throw new Error('获取用户信息失败：HTTP ' + uiRes.status);
    const info = await uiRes.json();

    const uid = info.sub || info.uid || info.userid || info.preferred_username;
    if (!uid) throw new Error('用户信息中没有可用的身份标识');
    const name = info.name || info.displayName || info.preferred_username || String(uid);
    return { uid: String(uid), name, raw: { provider: 'oidc', info } };
  }
};

const providers = { mock: mockProvider, cas: casProvider, oidc: oidcProvider };

function current() {
  const p = providers[config.authMode];
  if (!p) throw new Error('未知的认证模式：' + config.authMode);
  return p;
}

module.exports = { current, providers };
