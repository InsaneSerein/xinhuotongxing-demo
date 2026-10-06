# 薪火同行 · 朋辈经验共享与互助平台

毕业生经验沉淀与在校同学朋辈互助平台。本目录是一个**可直接部署的 Web 应用**，
不是静态页面：包含服务端、身份认证适配层、数据存储与权限控制。

---

## 一、为什么需要服务端

本项目最敏感的内容是**联系方式**与**谁看过谁的信息**。这两件事无法在纯前端实现：

| 需求 | 只有服务端能做 |
|---|---|
| 统一身份认证 | 校验票据需要服务端持有密钥 |
| 联系方式不泄漏 | 数据必须留在服务端，不能下发到浏览器 |
| 层级权限 | 权限判定必须在服务端，前端只是展示 |
| 审计与限流 | 需要持久化记录与统一计数 |
| 撤回与删除 | 必须能真正删除服务端数据 |

因此本应用采用「服务端渲染权限 + 前端展示」的结构。前端代码是公开的，
但**它不含任何真实数据，也无法绕过服务端权限**。

---

## 二、目录结构

```
xinhuo/
├── src/
│   ├── config.js      配置（认证方式、密钥、策略）
│   ├── auth.js        统一身份认证适配层（mock / CAS / OIDC）
│   ├── store.js       数据层（公开数据与联系方式分离存储）
│   └── server.js      HTTP 服务与路由
├── public/
│   ├── index.html     页面结构
│   ├── app.css        样式
│   └── app.js         前端逻辑（调用 API）
├── scripts/
│   ├── seed.js        写入演示数据
│   └── test-api.js    端到端接口测试（35 项）
├── data/              运行时生成，含个人信息，**须限制访问权限**
└── package.json
```

零外部依赖，仅使用 Node 内置模块。要求 **Node.js 18 或以上**。

---

## 三、本地运行

```bash
cd xinhuo
node scripts/seed.js        # 写入演示数据（可选）
node src/server.js          # 启动
# 浏览器打开 http://127.0.0.1:8080
```

默认使用**模拟登录**，登录页会列出几个测试身份，便于演示与验收。
模拟登录**不具备任何真实身份校验能力**，仅供本地测试。

运行接口测试：

```bash
node src/server.js          # 另开一个终端保持运行
node scripts/test-api.js    # 应输出「通过 35  失败 0」
```

---

## 四、接入学校统一身份认证

### 4.1 需要信息化中心提供的信息

请向信息化中心申请应用接入，并索取以下参数。**这是本平台上线的前置条件**，
没有这些参数无法完成真实认证。

**若学校使用 CAS 协议：**

| 参数 | 说明 | 环境变量 |
|---|---|---|
| CAS 登录地址 | 例如 `https://sso.xxx.edu.cn/cas/login` | `XH_CAS_LOGIN` |
| CAS 校验地址 | 例如 `https://sso.xxx.edu.cn/cas/serviceValidate` | `XH_CAS_VALIDATE` |
| 回调地址白名单 | 需将本平台地址报备，例如 `https://xh.xxx.edu.cn/auth/callback` | `XH_CAS_SERVICE` |
| 用户标识字段 | 返回报文里哪个字段是学号，通常为 `user` | `XH_CAS_USER_FIELD` |

**若学校使用 OAuth2 / OIDC：**

| 参数 | 环境变量 |
|---|---|
| 授权端点 | `XH_OIDC_AUTHORIZE` |
| 令牌端点 | `XH_OIDC_TOKEN` |
| 用户信息端点 | `XH_OIDC_USERINFO` |
| 客户端 ID | `XH_OIDC_CLIENT_ID` |
| 客户端密钥 | `XH_OIDC_CLIENT_SECRET` |
| 回调地址 | `XH_OIDC_REDIRECT` |

**另需向学工办确认：**

- 管理员学号白名单（谁可以进入管理端），填入 `XH_ADMINS`（逗号分隔）
- 是否需要向学校报备个人信息处理活动

### 4.2 切换认证方式

修改环境变量即可，**代码无需改动**：

```bash
# 使用 CAS
export XH_AUTH_MODE=cas
export XH_CAS_LOGIN=https://sso.xxx.edu.cn/cas/login
export XH_CAS_VALIDATE=https://sso.xxx.edu.cn/cas/serviceValidate
export XH_CAS_SERVICE=https://xh.xxx.edu.cn/auth/callback
export XH_ADMINS=2022001,2022002
export XH_SESSION_SECRET=<随机长字符串>
export XH_CONTACT_KEY=<32字节hex>
export NODE_ENV=production
node src/server.js
```

Windows PowerShell：

```powershell
$env:XH_AUTH_MODE='cas'
$env:XH_CAS_LOGIN='https://sso.xxx.edu.cn/cas/login'
# ... 其余同理
node src/server.js
```

切换后，登录页的「使用学校统一身份认证登录」按钮会真实跳转到学校认证页；
模拟登录入口自动关闭（返回 404）。

### 4.3 认证流程

