'use strict';

/* ============================================================================
   薪火同行 · 前端
   与后端 API 通信，会话由服务端 HttpOnly Cookie 维护。
   ============================================================================ */

const MAJORS = ['计算机科学与技术','软件工程','电子信息工程','通信工程','自动化','机械工程','材料科学与工程','临床医学','经济学','工商管理','法学','汉语言文学'];
const DESTS  = ['国内升学','境外升学','企业就业','考公考编','创业 / 自由职业','暂未确定'];

let ME = { authed:false, tier:'guest', authMode:'mock' };   // 会话信息
let CSRF = '';

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function esc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(m){
  const t = $('#toast'); t.textContent = m; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('on'), 2400);
}
function openDlg(title, body, foot){
  $('#dlg-title').textContent = title;
  $('#dlg-bd').innerHTML = body;
  $('#dlg-ft').innerHTML = foot || '<button class="btn ghost" id="dlg-close">关闭</button>';
  $('#dlg').showModal();
  const c = $('#dlg-close'); if(c) c.onclick = ()=> $('#dlg').close();
}
$('#dlg-x').onclick = ()=> $('#dlg').close();

/* ---------------------------- API 客户端 ---------------------------- */

async function api(path, opts){
  const o = Object.assign({ credentials:'same-origin', headers:{} }, opts||{});
  if(o.body && typeof o.body !== 'string'){
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  if(o.method && o.method !== 'GET') o.headers['x-csrf'] = CSRF;

  const res = await fetch(path, o);
  let data = null;
  try { data = await res.json(); } catch(e){}
  if(res.status === 401 && !data){ data = { error:'会话已失效，请重新登录' }; }
  return { status: res.status, ok: res.ok, data: data || {} };
}

/* ---------------------------- 会话 ---------------------------- */

async function refreshMe(){
  const r = await api('/api/me');
  if(r.ok && r.data.authed){
    ME = r.data;
    CSRF = r.data.csrf || '';
  } else {
    ME = { authed:false, tier:'guest', authMode:(r.data && r.data.authMode) || 'mock' };
    CSRF = '';
  }
  paintSession();
}

function tierLabel(){
  if(!ME.authed) return '未登录';
  if(ME.isAdmin) return '项目管理员';
  if(ME.tier === 'contributor') return '贡献者（毕业年级）';
  if(ME.tier === 'peer') return '同行者（在校同学）';
  if(ME.tier === 'none') return '已登录 · 未参与';
  return '浏览者';
}
function canSeeFull(){ return ME.tier === 'contributor' || ME.tier === 'peer'; }

function paintSession(){
  const chip = $('#userchip');
  if(ME.authed){
    chip.innerHTML = `<span>${esc(ME.name || ME.uid)}</span><span class="tier">${esc(tierLabel())}</span>` +
      `<button class="btn ghost" id="btn-logout" style="padding:4px 10px;font-size:12.5px">退出</button>`;
    $('#btn-logout').onclick = ()=>{ location.href = '/auth/logout'; };
    $('#tab-admin').style.display = ME.isAdmin ? '' : 'none';
  } else {
    chip.innerHTML = '<span>未登录</span>';
    $('#tab-admin').style.display = 'none';
  }

  // 顶部横幅：明确提示当前是模拟登录
  const b = $('#banner'), bt = $('#banner-text');
  if(ME.authMode === 'mock'){
    b.style.display = '';
    bt.innerHTML = '<b>演示模式</b> · 当前使用<strong>模拟登录</strong>，未接入学校统一身份认证；' +
      '页面内所有姓名与院校均为<strong>虚构示例</b>，不含真实个人信息';
  } else {
    b.style.display = 'none';
  }
}

/* ---------------------------- 登录页 ---------------------------- */

function renderLogin(){
  const lead = $('#login-lead'), box = $('#login-body');
  lead.textContent = ME.authMode === 'mock'
    ? '当前为模拟登录模式（本地演示）。正式上线将改为学校统一身份认证。'
    : '请使用学校统一身份认证登录。';

  let html = '';
  if(ME.authMode === 'mock'){
    html += `<button class="sso-btn" id="btn-sso">使用学校统一身份认证登录</button>
      <p class="hint">上按钮在正式环境中会跳转到学校认证页（CAS / OAuth2）。
      当前为演示，请从下方选择一个测试身份：</p>
      <div class="mocklist">
        <button data-uid="2022001" data-name="李维">李维 · 2022级 计算机（有经验、接受咨询）</button>
        <button data-uid="2022005" data-name="陈嘉">陈嘉 · 2022级 自动化（仅留寄语、不接受咨询）</button>
        <button data-uid="2024001" data-name="在校同学">在校同学 · 2024级（未参与，浏览者视角）</button>
        <button data-uid="2022999" data-name="管理员">管理员 · 学工办（可查看中转队列）</button>
      </div>`;
  } else {
    html += `<button class="sso-btn" id="btn-sso">使用学校统一身份认证登录</button>
      <p class="hint">将跳转至学校统一身份认证页面，登录后返回本平台。</p>`;
  }
  box.innerHTML = html;

  const sso = $('#btn-sso');
  if(sso) sso.onclick = ()=>{ location.href = '/auth/login'; };

  $$('#login-body .mocklist button').forEach(b=>{
    b.onclick = ()=>{
      const uid = b.dataset.uid, name = b.dataset.name;
      location.href = '/auth/mock?uid=' + encodeURIComponent(uid) + '&name=' + encodeURIComponent(name);
    };
  });
}

/* ---------------------------- 路由 ---------------------------- */

function go(view){
  if(!ME.authed && view !== 'login' && view !== 'home') view = 'login';
  if(ME.authed && view === 'login') view = 'home';

  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  window.scrollTo({top:0, behavior:'smooth'});

  if(view === 'browse') renderBrowse();
  if(view === 'ask')    renderAsk();
  if(view === 'me')     renderMe();
  if(view === 'admin')  renderAdmin();
  if(view === 'login')  renderLogin();
  if(view === 'home')   renderHome();
}

$('#tabs').addEventListener('click', e=>{
  const b = e.target.closest('button[data-view]');
  if(b) go(b.dataset.view);
});

/* ---------------------------- 首页 ---------------------------- */

async function renderHome(){
  const r = await api('/api/stats');
  if(r.ok){
    $('#stat-p').textContent = r.data.people;
    $('#stat-e').textContent = r.data.experiences;
    $('#stat-h').textContent = r.data.handled;
  }
}

/* ---------------------------- 经验库 ---------------------------- */

function initFilters(){
  const fd = $('#f-dest'), fm = $('#f-major');
  DESTS.forEach(d => fd.insertAdjacentHTML('beforeend', `<option value="${esc(d)}">${esc(d)}</option>`));
  MAJORS.forEach(m => fm.insertAdjacentHTML('beforeend', `<option value="${esc(m)}">${esc(m)}</option>`));
  const jm = $('#in-major'); MAJORS.forEach(m => jm.insertAdjacentHTML('beforeend', `<option value="${esc(m)}">${esc(m)}</option>`));
  const jd = $('#in-dest'); jd.insertAdjacentHTML('beforeend','<option value="">暂不填写</option>');
  DESTS.forEach(d => jd.insertAdjacentHTML('beforeend', `<option value="${esc(d)}">${esc(d)}</option>`));
}

async function renderBrowse(){
  const note = $('#tier-note');
  if(canSeeFull()){
    note.className = 'note ok';
    note.innerHTML = `当前身份：<b>${esc(tierLabel())}</b>。你可以查看全部经验内容并申请咨询。联系方式仍然不在此页面显示。`;
  } else {
    note.className = 'note warn';
    note.innerHTML = `当前身份：<b>${esc(tierLabel())}</b>。你目前只能看到<strong>公开寄语</strong>。` +
      `去向与经验内容需要先填写信息表后解锁——只留一句寄语同样可以解锁。`;
  }

  const params = new URLSearchParams();
  const q = $('#q').value.trim();
  if(q) params.set('q', q);
  if($('#f-dest').value) params.set('dest', $('#f-dest').value);
  if($('#f-major').value) params.set('major', $('#f-major').value);
  if($('#f-open').value) params.set('open', $('#f-open').value);

  const r = await api('/api/people?' + params.toString());
  if(!r.ok){ toast(r.data.error || '加载失败'); return; }

  const items = r.data.items || [];
  $('#list').innerHTML = items.map(p=>{
    const destTag = p.dest ? `<span class="tag brand">${esc(p.dest)}</span>` : `<span class="tag no">未填写去向</span>`;
    const askTag  = p.ask ? `<span class="tag ok">可咨询</span>` : `<span class="tag no">暂不接受咨询</span>`;
    const modeTag = p.mode==='anon' ? `<span class="tag info">匿名投稿</span>` : (p.mode==='msg' ? `<span class="tag info">仅寄语</span>` : '');
    return `<div class="person" data-id="${esc(p.id)}">
      <div class="row1">
        <span class="nm">${esc(p.name)}</span>
        <span class="meta">${esc(p.grade)} · ${esc(p.major)}</span>
        ${destTag}${askTag}${modeTag}
      </div>
      ${ p.hasExp
          ? `<div class="msg">${esc((p.exp||'').slice(0,110))}${(p.exp||'').length>110?'…':''}</div>`
          : `<div class="msg" style="color:var(--ink-3)">经验内容需参与后可见</div>` }
      ${ p.msg ? `<div class="msg" style="border-color:var(--brand-soft)">“${esc(p.msg)}”</div>` : '' }
    </div>`;
  }).join('');
  $('#list-empty').style.display = items.length ? 'none' : 'block';

  $('#list').onclick = e=>{
    const el = e.target.closest('.person');
    if(el) showPerson(el.dataset.id);
  };
}

async function showPerson(id){
  const r = await api('/api/people/' + encodeURIComponent(id));
  if(!r.ok){ toast(r.data.error || '加载失败'); return; }
  const p = r.data;
  const full = canSeeFull();

  let body = `<dl class="kv">
      <dt>年级</dt><dd>${esc(p.grade)}</dd>
      <dt>专业</dt><dd>${esc(p.major)}</dd>
      <dt>去向类型</dt><dd>${p.dest?esc(p.dest):'未填写'}</dd>
      <dt>院校/单位</dt><dd>${ full ? (p.org ? esc(p.org) : '<span class="tag no">本人选择不公开</span>') : '<span class="tag no">参与后可见</span>' }</dd>
      <dt>参与模式</dt><dd>${p.mode==='anon'?'匿名投稿':(p.mode==='msg'?'仅留寄语':'完整共享')}</dd>
      <dt>接受咨询</dt><dd>${p.ask?('是 · '+esc(p.freq||'')+(p.time?' · '+esc(p.time):'')):'否，仅分享经验'}</dd>
    </dl>`;

  if(full){
    body += `<h4 style="margin:20px 0 6px;font-size:14px">经验内容</h4>
      <div class="note info">${p.exp?esc(p.exp):'<span style="color:var(--ink-3)">本人未填写经验内容</span>'}</div>`;
  } else {
    body += `<div class="note warn" style="margin-top:18px">经验内容需要参与后查看。填写信息表即可解锁（只留一句寄语也算参与）。</div>`;
  }
  if(p.msg) body += `<h4 style="margin:20px 0 6px;font-size:14px">想对学弟学妹说</h4><div class="note brand">“${esc(p.msg)}”</div>`;
  body += `<div class="note plain" style="margin-top:18px"><b>联系方式不会在此页面出现。</b>平台不存储手机号与微信号；如需联系，请提交咨询申请，由管理员中转。</div>`;

  let foot = '<button class="btn ghost" id="dlg-close">关闭</button>';
  if(full && p.ask) foot = `<button class="btn primary" id="d-ask">发起咨询申请</button>` + foot;

  openDlg(p.name + ' · 经验详情', body, foot);
  const a = $('#d-ask');
  if(a) a.onclick = ()=>{ $('#dlg').close(); pendingTarget = id; go('ask'); };
}

/* ---------------------------- 参与表单 ---------------------------- */

function initJoin(){
  $$('#mode-radios .radio').forEach(r=>{
    r.addEventListener('click', ()=>{
      $$('#mode-radios .radio').forEach(x=>x.classList.remove('on'));
      r.classList.add('on'); r.querySelector('input').checked = true; syncMode();
    });
  });
  $$('#ask-radios .radio').forEach(r=>{
    r.addEventListener('click', ()=>{
      $$('#ask-radios .radio').forEach(x=>x.classList.remove('on'));
      r.classList.add('on'); r.querySelector('input').checked = true; syncAsk();
    });
  });
  syncMode(); syncAsk();

  $('#btn-join-reset').onclick = ()=>{
    $('#join-form').reset();
    $$('#mode-radios .radio').forEach((x,i)=>x.classList.toggle('on', i===0));
    $$('#ask-radios .radio').forEach((x,i)=>x.classList.toggle('on', i===0));
    syncMode(); syncAsk();
  };

  $('#join-form').addEventListener('submit', e=>{ e.preventDefault(); submitJoin(); });
}
function curMode(){ const r = $('#mode-radios input:checked'); return r?r.value:'full'; }
function curAsk(){ const r = $('#ask-radios input:checked'); return r && r.value==='yes'; }
function syncMode(){
  const m = curMode(), msg = m === 'msg';
  $('#lb-name').innerHTML = m==='anon'
    ? '署名 <span class="opt">选填，留空记为「匿名同学」</span>'
    : '姓名或署名 <span class="req">必填</span>';
  $('#in-org').disabled = msg;
  $('#in-org').placeholder = msg ? '「仅留寄语」模式不收集去向信息' : '可留空；不愿公开可填「暂不公开」';
}
function syncAsk(){ $('#relay-opts').style.display = curAsk() ? '' : 'none'; }

async function submitJoin(){
  const mode = curMode();
  const payload = {
    mode,
    name: $('#in-name').value.trim(),
    grade: $('#in-grade').value,
    major: $('#in-major').value,
    dest: mode==='msg' ? '' : $('#in-dest').value,
    org:  mode==='msg' ? '' : $('#in-org').value.trim(),
    exp:  $('#in-exp').value.trim(),
    msg:  $('#in-msg').value.trim(),
    contact: $('#in-contact').value.trim(),
    ask: curAsk(),
    freq: curAsk() ? $('#in-freq').value : '',
    time: curAsk() ? $('#in-time').value : '',
    consent1: $('#ck-1').checked,
    consent2: $('#ck-2').checked,
    consent3: $('#ck-3').checked
  };
  if(mode!=='anon' && !payload.name) return toast('请填写姓名或署名');
  if(mode==='full' && !payload.dest) return toast('「完整共享」请选择去向类型，或改为「仅留寄语」');
  if(!payload.consent1 || !payload.consent2 || !payload.consent3) return toast('请勾选全部三项知情同意');
  if(mode!=='msg' && !payload.exp && !payload.msg) return toast('经验内容与寄语至少填写一项');

  const r = await api('/api/profile', { method:'POST', body: payload });
  if(!r.ok) return toast(r.data.error || '提交失败');

  await refreshMe();
  openDlg('提交成功', `
    <div class="note ok">你现在是 <b>${esc(tierLabel())}</b>，可以查看经验库全部内容并申请咨询。</div>
    <div class="note plain" style="margin-top:14px">
      <b>接下来会发生什么？</b>
      <ul>
        <li>你的信息已进入经验库${payload.ask?'；学弟学妹可提交咨询申请，由管理员中转给你':'；你选择了暂不接受咨询，仅分享经验'}。</li>
        <li>${payload.contact?'联系方式已<strong>单独加密保存</strong>，不会出现在经验库中，仅管理员在处理对接时读取并留痕。':'平台没有收集你的联系方式。'}</li>
        <li>你可以随时在「我的」页面暂停接受咨询、撤回或删除全部信息。</li>
        <li>默认保存至毕业后 3 年，到期自动清理。</li>
      </ul>
    </div>`,
    '<button class="btn primary" id="dlg-go">去经验库看看</button><button class="btn ghost" id="dlg-close">留在本页</button>');
  const g = $('#dlg-go'); if(g) g.onclick = ()=>{ $('#dlg').close(); go('browse'); };
  const c = $('#dlg-close'); if(c) c.onclick = ()=> $('#dlg').close();
}

/* ---------------------------- 咨询 ---------------------------- */

let pendingTarget = null;

async function renderAsk(){
  const box = $('#ask-body');
  if(!canSeeFull()){
    box.innerHTML = `<div class="note warn">发起咨询需要先参与项目——填写信息表后即可获得咨询权限（只留一句寄语也算参与）。</div>
      <div class="actions"><button class="btn primary" id="a-join">去填写信息表</button></div>`;
    $('#a-join').onclick = ()=> go('join');
    return;
  }
  const r = await api('/api/people?open=1');
  const open = (r.data.items||[]).filter(p=>p.ask);
  if(!open.length){
    box.innerHTML = `<div class="empty"><span class="big">◌</span>当前没有开放咨询的参与者</div>`;
    return;
  }
  const mine = await api('/api/requests/mine');
  const count = (mine.data.items||[]).length;

  const opts = open.map(p=>`<option value="${esc(p.id)}" ${pendingTarget===p.id?'selected':''}>${esc(p.name)} · ${esc(p.major)}${p.dest?' · '+esc(p.dest):''}</option>`).join('');

  box.innerHTML = `
    <div class="note info">你已发起 <b>${count}</b> 次咨询申请。每位参与者每学期可接收的咨询次数由本人设定，超出后由管理员征询本人意愿。</div>
    <label class="f">咨询对象 <span class="req">必填</span></label>
    <select id="ask-to">${opts}</select>
    <label class="f">你的身份 <span class="req">必填</span></label>
    <div class="grid g2">
      <div><input type="text" id="ask-name" placeholder="你的姓名" value="${esc(ME.name||'')}"></div>
      <div><input type="text" id="ask-major" placeholder="专业与年级，如：计算机 2024级"></div>
    </div>
    <label class="f">想问的具体问题 <span class="req">必填</span></label>
    <textarea id="ask-q" placeholder="请写具体一些，例如：我是2024级计算机专业，想考XX大学，目前绩点3.6，想了解复试中项目经历该如何准备。"></textarea>
    <p class="hint">管理员会转达你的问题，但<strong>不会把你的联系方式一并转达</strong>。对方同意后，才会安排进一步联系。</p>
    <div class="checks">
      <label class="check"><input type="checkbox" id="ak-1"><span>我承诺咨询内容仅用于个人升学/求职参考，<b>不截图外传、不用于商业用途、不打扰对方正常生活</b>。</span></label>
      <label class="check"><input type="checkbox" id="ak-2"><span>我知悉若发生骚扰或不当行为，我的参与资格会被取消。</span></label>
    </div>
    <div class="actions"><button class="btn primary" id="btn-ask">提交咨询申请</button></div>
    <div class="note plain" style="margin-top:20px">
      <b>中转流程</b>
      <ol><li>你提交申请</li><li>管理员核对频次与内容</li><li>转达给学长学姐</li>
      <li>对方同意并回复</li><li>管理员把回复转达给你</li><li>双方都愿意时才交换联系方式</li></ol>
    </div>`;

  $('#btn-ask').onclick = async ()=>{
    const payload = {
      toId: $('#ask-to').value,
      name: $('#ask-name').value.trim(),
      major: $('#ask-major').value.trim(),
      question: $('#ask-q').value.trim(),
      pledge1: $('#ak-1').checked,
      pledge2: $('#ak-2').checked
    };
    if(!payload.name || !payload.major || !payload.question) return toast('请填写你的身份与具体问题');
    if(!payload.pledge1 || !payload.pledge2) return toast('请勾选两项承诺');

    const res = await api('/api/requests', { method:'POST', body: payload });
    if(res.status === 409){
      openDlg('已达本学期限额', `<div class="note warn">${esc(res.data.error)}（上限 ${res.data.cap} 次，已用 ${res.data.used} 次）<br>请稍后再试或选择其他同学。</div>`);
      return;
    }
    if(!res.ok) return toast(res.data.error || '提交失败');

    openDlg('咨询申请已提交', `
      <div class="note ok">管理员会在 <b>3 个工作日</b>内核对并转达。你可以在「我的」页面查看进度。</div>
      <div class="note plain" style="margin-top:14px">
        <b>隐私说明</b>
        <ul><li>本次转达<strong>不包含</strong>你的联系方式。</li>
        <li>对方回复后，管理员会把内容转达给你。</li>
        <li>只有双方都同意时，才会安排交换联系方式。</li></ul>
      </div>`,
      '<button class="btn primary" id="dlg-go2">查看进度</button><button class="btn ghost" id="dlg-close">知道了</button>');
    const g = $('#dlg-go2'); if(g) g.onclick = ()=>{ $('#dlg').close(); go('me'); };
    const c = $('#dlg-close'); if(c) c.onclick = ()=> $('#dlg').close();
  };
}

/* ---------------------------- 我的 ---------------------------- */

async function renderMe(){
  const box = $('#me-body');
  const me = await api('/api/me');
  const p = me.data.profile;

  if(!p){
    box.innerHTML = `
      <div class="note warn">你目前已登录，但<b>尚未参与</b>，只能查看公开寄语。填写信息表后可解锁全部内容。</div>
      <div class="actions"><button class="btn primary" id="m-join">去填写信息表</button></div>`;
    $('#m-join').onclick = ()=> go('join');
    return;
  }

  const mine = await api('/api/requests/mine');
  const reqs = mine.data.items || [];

  box.innerHTML = `
    <div class="note ok">当前身份：<b>${esc(tierLabel())}</b></div>
    <h4 style="margin:22px 0 0;font-size:15px">我的信息</h4>
    <dl class="kv">
      <dt>署名</dt><dd>${esc(p.name)}</dd>
      <dt>年级</dt><dd>${esc(p.grade)}</dd>
      <dt>专业</dt><dd>${esc(p.major)}</dd>
      <dt>去向</dt><dd>${p.dest?esc(p.dest):'未填写'}</dd>
      <dt>接受咨询</dt><dd>${p.ask?'是':'否'}</dd>
      <dt>已接收咨询</dt><dd>${esc(p.requests||0)} 次</dd>
    </dl>
    <h4 style="margin:24px 0 0;font-size:15px">隐私与访问控制</h4>
    <div class="note plain" style="margin-top:12px">
      <b>平台未在公开数据中存储你的联系方式。</b>如你填写过联系方式，它被单独加密保存，仅管理员在处理你同意的对接时读取，且每次读取都会记入审计日志。
    </div>
    <div class="actions">
      <button class="btn ghost" id="btn-pause">${p.ask?'暂停接受咨询':'恢复接受咨询'}</button>
      <button class="btn ghost" id="btn-export">导出我的数据</button>
      <button class="btn ghost" id="btn-report">我要举报</button>
      <button class="btn danger" id="btn-delete">撤回并删除全部信息</button>
    </div>
    <h4 style="margin:26px 0 0;font-size:15px">我发起的咨询</h4>
    ${ reqs.length ? `<table class="tbl"><thead><tr><th style="width:150px">状态</th><th>问题</th></tr></thead>
        <tbody>${reqs.map(r=>`<tr><td><span class="tag info">${esc(r.status)}</span></td><td>${esc(r.question.slice(0,80))}${r.question.length>80?'…':''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty" style="padding:26px"><span class="big">◌</span>还没有发起过咨询</div>` }`;

  $('#btn-pause').onclick = async ()=>{
    const r = await api('/api/profile/pause', { method:'POST', body:{ paused: !!p.ask } });
    if(!r.ok) return toast(r.data.error || '操作失败');
    toast(r.data.ask ? '已恢复接受咨询' : '已暂停接受咨询，立即生效');
    renderMe();
  };
  $('#btn-export').onclick = async ()=>{
    const r = await api('/api/profile/export');
    openDlg('导出我的数据',
      `<div class="note info">${esc(r.data.note||'')}</div>
       <pre style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:12.5px;max-height:300px">${esc(JSON.stringify(r.data.profile,null,2))}</pre>`);
  };
  $('#btn-report').onclick = ()=>{
    openDlg('举报通道', `
      <div class="note warn">举报由辅导员直接受理，<strong>不会向被举报人透露你的身份</strong>。</div>
      <label class="f">举报对象</label><input type="text" id="rp-to" placeholder="对方署名">
      <label class="f">情况说明</label><textarea id="rp-d" placeholder="请描述发生了什么"></textarea>
      <div class="actions"><button class="btn primary" id="rp-send">提交举报</button></div>`);
    $('#rp-send').onclick = async ()=>{
      const r = await api('/api/report', { method:'POST', body:{ target:$('#rp-to').value, detail:$('#rp-d').value } });
      $('#dlg').close();
      toast(r.ok ? (r.data.note||'举报已提交') : (r.data.error||'提交失败'));
    };
  };
  $('#btn-delete').onclick = ()=>{
    openDlg('确认撤回并删除？', `
      <div class="note warn">删除后，你的经验内容将从经验库移除，学弟学妹无法再通过平台查看或联系你。
      联系方式也会一并清除。此操作<strong>不可撤销</strong>，但你可以随时重新提交。</div>`,
      '<button class="btn ghost" id="dlg-close">先不删</button><button class="btn danger" id="del-yes">确认删除</button>');
    const c = $('#dlg-close'); if(c) c.onclick = ()=> $('#dlg').close();
    $('#del-yes').onclick = async ()=>{
      const r = await api('/api/profile', { method:'DELETE' });
      $('#dlg').close();
      if(!r.ok) return toast(r.data.error || '删除失败');
      await refreshMe();
      toast('已删除全部信息，可随时重新参与');
      renderMe();
    };
  };
}

/* ---------------------------- 管理端 ---------------------------- */

async function renderAdmin(){
  const box = $('#admin-body');
  if(!ME.isAdmin){
    box.innerHTML = `<div class="note warn">你没有管理权限。管理端仅对学工办指定的账号开放。</div>`;
    return;
  }
  const rq = await api('/api/admin/requests');
  const pp = await api('/api/admin/people');
  if(!rq.ok){ box.innerHTML = `<div class="note warn">${esc(rq.data.error||'加载失败')}</div>`; return; }

  const items = rq.data.items || [];
  const people = pp.data.items || [];

  box.innerHTML = `
    <div class="card">
      <h2 class="sec"><span class="n">6</span>中转队列</h2>
      <p class="lead">${esc(rq.data.note||'')}</p>
      ${ items.length ? `<table class="tbl">
        <thead><tr><th style="width:110px">咨询对象</th><th style="width:150px">申请人</th><th>问题</th><th style="width:130px">状态</th><th style="width:200px">操作</th></tr></thead>
        <tbody>${items.map(r=>`<tr>
          <td>${esc(r.toName)}</td>
          <td>${esc(r.fromName)}<br><span class="hint">${esc(r.fromMajor)}</span></td>
          <td>${esc(r.question)}</td>
          <td><span class="tag warn">${esc(r.status)}</span></td>
          <td>
            <button class="btn ghost" data-fwd="${esc(r.id)}" style="padding:5px 11px;font-size:12.5px">标记已转达</button>
            <button class="btn ghost" data-contact="${esc(r.toUid)}" style="padding:5px 11px;font-size:12.5px">读取联系方式</button>
          </td></tr>`).join('')}</tbody></table>`
        : `<div class="empty" style="padding:30px"><span class="big">◌</span>暂无待处理的咨询请求</div>` }
    </div>

    <div class="card">
      <h2 class="sec">频次与偏好总览</h2>
      <table class="tbl">
        <thead><tr><th>参与者</th><th style="width:110px">已接收</th><th style="width:170px">本人设定上限</th><th style="width:190px">可接受时段</th><th style="width:110px">状态</th></tr></thead>
        <tbody>${people.map(p=>{
          const cap = parseInt(String(p.freq||'').replace(/[^0-9]/g,''),10) || null;
          const over = cap && (p.requests||0) >= cap;
          return `<tr><td>${esc(p.name)}<br><span class="hint">${esc(p.major)}</span></td>
            <td>${esc(p.requests||0)}${cap?' / '+cap:''}</td>
            <td>${esc(p.freq||'—')}</td><td>${esc(p.time||'—')}</td>
            <td>${ p.ask ? (over?'<span class="tag warn">已达上限</span>':'<span class="tag ok">正常</span>') : '<span class="tag no">已暂停</span>' }</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>

    <div class="card">
      <h2 class="sec">审计日志（最近 200 条）</h2>
      <div class="actions" style="margin-top:12px"><button class="btn ghost" id="btn-audit">加载审计日志</button></div>
      <div id="audit-box"></div>
    </div>`;

  box.onclick = async e=>{
    const f = e.target.closest('button[data-fwd]');
    if(f){
      const r = await api('/api/admin/requests/status', { method:'POST', body:{ id:f.dataset.fwd, status:'已转达，等待回复' } });
      toast(r.ok ? '已标记为转达' : (r.data.error||'失败'));
      renderAdmin();
      return;
    }
    const c = e.target.closest('button[data-contact]');
    if(c){
      const r = await api('/api/admin/contact/' + encodeURIComponent(c.dataset.contact));
      if(!r.ok){ toast(r.data.error || '未找到联系方式'); return; }
      const k = Object.keys(r.data.contact).filter(x=>x!=='updatedAt');
      openDlg('联系方式（本次读取已记入审计日志）', `
        <div class="note warn">请仅用于本次经本人同意的对接，<strong>不得转告他人或用于其他用途</strong>。</div>
        <dl class="kv">${k.map(x=>`<dt>${esc(x)}</dt><dd>${esc(r.data.contact[x])}</dd>`).join('')}
        <dt>更新时间</dt><dd>${esc(r.data.contact.updatedAt)}</dd></dl>`);
      return;
    }
    if(e.target.id === 'btn-audit'){
      const r = await api('/api/admin/audit');
      const lines = (r.data.lines||[]).map(x=>{
        try { const o = JSON.parse(x); return `${o.at}  ${o.actor}  ${o.action}  ${o.target}  ${o.detail}`; }
        catch(_) { return x; }
      });
      $('#audit-box').innerHTML = lines.length
        ? `<pre style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:12px;max-height:320px;margin-top:12px">${esc(lines.join('\n'))}</pre>`
        : '<div class="note plain" style="margin-top:12px">暂无审计记录</div>';
    }
  };
}

/* ---------------------------- 启动 ---------------------------- */

(async function boot(){
  initFilters();
  initJoin();
  await refreshMe();

  if(!ME.authed){
    go('login');
  } else {
    go('home');
  }

  // 顶部四格筛选
  $('#q').addEventListener('input', renderBrowse);
  $('#f-dest').addEventListener('change', renderBrowse);
  $('#f-major').addEventListener('change', renderBrowse);
  $('#f-open').addEventListener('change', renderBrowse);
  $('#btn-reset').onclick = ()=>{
    $('#q').value=''; $('#f-dest').value=''; $('#f-major').value=''; $('#f-open').value='';
    renderBrowse();
  };

  // 处理来自认证跳转的提示
  const sp = new URLSearchParams(location.search);
  if(sp.get('login') === 'ok') toast('已通过认证登录');
  if(sp.get('login') === 'out') toast('已退出登录');
})();
