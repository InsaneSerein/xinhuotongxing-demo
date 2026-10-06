'use strict';

/**
 * 播种演示数据
 *
 * 用法：node scripts/seed.js
 * 会写入 data/ 目录。所有内容均为虚构示例，不含真实个人信息。
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');

const PROFILES = path.join(config.dataDir, 'profiles.json');
const CONTACTS = path.join(config.dataDir, 'contacts.json');
const REQUESTS = path.join(config.dataDir, 'requests.json');

const MAJORS = ['计算机科学与技术','软件工程','电子信息工程','通信工程','自动化','机械工程','材料科学与工程','临床医学','经济学','工商管理','法学','汉语言文学'];
const DESTS = ['国内升学','境外升学','企业就业','考公考编','创业 / 自由职业','暂未确定'];

const SEED = [
  { uid:'2022001', name:'李维', grade:'2022级', major:'计算机科学与技术', dest:'国内升学', org:'XX大学 计算机学院',
    exp:'复试最看重的是项目经历能否讲清楚。我被问到「这个系统的瓶颈在哪、你怎么发现的」，答得具体才有分。建议把简历上每个项目的技术选型理由都想一遍。',
    msg:'别怕慢，怕停。', ask:true, freq:'每学期不超过5次', time:'不接受深夜联系（22:00后）', mode:'full', requests:2,
    contact:{ kind:'wechat', value:'demo_contact_001' } },

  { uid:'2022002', name:'匿名学姐', grade:'2022级', major:'软件工程', dest:'企业就业', org:'',
    exp:'秋招提前批比正式批好拿 offer。我投了 30 多家，最后拿到的是 8 月就开始投的那几家。简历一页就够，把最有把握的项目放最上面。',
    msg:'投递是一场概率游戏，别把一次拒绝当成对自己的判断。', ask:true, freq:'每学期不超过3次', time:'仅工作日晚上', mode:'anon', requests:1,
    contact:{ kind:'email', value:'demo_contact_002' } },

  { uid:'2022003', name:'张昊', grade:'2022级', major:'电子信息工程', dest:'国内升学', org:'XX大学 电子系',
    exp:'保研的关键是前五学期的绩点，大三下再努力已经晚了。夏令营要海投，我从 6 月开始投了 12 所，进了 5 个营。英语面试不要背模板，会被听出来。',
    msg:'早点开始，晚点焦虑。', ask:true, freq:'每学期不超过5次', time:'仅工作日白天', mode:'full', requests:3,
    contact:{ kind:'phone', value:'demo_contact_003' } },

  { uid:'2022004', name:'王雨桐', grade:'2022级', major:'临床医学', dest:'国内升学', org:'XX医科大学',
    exp:'医学考研的难点在西综，建议 3 月就开始第一轮。实习和复习会冲突，我的做法是把夜班后的白天整块时间留给西综，碎片时间背单词和政治。',
    msg:'这条路很长，但你不是一个人走。', ask:true, freq:'每学期不超过5次', time:'周末', mode:'full', requests:0,
    contact:{ kind:'wechat', value:'demo_contact_004' } },

  { uid:'2022005', name:'陈嘉', grade:'2022级', major:'自动化', dest:'考公考编', org:'某省直单位',
    exp:'选调生和省考可以同时准备，行测的模块化训练比刷整套卷更有效。申论别只看范文，要自己动手写完整篇再对照修改，这一步最容易被跳过。',
    msg:'稳定不是妥协，是另一种选择。', ask:false, freq:'', time:'', mode:'msg', requests:0, contact:null },

  { uid:'2022006', name:'匿名学长', grade:'2022级', major:'机械工程', dest:'境外升学', org:'',
    exp:'语言成绩要早考，我拖到大四上才考完，导致选校范围被压缩。文书不要写「我从小热爱机械」，写你做过的一个具体决定和它带来的结果。',
    msg:'申请季很长，把节奏掌握在自己手里。', ask:true, freq:'每学期不超过10次', time:'仅工作日晚上', mode:'anon', requests:1,
    contact:{ kind:'email', value:'demo_contact_006' } },

  { uid:'2022007', name:'刘思远', grade:'2022级', major:'经济学', dest:'企业就业', org:'XX咨询',
    exp:'咨询和投行的面试都是 case 为主，建议找同学组队练，一周练三次。自我介绍控制在 90 秒，讲一个贯穿你大学生活的主线，别罗列经历。',
    msg:'你不需要完美，你需要被记住。', ask:true, freq:'每学期不超过5次', time:'仅工作日晚上', mode:'full', requests:2,
    contact:{ kind:'wechat', value:'demo_contact_007' } },

  { uid:'2022008', name:'赵敏', grade:'2022级', major:'材料科学与工程', dest:'国内升学', org:'XX大学 材料学院',
    exp:'材料专业考研竞争相对缓和，但导师的选择比学校更重要。建议提前看导师近三年的论文，发邮件时能提到具体工作，回复率会高很多。',
    msg:'选导师这件事，值得你花两周时间。', ask:true, freq:'每学期不超过3次', time:'不接受深夜联系（22:00后）', mode:'full', requests:0,
    contact:{ kind:'wechat', value:'demo_contact_008' } }
];

function main() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });

  const profiles = SEED.map((s, i) => ({
    id: 'u_seed' + (i + 1),
    uid: s.uid,
    name: s.name,
    grade: s.grade,
    major: s.major,
    dest: s.dest,
    org: s.org,
    exp: s.exp,
    msg: s.msg,
    mode: s.mode,
    ask: s.ask,
    freq: s.freq,
    time: s.time,
    requests: s.requests,
    updatedAt: new Date().toISOString()
  }));

  fs.writeFileSync(PROFILES, JSON.stringify(profiles, null, 2), 'utf8');
  fs.writeFileSync(REQUESTS, JSON.stringify([
    {
      id: 'r_seed1', toUid: '2022001', toId: 'u_seed1', fromUid: '2024001', fromName: '张某',
      fromMajor: '计算机科学与技术 2024级',
      question: '我是2024级计算机专业，想考XX大学，目前绩点3.6，想了解复试中项目经历该如何准备。',
      status: '待管理员转达', createdAt: new Date(Date.now() - 86400000).toISOString()
    }
  ], null, 2), 'utf8');

  // 联系方式单独落库并加密
  const store = require('../src/store');
  let n = 0;
  SEED.forEach(s => {
    if (s.contact) { store.setContact(s.uid, s.contact.kind, s.contact.value); n++; }
  });

  console.log('已播种：');
  console.log('  公开档案  ' + profiles.length + ' 条 -> ' + PROFILES);
  console.log('  联系方式  ' + n + ' 条（独立文件，键 ' + (process.env.XH_CONTACT_KEY ? '已配置' : '未配置（明文）') + '） -> ' + CONTACTS);
  console.log('  咨询请求  1 条 -> ' + REQUESTS);
  console.log('');
  console.log('可用模拟登录身份：');
  console.log('  毕业生（贡献者）: ' + SEED.filter(s => s.grade === '2022级').map(s => s.uid).join(', '));
  console.log('  在校生（同行者）: 2024001');
  console.log('');
  console.log('登录后访问 /auth/mock?uid=2022001 即可查看贡献者视角。');
}

main();
