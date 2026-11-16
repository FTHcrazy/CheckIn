/**
 * 题库 · 计算机网络与 Web 安全。
 *
 * 网络侧重「为什么这样设计」，安全侧重「攻击链与防线分层」——
 * 两者在真实故障排查里总是同时出现。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_NETWORK: readonly InterviewQuestion[] = [
  // ── 计算机网络 ─────────────────────────────────────────────
  {
    id: "net-tcp-handshake",
    title: "TCP 三次握手与四次挥手",
    stem: "为什么握手是三次而不是两次？挥手为什么要四次？TIME_WAIT 的作用是什么？",
    answer: `- 三次握手：\`SYN\` → \`SYN+ACK\` → \`ACK\`。**两次不够**：服务端无法确认客户端的接收能力，且历史重复的 SYN 会建立无效连接。
- 四次挥手：\`FIN\` → \`ACK\` → \`FIN\` → \`ACK\`。因为 TCP 全双工，两端要各自关闭自己的发送方向，所以 ACK 与 FIN 不能合并。
- \`TIME_WAIT\` 等 2MSL：保证最后一个 ACK 能重传（若丢失对端会重发 FIN），并让旧连接的残留报文在网络中消亡，避免污染新连接。
- 大量 \`TIME_WAIT\` 集中在客户端（短连接多）会导致端口耗尽，解法是连接复用（keep-alive）、\`SO_REUSEADDR\`、或改成长连接。
- 追问：\`SYN Flood\` 利用半连接队列，防御靠 SYN Cookie 与队列扩容。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "medium",
    tags: ["网络", "高频", "基础"],
    topic: "TCP 连接管理",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-13",
  },
  {
    id: "net-tcp-vs-udp",
    title: "TCP 与 UDP 的取舍，以及 QUIC 为什么基于 UDP",
    stem: "既然 TCP 更可靠，为什么 HTTP/3 反而跑在 UDP 上？",
    answer: `- TCP：面向连接、可靠、有序、有流量与拥塞控制，代价是握手延迟、队头阻塞、内核态实现难以快速演进。
- UDP：无连接、不可靠、开销小，实时音视频与游戏优先选它，可靠性在上层按需自建。
- **QUIC 基于 UDP** 的原因：在用户态实现可靠传输与拥塞控制，可快速迭代；每条流独立，解决 TCP 层的队头阻塞；支持 0-RTT 与连接迁移（换网不断连）。
- 代价是 UDP 在部分网络被限速或封锁，需要回退到 TCP（HTTP/2）。
- 判断依据：延迟敏感 + 可容忍偶发丢包 → UDP/QUIC；强一致与简单实现 → TCP。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "medium",
    tags: ["网络", "原理", "2025"],
    topic: "传输层协议",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-15",
  },
  {
    id: "net-http-versions",
    title: "HTTP/1.1、HTTP/2、HTTP/3 的关键差异",
    stem: "每一代解决了上一代的什么问题？现在还有必要做域名分片和雪碧图吗？",
    answer: `- **HTTP/1.1**：持久连接 + 管道化（实际未普及），浏览器对同域并发约 6 个，因此产生了域名分片、雪碧图、资源合并等优化。
- **HTTP/2**：二进制分帧 + **单连接多路复用** + HPACK 头压缩 + 服务端推送（已废弃）。域名分片反而有害（多连接稀释优先级），雪碧图也不再必要。
- **HTTP/3**：基于 QUIC，解决 TCP 层队头阻塞（一个丢包不再阻塞所有流），握手 0-1 RTT，连接迁移友好。
- 现实约束：HTTP/2 需要 HTTPS；企业代理与老旧设备对 HTTP/3 支持有限，通常按 ALPN 协商自动降级。
- 面试加分点：讲清「队头阻塞在 HTTP/2 里从应用层转移到了 TCP 层」这一层因果关系。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "hard",
    tags: ["网络", "HTTP", "大厂"],
    topic: "HTTP 协议演进",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-10-27",
  },
  {
    id: "net-dns",
    title: "DNS 解析流程与优化",
    stem: "从输入域名到拿到 IP 经历了哪些查询？dns-prefetch 与 preconnect 有什么区别？",
    answer: `- 流程：浏览器缓存 → 系统缓存（hosts）→ 本地 DNS 服务器（递归查询）→ 根 → 顶级域 → 权威服务器。UDP 53 为主，响应过大或区域传送用 TCP。
- 优化手段：\`dns-prefetch\`（只做 DNS 解析）、\`preconnect\`（DNS + TCP + TLS 全握手）、\`preload\`（直接拉资源）；三者成本递增，按需使用。
- 减小延迟：CDN 就近解析、TTL 权衡（短 TTL 便于切流但增加解析次数）、HTTP/2 下减少域名数量。
- 常见故障：\`NXDOMAIN\`（记录不存在）、解析到的 IP 被墙或不可达、本地 DNS 污染（→ 用 DoH/DoT）。
- 排障命令：\`dig\` / \`nslookup\` 看权威与 TTL，\`curl -v\` 看实际连接的 IP。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "medium",
    tags: ["网络", "DNS", "性能"],
    topic: "DNS 解析",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-11",
  },
  {
    id: "net-cdn",
    title: "CDN 的工作原理与缓存失效",
    stem: "CDN 如何把请求导到最近节点？发版后如何让旧资源立即失效？",
    answer: `- 调度层：权威 DNS 按**地理位置与运营商**返回就近节点的 IP（或使用 Anycast），节点未命中则**回源**到源站。
- 缓存层：边缘节点按 \`Cache-Control\` 缓存，\`s-maxage\` 专门给共享缓存（CDN）用；\`Vary\` 影响命中率，别对 \`User-Agent\` 做 \`Vary\`。
- 失效策略：**文件名带 hash** 是首选（内容变则 URL 变，天然无需刷新）；必须刷新时用 CDN 的目录/URL 刷新接口，注意配额与生效延迟。
- 回源保护：预热、合并回源请求、限制回源并发，避免缓存击穿把源站打挂。
- 常见坑：源站 \`Set-Cookie\` 未剥离导致 CDN 不缓存、HTTPS 证书未在 CDN 配置、跨域头只在源站配了而边缘缓存未命中时丢失。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "medium",
    tags: ["网络", "CDN", "性能"],
    topic: "CDN 与边缘缓存",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-10-30",
  },
  {
    id: "net-tls-handshake",
    title: "TLS 握手：1.2 与 1.3 的差别",
    stem: "非对称加密与对称加密在握手中各做什么？TLS 1.3 为什么更快？",
    answer: `- 分工：**非对称**（RSA/ECDHE）用于协商出对称密钥并验证身份，**对称**（AES-GCM/ChaCha20）用于加密实际数据 —— 因为对称加密快几个数量级。
- TLS 1.2 需要 2-RTT（甚至更多），TLS 1.3 压缩到 **1-RTT**，会话恢复可 0-RTT（但 0-RTT 数据有重放风险，只用于幂等请求）。
- TLS 1.3 移除不安全套件（RSA 密钥交换、CBC、SHA-1），只保留前向安全的 ECDHE，并把证书加密传输，减少信息暴露。
- 证书校验链：域名匹配 + 有效期 + 签发链可信 + 吊销状态（OCSP/CRL）；任一环节失败浏览器直接拦。
- 前端相关：证书与中间证书缺失会导致部分安卓机握手失败（不报错只超时），排查用 \`openssl s_client -connect\`。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "hard",
    tags: ["网络", "HTTPS", "原理"],
    topic: "TLS 握手",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-03",
  },
  {
    id: "net-websocket",
    title: "WebSocket 的连接、心跳与重连",
    stem: "握手阶段发生了什么？为什么必须做心跳？断线重连要注意什么？",
    answer: `- 握手是一次 **HTTP Upgrade 请求**（\`Connection: Upgrade\` + \`Sec-WebSocket-Key\`），服务端返回 101 后升级为全双工帧协议。
- 心跳（ping/pong 或应用层心跳）是必需的：中间的 NAT/负载均衡会静默断开空闲连接，没有心跳就无法及时感知「假在线」。
- 重连要**指数退避 + 抖动**，避免服务端故障恢复瞬间被所有客户端同时打满（惊群）。
- 断线期间的消息要有补偿机制：本地队列 + 重连后按游标拉增量，而不是指望内存队列补发。
- 注意：代理层要允许 Upgrade（Nginx 需 \`proxy_set_header Upgrade/Connection\`），且负载均衡要支持长连接超时配置。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "basic",
    tags: ["网络", "WebSocket", "基础"],
    topic: "WebSocket 实践",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-24",
  },
  {
    id: "net-timeout-retry",
    title: "超时、重试与幂等",
    stem: "接口偶发超时该怎么设计重试？为什么重试可能造成重复下单？",
    answer: `- 超时含义要分清：\`connect timeout\`（连不上）、\`read timeout\`（连上了但没回）、整体超时；三者排查方向不同。
- 重试策略：只重试**幂等**请求与**可恢复**错误（5xx、网络错误、超时），不重试 4xx；次数 2-3 次，指数退避 + 抖动。
- 重复下单的根因：超时不代表服务端没执行，客户端重试会让同一操作执行两次。解法是**幂等键**（客户端生成 requestId，服务端去重）或业务唯一约束。
- 前端实践：提交按钮置 loading + 禁用；用 \`AbortController\` 支持取消；避免在 \`useEffect\` 里无脑重试。
- 观测：给每次重试打上 attempt 标记，否则监控里看到的是「成功率正常但用户体感很慢」。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "basic",
    tags: ["网络", "工程化", "基础"],
    topic: "请求重试与幂等",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-10-27",
  },
  {
    id: "net-http-methods-status",
    title: "HTTP 方法与状态码的语义",
    stem: "PUT 与 PATCH 有何区别？301/302/307/308 该怎么选？401 与 403 差在哪？",
    answer: `- **幂等性**：GET/PUT/DELETE 幂等，POST 不幂等，PATCH 不保证（取决于实现）。
- PUT 是**整体替换**，PATCH 是**局部修改**；PUT 更适合「客户端持有完整表示」的场景。
- 301（永久）会被浏览器缓存，慎用；302/307 是临时重定向，其中 **307/308 保证不改变请求方法与 body**（POST 仍为 POST），302/301 历史上可能被改成 GET。
- 401 未认证（需要登录），403 已认证但无权限，404 资源不存在（也常用作隐藏存在性），409 冲突，422 语义校验失败，429 限流。
- 实践建议：新增优先用 201/204/400/409/422 这类语义明确的码，避免一律 200 + 业务 code 的「全 200 哲学」让网关与监控失效。`,
    track: "foundation",
    categoryId: "foundation-network",
    difficulty: "basic",
    tags: ["网络", "HTTP", "基础"],
    topic: "HTTP 语义",
    reviewedAt: "2026-11",
    heat: 58,
    updatedAt: "2026-11-02",
  },

  // ── HTTP / HTTPS 与安全 ────────────────────────────────────
  {
    id: "sec-xss",
    title: "XSS 的三种类型与防御",
    stem: "存储型、反射型、DOM 型 XSS 的攻击链有何不同？转义与 CSP 各挡哪一层？",
    answer: `- **存储型**：恶意内容落库（评论、昵称），所有访问者中招，危害最大；**反射型**：payload 在 URL/参数里被服务端原样回显；**DOM 型**：前端用 \`innerHTML\`/\`location\` 拼接，全程不经过服务端。
- 防御分三层：**输入校验**（白名单）、**输出转义**（按上下文：HTML/属性/JS/URL 各有规则）、**CSP**（禁内联脚本与非白名单域名，压缩后可配合 nonce/hash）。
- React/Vue 的插值默认转义，但 \`dangerouslySetInnerHTML\` / \`v-html\` 是逃生门，必须配 DOMPurify 清洗。
- Cookie 加 \`HttpOnly\` 可以让 XSS 拿不到会话，但不阻止 XSS 以用户身份发请求。
- 高阶点：\`Trusted Types\` 在浏览器层面强制显式声明，能从根上减少 DOM XSS。`,
    track: "foundation",
    categoryId: "foundation-security",
    difficulty: "hard",
    tags: ["安全", "XSS", "高频"],
    topic: "Web 安全 · XSS",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-16",
  },
  {
    id: "sec-csrf",
    title: "CSRF 的原理与防御",
    stem: "为什么加了自定义请求头就能防 CSRF？SameSite 的三个取值各是什么语义？",
    answer: `- 原理：浏览器会**自动携带目标域的 Cookie**，攻击者页面诱导用户发起请求，服务端无法区分是否是用户本意。
- 防御一：**CSRF Token**（会话绑定的一次性 token，放在表单或自定义头里），攻击者读不到跨域响应所以拿不到 token。
- 防御二：\`SameSite\` Cookie —— \`Strict\`（跨站不发送）、\`Lax\`（顶层 GET 导航发送，默认）、\`None\`（必须配 \`Secure\`）。
- 防御三：校验 \`Origin\`/\`Referer\`；把敏感操作改用 POST/PUT 并加自定义头，可借 CORS 预检把简单请求挡掉。
- 注意：纯前后端分离 + token 放 \`Authorization\` 头（不用 Cookie）天然免疫 CSRF，但要把 XSS 的防线补齐。`,
    track: "foundation",
    categoryId: "foundation-security",
    difficulty: "medium",
    tags: ["安全", "CSRF", "高频"],
    topic: "Web 安全 · CSRF",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-08",
  },
  {
    id: "sec-csp",
    title: "CSP 怎么落地",
    stem: "写一条实际可用的 CSP 策略，并说明 nonce 与 report-uri 的作用。",
    answer: `- 典型策略：\`default-src 'self'; script-src 'self' 'nonce-xxx' https://cdn.example.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.example.com; frame-ancestors 'none'\`。
- \`script-src\` 尽量不要 \`'unsafe-inline'\` / \`'unsafe-eval'\`；必须内联时用 **nonce**（每次响应随机）或 **hash**。
- \`report-to\` / \`report-uri\` 收集违规报告，先以 \`Content-Security-Policy-Report-Only\` 灰度观察，再切强制模式 —— 否则一上线就会把站打断。
- \`frame-ancestors\` 替代 \`X-Frame-Options\` 防点击劫持；\`upgrade-insecure-requests\` 把 http 资源自动升级。
- 落地难点通常在建站工具链（第三方统计、客服脚本、动态 eval 的库），需要把这些域名逐条加白并定期收敛。`,
    track: "foundation",
    categoryId: "foundation-security",
    difficulty: "medium",
    tags: ["安全", "CSP", "工程化"],
    topic: "Web 安全 · CSP",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-12",
  },
  {
    id: "sec-https-mitm",
    title: "HTTPS 能否被中间人攻击",
    stem: "什么情况下 HTTPS 也会被劫持？HSTS 与证书锁定分别防什么？",
    answer: `- 正常情况：TLS 保证机密性与完整性，中间人无法解密，除非拿到受信任的私钥或让客户端信任伪造证书。
- 可被攻击的场景：客户端信任了攻击者安装的根证书（企业代理、恶意软件）、用户手动点「继续访问」、证书校验被应用自行关闭。
- **HSTS**：\`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload\` 让浏览器此后强制 https，避免首次 http 请求被劫持降级。
- **证书锁定（pinning）** 在客户端固定公钥/证书哈希，防止任意受信 CA 被滥用签发，但运维成本高、轮换风险大，Web 场景较少用。
- 前端相关的现实风险是**混合内容**：https 页面加载 http 资源会被浏览器拦截或降级，必须全站 https。`,
    track: "foundation",
    categoryId: "foundation-security",
    difficulty: "medium",
    tags: ["安全", "HTTPS", "原理"],
    topic: "Web 安全 · 传输安全",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-09",
  },
  {
    id: "sec-jwt-vs-session",
    title: "JWT 与 Session 的选型",
    stem: "JWT 无法主动失效怎么办？前后端分离项目该选哪个？",
    answer: `- Session 存服务端，客户端只持 ID：可即时失效、体积小，但需要共享存储（Redis）或粘性会话，横向扩容有成本。
- JWT 自包含、无状态、易跨服务验证；代价是**无法主动撤销**、体积大（每请求都带）、载荷可被解码（不能放敏感信息）。
- 折中方案：短有效期 access token + 长效 refresh token（refresh 存服务端可撤销），或维护一个「失效黑名单/版本号」。
- 存储位置：\`localStorage\` 易被 XSS 读取；\`HttpOnly\` Cookie 免疫 XSS 读取但要配 \`SameSite\` 防 CSRF —— 两者都要在其他层补齐。
- 结论式回答：**需要强撤销能力 → Session 或「短 JWT + 服务端会话表」；纯无状态微服务 → JWT**，别把 JWT 当万能方案。`,
    track: "foundation",
    categoryId: "foundation-security",
    difficulty: "medium",
    tags: ["安全", "鉴权", "高频"],
    topic: "Web 鉴权方案",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-10-23",
  },
  {
    id: "sec-cookie-attributes",
    title: "Cookie 的关键属性",
    stem: "HttpOnly、Secure、SameSite、Domain、Path、Max-Age 分别控制什么？",
    answer: `- \`HttpOnly\`：JS 不可读，防 XSS 窃取会话；\`Secure\`：仅 https 传输。
- \`SameSite\`：\`Strict\` 最严（跨站不带）、\`Lax\` 默认（顶层 GET 导航带上）、\`None\` 必须配 \`Secure\`。
- \`Domain\` 决定可共享的子域（\`example.com\` 会包含 \`a.example.com\`），\`Path\` 限制路径匹配，二者都**不是**安全边界。
- \`Max-Age\`/\`Expires\` 控制持久化；不设则是会话 Cookie，关浏览器即失效。
- 前缀加固：\`__Host-\` 要求 Secure + Path=/ + 无 Domain，\`__Secure-\` 只要求 Secure，能防止子域覆盖主域 Cookie。`,
    track: "foundation",
    categoryId: "foundation-security",
    difficulty: "basic",
    tags: ["安全", "Cookie", "基础"],
    topic: "Cookie 与安全属性",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-11-08",
  },
  {
    id: "sec-supply-chain",
    title: "前端供应链安全怎么防",
    stem: "第三方脚本与 npm 依赖分别有哪些风险？如何收敛攻击面？",
    answer: `- **第三方脚本**（统计、客服、A/B 工具）在前端拥有与主站同等的权限，一旦被篡改可读取页面全部数据。收敛手段：\`integrity\` 校验（SRI）、CSP 限定来源、异步加载并隔离到 iframe、定期清理不再使用的脚本。
- **npm 依赖**：恶意包、投毒更新、同名抢注（typosquatting）、以及传递依赖的深度扩散。手段：锁文件入库、\`npm audit\`/SCA 扫描、限制安装脚本（\`ignore-scripts\`）、私有 registry 与内部白名单。
- 构建期：\`postinstall\` 是常见投毒入口，CI 里应禁用或审计；构建产物要能追溯到具体 commit 与依赖版本（SBOM）。
- 运行期：给敏感操作加二次校验（如转账需密码），把「前端被攻破」当成必然事件设计。
- 组织层面：依赖升级有节奏、有 owner，避免长期无人维护的包成为定时炸弹。`,
    track: "foundation",
    categoryId: "foundation-security",
    difficulty: "hard",
    tags: ["安全", "供应链", "2026"],
    topic: "前端供应链安全",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-10-28",
  },
];
