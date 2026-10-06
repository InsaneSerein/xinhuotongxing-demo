'use strict';

/**
 * 数据层
 *
 * 两条硬性设计：
 *  1. 公开数据（profiles.json）与联系方式（contacts.json）物理分离。
 *     公开数据里永远没有联系方式字段，因此即使整个 profiles.json 被下载，
 *     也不会泄漏任何人的联络方式。
 *  2. contacts.json 仅管理员接口可读，且每次读取都写审计日志。
 *
 * 存储采用 JSON 落盘，便于信息化中心审阅与迁移；上生产建议换成数据库。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const PROFILES = path.join(config.dataDir, 'profiles.json');
const CONTACTS = path.join(config.dataDir, 'contacts.json');
const REQUESTS = path.join(config.dataDir, 'requests.json');
const AUDIT = path.join(config.dataDir, 'audit.log');

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

function readJson(file, fallback) {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, obj) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);   // 原子替换，避免写一半断电导致文件损坏
}

/* ---------------- 联系方式加密 ----------------
 * 密钥来自环境变量 XH_CONTACT_KEY（32 字节 hex）。
 * 未配置时退化为明文并记录警告——生产环境必须配置。
 */
let warnedNoKey = false;
function contactKey() {
  const k = process.env.XH_CONTACT_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  if (!warnedNoKey && config.env === 'production') {
    warnedNoKey = true;
    console.warn('[安全警告] 未配置 XH_CONTACT_KEY，联系方式将以明文存储。生产环境请务必配置。');
  }
  return null;
}

function encField(plain) {
  const key = contactKey();
  if (!key) return { v: plain, e: 0 };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { v: ct.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), e: 1 };
}

function decField(rec) {
  if (!rec || rec.e === 0) return rec ? rec.v : '';
  const key = contactKey();
  if (!key) return '(密钥缺失，无法解密)';
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'));
    d.setAuthTag(Buffer.from(rec.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(rec.v, 'base64')), d.final()]).toString('utf8');
  } catch (e) {
    return '(解密失败)';
  }
}

/* ---------------- 审计 ---------------- */
function audit(actor, action, target, detail) {
  ensureDir();
  const line = JSON.stringify({
    at: new Date().toISOString(),
    actor: actor || 'anonymous',
    action,
    target: target || '',
    detail: detail || ''
  });
  try {
    fs.appendFileSync(AUDIT, line + '\n', 'utf8');
  } catch (e) { /* 审计失败不阻断业务，但真实环境应告警 */ }
}

/* ---------------- 公开数据 ---------------- */
function allProfiles() {
  return readJson(PROFILES, []);
}

function findProfile(uid) {
  return allProfiles().find(p => p.uid === uid) || null;
}

/**
 * 对外输出的条目：按层级裁剪字段。
 * 这是权限控制的唯一出口，任何新增字段都必须在这里显式决定是否外发。
 */
function shapeProfile(p, tier) {
  const base = {
    id: p.id,
    name: p.mode === 'anon' ? '匿名' + (p.major ? p.major.slice(0, 2) : '') + '同学' : p.name,
    grade: p.grade,
    major: p.major,
    mode: p.mode,
    msg: p.msg || '',
    hasExp: !!p.exp,
    ask: !!p.ask,
    requests: p.requests || 0
  };

  if (tier === 'guest') {
    // 浏览者只能看到寄语与最基本标签
    return base;
  }

  // 贡献者 / 同行者
  base.dest = p.dest || '';
  base.org = (p.org && p.org !== '暂不公开') ? p.org : '';
  base.orgHidden = !p.org || p.org === '暂不公开';
  base.exp = p.exp || '';
  if (base.ask) {
    base.freq = p.freq || '';
    base.time = p.time || '';
  }
  return base;
}

function listProfiles(tier, filter) {
  let rows = allProfiles();
  const f = filter || {};
  if (f.dest) rows = rows.filter(p => p.dest === f.dest);
  if (f.major) rows = rows.filter(p => p.major === f.major);
  if (f.open === '1') rows = rows.filter(p => p.ask);
  if (f.q) {
    const q = String(f.q).toLowerCase();
    rows = rows.filter(p => {
      const hay = tier === 'guest'
        ? [p.major, p.msg].join(' ')
        : [p.name, p.major, p.dest, p.org, p.exp, p.msg].join(' ');
      return hay.toLowerCase().indexOf(q) >= 0;
    });
  }
  return rows.map(p => shapeProfile(p, tier));
}