```
浏览器 → /auth/login → 学校认证页（携带 service 参数）
                          ↓ 用户登录
浏览器 ← 学校认证页 ← 回调 /auth/callback?ticket=xxx
                          ↓
        服务端向 CAS validateUrl 校验票据（携带 client 凭据）
                          ↓ 校验通过，取回学号
        服务端建立会话 → 下发 HttpOnly Cookie → 跳转首页
```

**票据校验在服务端完成**，浏览器拿不到任何凭据。会话 Cookie 带 HMAC 签名且
`HttpOnly`，前端脚本无法读取。

---

## 五、隐私与安全设计

### 5.1 联系方式隔离（核心）

- 平台**不收集手机号与微信号作为公开字段**。用户可自愿填写联系方式，但它被写入
  独立的 `data/contacts.json`，**与公开数据物理分离**。
- 公开接口（`/api/people` 等）在任何情况下都不返回联系方式——代码中不存在这样的字段。
- 联系方式启用 AES-256-GCM 加密（`XH_CONTACT_KEY`）。
- 仅管理员可读取，且**每次读取都写入审计日志**。

> 这意味着：即使 `profiles.json` 被完整下载，也不会泄漏任何人的联络方式。

### 5.2 权限控制

层级判定**只在服务端进行**：

| 层级 | 判定依据 | 服务端下发内容 |
|---|---|---|
| 浏览者 | 已登录但未参与 | 仅寄语与基础标签 |
| 同行者 | 已参与、非毕业年级 | 全部经验内容 |
| 贡献者 | 已参与、毕业年级 | 全部经验内容 |
| 管理员 | 学号在 `XH_ADMINS` 白名单 | 额外可读中转队列与联系方式 |

### 5.3 其他防护

| 项目 | 措施 |
|---|---|
| 会话 | HMAC 签名 Cookie + `HttpOnly` + `SameSite=Lax`（生产环境加 `Secure`） |
| CSRF | 写操作必须携带 `x-csrf` 令牌，服务端常量时间比对 |
| XSS | 前端全部 HTML 转义；CSP 禁止内联脚本与外部资源 |
| 点击劫持 | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| 目录穿越 | 静态路径 `normalize` 后校验前缀 |
| 请求体 | 限制 256 KB |
| 登录限流 | 单 IP 10 分钟 10 次 |
| 会话过期 | 默认 8 小时，定时清理 |

---

## 六、上线检查清单

部署前请逐项确认：

- [ ] 已取得信息化中心的 CAS / OIDC 接入参数
- [ ] 已确认回调地址，并在学校侧完成白名单报备
- [ ] `XH_SESSION_SECRET` 已改为随机长字符串（**不得使用默认值**）
- [ ] `XH_CONTACT_KEY` 已配置为 32 字节 hex（用于加密联系方式）
- [ ] `XH_ADMINS` 已填入学工办指定的管理员学号
- [ ] `NODE_ENV=production`
- [ ] `data/` 目录权限已收紧（仅服务进程账号可读写）
- [ ] 服务以 HTTPS 对外提供（建议由 Nginx 反向代理并配置证书）
- [ ] 已确认信息保存期限（默认毕业后 3 年）与到期清理机制
- [ ] 已向学院学工办报备，并确定第一责任人
- [ ] 已删除演示数据（`node scripts/seed.js` 写入的内容），替换为真实数据前先清空 `data/`

---

## 七、数据文件说明

| 文件 | 内容 | 敏感级别 |
|---|---|---|
| `data/profiles.json` | 公开档案（姓名、专业、去向、经验、寄语） | 中——不含联系方式 |
| `data/contacts.json` | 联系方式（加密存储） | **高——须最小权限** |
| `data/requests.json` | 咨询请求（**不含申请人联系方式**） | 中 |
| `data/audit.log` | 审计日志（登录、读联系方式、撤回等） | 中 |

**备份与迁移**：直接复制 `data/` 目录即可。若更换 `XH_CONTACT_KEY`，
原加密内容将无法解密，须重新收集。

**建议**：上生产后改用数据库（PostgreSQL / MySQL），本项目的数据层接口已做隔离，
只需替换 `src/store.js` 中的读写实现，业务代码无需改动。

---

## 八、常见问题

**Q：为什么不用共享文档或在线表格？**
A：在线表格无法实现「贡献后解锁」的层级权限，也无法保证联系方式不下发到浏览器。
一旦链接外传，全部内容（含联系方式）即暴露。本项目把这些约束放在服务端强制执行。

**Q：学生能看到源码，会不会绕过权限？**
A：前端代码公开不影响安全。所有数据都经服务端按层级裁剪后才下发，
前端拿不到未授权的字段；联系方式的读取接口还有独立的权限校验与审计。

**Q：模拟登录能直接上线吗？**
A：不能。`XH_AUTH_MODE=mock` 仅供本地演示，任何人都能任选身份进入。
正式环境必须使用 `cas` 或 `oidc`。

**Q：如何删除某个用户的数据？**
A：用户可在「我的」页面自助撤回并删除。管理员也可直接删除 `profiles.json`
中对应记录及 `contacts.json` 中的对应项。
