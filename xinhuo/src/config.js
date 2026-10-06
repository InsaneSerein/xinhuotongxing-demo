'use strict';

/**
 * 薪火同行 · 配置
 *
 * 认证方式的切换只改这里。真实上线时把 AUTH_MODE 改成 'cas'，
 * 并填入信息化中心下发的接入参数即可，其余代码无需改动。
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  // 监听地址。校内服务器一般只需监听内网；如需外网访问须经学校批准。
  host: process.env.XH_HOST || '127.0.0.1',
  port: Number(process.env.XH_PORT || 8080),

  // 运行环境：development 会开放模拟登录入口；production 必须走学校认证
  env: process.env.NODE_ENV || 'development',

  /**
   * 认证模式
   *   'mock' : 模拟登录，本地演示用。选身份即可进入，无需学校凭证。
   *   'cas'  : 学校统一身份认证（CAS 协议）
   *   'oidc' : 学校统一身份认证（OAuth2 / OIDC）
   */
  authMode: process.env.XH_AUTH_MODE || 'mock',

  // 学校统一身份认证参数（由学校信息化中心下发）
  cas: {
    // CAS 登录入口，例如 https://sso.example.edu.cn/cas/login
    loginUrl: process.env.XH_CAS_LOGIN || '',
    // CAS 票据校验地址，例如 https://sso.example.edu.cn/cas/serviceValidate
    validateUrl: process.env.XH_CAS_VALIDATE || '',
    // 本服务的回调地址，必须与申请时报备的一致
    serviceUrl: process.env.XH_CAS_SERVICE || 'http://127.0.0.1:8080/auth/callback',
    // 校验成功后从返回中取哪个字段作为学号
    userField: process.env.XH_CAS_USER_FIELD || 'user'
  },

  oidc: {
    authorizeUrl: process.env.XH_OIDC_AUTHORIZE || '',
    tokenUrl: process.env.XH_OIDC_TOKEN || '',
    userInfoUrl: process.env.XH_OIDC_USERINFO || '',
    clientId: process.env.XH_OIDC_CLIENT_ID || '',
    clientSecret: process.env.XH_OIDC_CLIENT_SECRET || '',
    redirectUri: process.env.XH_OIDC_REDIRECT || 'http://127.0.0.1:8080/auth/callback',
    scope: process.env.XH_OIDC_SCOPE || 'openid profile'
  },

  // 会话签名密钥。上线前必须改为随机长字符串，否则会话可被伪造。
  sessionSecret: process.env.XH_SESSION_SECRET || 'dev-only-secret-change-me',

  // 会话有效期（毫秒），默认 8 小时
  sessionTtl: Number(process.env.XH_SESSION_TTL || 8 * 60 * 60 * 1000),

  // 数据目录（JSON 落盘）。生产环境建议替换为数据库。
  dataDir: process.env.XH_DATA_DIR || path.join(ROOT, 'data'),

  // 存放管理员可见的联系方式（与公开数据分离存储，便于单独加密与审计）
  contactFile: 'contacts.json',

  // 保留策略：毕业后默认保留年限
  retentionYears: Number(process.env.XH_RETENTION_YEARS || 3),

  // 每位参与者默认每学期可接收的咨询次数上限
  defaultConsultCap: 5,

  // 管理员学号白名单（上线时由学工办确定，逐人列明）。
  // 默认拒绝：不在名单内的人一律无管理权限。管理端不做页面级口令，
  // 一律走统一身份认证 + 此白名单。
  admins: (process.env.XH_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean),

  // 仅本地调试用：指定一个 uid 在模拟登录时获得管理权限，便于测试中转流程。
  // 生产环境（NODE_ENV=production）下此开关失效。
  mockAdminUid: process.env.XH_MOCK_ADMIN || '',

  // 登录失败限流
  loginRateLimit: { windowMs: 10 * 60 * 1000, max: 10 },

  // 安全响应头
  securityHeaders: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    // 本应用不加载任何外部资源，因此采用最严格的内容安全策略
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  }
};