function upsertProfile(profile) {
  const rows = allProfiles();
  const i = rows.findIndex(p => p.uid === profile.uid || p.id === profile.id);
  if (i >= 0) rows[i] = Object.assign({}, rows[i], profile);
  else rows.push(profile);
  writeJson(PROFILES, rows);
  return profile;
}

function removeProfile(uid) {
  const rows = allProfiles();
  const keep = rows.filter(p => p.uid !== uid);
  writeJson(PROFILES, keep);
  // 同时清除联系方式——撤回必须是彻底的
  const c = readJson(CONTACTS, {});
  if (c[uid]) { delete c[uid]; writeJson(CONTACTS, c); }
  const rq = readJson(REQUESTS, []);
  writeJson(REQUESTS, rq.filter(r => r.toUid !== uid));
  return rows.length - keep.length;
}

function setPaused(uid, paused) {
  const rows = allProfiles();
  const p = rows.find(x => x.uid === uid);
  if (!p) return null;
  p.ask = !paused;
  if (paused) { p.freq = ''; p.time = ''; }
  writeJson(PROFILES, rows);
  return p;
}

/* ---------------- 联系方式（管理员专用） ---------------- */
function setContact(uid, kind, value) {
  const c = readJson(CONTACTS, {});
  if (!c[uid]) c[uid] = {};
  c[uid][kind] = encField(value);
  c[uid].updatedAt = new Date().toISOString();
  writeJson(CONTACTS, c);
}

function getContact(uid, actor) {
  audit(actor, 'read_contact', uid, '管理员读取联系方式');
  const c = readJson(CONTACTS, {});
  const rec = c[uid];
  if (!rec) return null;
  const out = { updatedAt: rec.updatedAt || '' };
  for (const k of Object.keys(rec)) {
    if (k === 'updatedAt') continue;
    out[k] = decField(rec[k]);
  }
  return out;
}

/* ---------------- 咨询请求 ---------------- */
function listRequests() { return readJson(REQUESTS, []); }

function addRequest(r) {
  const rows = listRequests();
  rows.push(r);
  writeJson(REQUESTS, rows);
  return r;
}

/**
 * 频次上限校验。返回 { ok, cap, used }。
 * cap 取自参与者本人设定，未设定时使用系统默认值。
 */
function checkCap(targetUid) {
  const p = findProfile(targetUid);
  if (!p) return { ok: false, cap: 0, used: 0, reason: '目标不存在' };
  const cap = parseInt(String(p.freq || '').replace(/[^0-9]/g, ''), 10) || config.defaultConsultCap;
  const used = Number(p.requests || 0);
  return { ok: used < cap, cap, used, reason: used >= cap ? '已达本人设定的接收上限' : '' };
}

function bumpRequestCount(targetUid) {
  const rows = allProfiles();
  const p = rows.find(x => x.uid === targetUid);
  if (!p) return;
  p.requests = Number(p.requests || 0) + 1;
  writeJson(PROFILES, rows);
}

function setRequestStatus(id, status, actor) {
  const rows = listRequests();
  const r = rows.find(x => x.id === id);
  if (!r) return null;
  r.status = status;
  r.updatedAt = new Date().toISOString();
  writeJson(REQUESTS, rows);
  audit(actor, 'request_status', id, status);
  return r;
}

/* ---------------- 汇总（不含任何排名统计） ---------------- */
function stats() {
  const rows = allProfiles();
  const rq = listRequests();
  return {
    people: rows.length,
    experiences: rows.filter(p => (p.exp || '').trim()).length,
    handled: rq.filter(r => r.status && r.status.indexOf('已转达') === 0).length,
    pending: rq.filter(r => !r.status || r.status === '待管理员转达').length
  };
}

module.exports = {
  allProfiles, findProfile, listProfiles, upsertProfile, removeProfile, setPaused, shapeProfile,
  setContact, getContact,
  listRequests, addRequest, checkCap, bumpRequestCount, setRequestStatus,
  stats, audit, encField, decField
};
