# 给 DSH 看：接入 QQ 的运行手册

> 你是执行者。用户可能完全不懂命令行，**每一步都要自己验证通过再往下走**，不要把验证工作丢给用户。
> 本手册对应"用户只做 5 件事"的简化流程，其余全部是你的活。

---

## 0. 铁律

1. **缺资料就直接问用户，不要猜、不要编。** 缺什么问什么，一次问清（见 §3）。
2. **每步都有"通过判据"**，判据不过就先按失败分支处理，不要往下走。
3. **改完文件要记得让改动生效**：
   - 改 `config.json` / `state\current-role.json` / `roles\*.md` → **重启桥接**
   - 改 `dsh\agent-presets\*`、`plugins\qq-agent-presets\*`、`~\.dsh` 下的 profile → **重启 DSH**
   - 改 `SnowLuma\config\*.json` → **重启 SnowLuma**
4. 桥接同目录只能有一个实例（`state\bridge.lock`）。要重启先杀锁内 PID，别让用户看到 `bridge already running`。
5. 判断桥接是否真的活着，**只看一行**：`SnowLuma 已连接：ws://127.0.0.1:3001`。看到"桥接已启动"不算数。
6. 用户会主动提供权限（提示词里会写"向你索要权限直接提供"）。需要写 `~\.dsh`、`D:\qq-bridge`、`D:\SnowLuma` 就正常申请，**不要为了绕开限制去改路径**。

---

## 1. 用户会做什么（你收到的提示词就长这样）

用户拿到的步骤是固定的 5 步，他做完第 4 步之后会来找你，原话大致如下：

```
阅读工作区内 dsh-qq-kit 文件夹内的文档，自动更新 D:\qq-bridge 和 D:\SnowLuma 中的程序。
我的大号QQ号：__________，小号QQ号：__________。
```

他的 5 步是：

| 步 | 用户做的事 | 是否可被 AI 替代 |
|---|---|---|
| 1 | 桌面 QQ **只登小号**（扫码） | ❌ 必须人工 |
| 2 | 打开 `scripts\installer\snowluma下载网站.txt` 里的网址下载 zip → 解压到 `D:\SnowLuma`；双击 `launcher.bat`；浏览器里改 WebUI 密码 | 解压/启动可代做；**扫码与改密必须人工** |
| 3 | 双击 `scripts\installer\安装qq-bridge.bat`，遇到 Y/N 答 Y，记事本里填号 | 可代做，但用户双击更省事 |
| 4 | 双击 `scripts\一键部署.bat` | 可代做（内容见 S7） |
| 5 | 把上面那段提示词发给你 | — |

之后他的**日常使用**是三步：① 扫码登录小号 ② 双击 `D:\SnowLuma\launcher.bat` ③ 双击 `D:\qq-bridge\启动.bat`。
报错或不回复时，他会让你自己查。

---

## 2. 分工表（先明确边界，别越界）

| 动作 | 谁做 | 说明 |
|---|---|---|
| 登录 QQ 小号（扫码） | **人工** | AI 无法代扫码 |
| 设 SnowLuma WebUI 密码 | **人工** | 密码归用户；AI 不设、不问、不代填 |
| 解压 SnowLuma、查版本、改 `runtime.json` | AI | 纯文件操作 |
| 双击 `launcher.bat`、盯日志 | AI 可做 | `Start-Process`，不要前台阻塞 |
| 装 qq-bridge、填 `config.json` | AI 可做 | 用户已装好则跳过 |
| 装 DSH 预设、修 `{{cwd}}`、对齐端口、起桥接、验收 | AI | 见 S6–S9 |

---

## 3. 开工前：把缺的信息一次问全

```
开始前我需要确认几件事：
1. 大号 QQ 号：______（ownerQQ，只有它能下管理员指令）
2. 小号 QQ 号：______（机器人要登的那个）
3. 教程包在哪个目录？（里面有 scripts\installer\ 和 2-给DSH看-运行手册.md）
4. qq-bridge 装在哪个目录？默认 D:\qq-bridge
5. SnowLuma 在哪个目录？默认 D:\SnowLuma
6. 第 2 步做完了吗？（解压 + 双击过 launcher.bat + 浏览器里改过密码）
7. 电脑上现在登录了几个 QQ？（必须只有小号一个）
```

**必须问用户**：大号号、小号号、教程包路径、第 2 步是否完成。
**不要问、自己算**：DSH 当前端口（`sync-dsh-port.mjs --dry`）、`accessToken`（读 `onebot_<小号>.json`）、profile 名（列 `~\.dsh\profiles`）。

---

## 4. 环境探查

```powershell
# DSH 是否在跑、端口是多少（不要用固定端口）
netstat -ano | Select-String 'LISTENING' | Where-Object { $_.Line -match ':(\d+)\s' }

# 桥接
Test-Path D:\qq-bridge\config.json
Test-Path D:\qq-bridge\src\bridge.js

# SnowLuma（应有 launcher.bat / node.exe / native）
Get-ChildItem D:\SnowLuma -Force | Select-Object Name

# 桥接用的 node：教程包安装器的便携版 → 系统 node
& '<kit>\scripts\installer\_runtime\node\node.exe' -v
```

判定：
- `D:\qq-bridge` 不存在 → 见 S5（叫用户双击安装器，或你自己跑）
- `D:\SnowLuma` 不存在 → 见 S2
- node 版本 < `v22.13.0` → 见 S5

---

## 5. 你要做的 9 件事

### S1 · 认教程包结构（先把路径搞对）

```
<kit>\
  scripts\
    installer\     安装qq-bridge.bat / install-node.ps1 / snowluma下载网站.txt / 说明.txt
    启动.bat 一键部署.bat sync-dsh-port.mjs watch-dsh-port.mjs fix-preset-cwd.mjs
    reference\     桥接原生 start.bat（内部零件，不要单独双击）
  extras\  diary\（日记工具，需自填 API key）、phone-mcp\（安卓手机 MCP，需 ADB）
```

> `extras\` 与聊天主链路无关，用户没主动提就别装。

### S2 · 校验 SnowLuma 解压结果（对应第 2 步）

```powershell
Get-ChildItem D:\SnowLuma -Force | Select-Object Name
Get-ChildItem C:\Users\sun\Downloads,'D:\SnowLuma' -Filter 'SnowLuma-*.zip' -ErrorAction SilentlyContinue | Select-Object FullName,Length
```

通过判据：`D:\SnowLuma` 下**直接**看到 `launcher.bat`、`node.exe`、`native\`（`config\` 是首次启动后生成的，此时可以没有）。若只看到一个 `SnowLuma-v1.14.20-win-x64\` 子目录 → 把里面内容上提到根目录。

版本必须是 **1.14.20**；若用户下成 2.x，让他按 `scripts\installer\snowluma下载网站.txt` 里的网址重下（36.09 MB，sha256 `0ca7bd4a…`）。

### S3 · 打开自动注入（`hookAutoLoad`）

`hookAutoLoad` = 发现 QQ 进程后是否自动注入。`false` 要人去 WebUI 点「加载/注入」；`true` 启动即自动挂。

**注意顺序**：`D:\SnowLuma\config\runtime.json` 是**首次启动后**才生成的。文件不存在时，先让用户双击一次 `launcher.bat`（看到 `listening 127.0.0.1:5099` 即可）、关掉窗口，再改。

```powershell
$p = 'D:\SnowLuma\config\runtime.json'
$j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
$j.hookAutoLoad = $true
[System.IO.File]::WriteAllText($p, ($j | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
```

通过判据：`Get-Content $p` 能看到 `"hookAutoLoad": true`。**不写 BOM**。
改完**重启 SnowLuma** 才生效。

### S4 · 人工闸门 + 双端口确认

| # | 条件 | 怎么验 | 谁做 |
|---|---|---|---|
| ① | 小号已登录且被注入 | 日志有 `[Hook] login detected: PID=... UIN=<小号>` | **人工** |
| ② | SnowLuma WebUI 已登录并改过密码 | 黑窗口打印过 `initial credentials: user=admin password=...`；用户口头确认已改 | **人工** |
| ③ | OneBot 双端口都在听 | `netstat -ano \| findstr /C:":3000 " \| findstr LISTENING` 与 `:3001` **两个都非空** | AI 检查 |

③ 长期不满足 → 让用户登录 `http://127.0.0.1:5099` → OneBot 配置 → 勾选 HTTP(3000) + WS(3001) 保存。

> 为什么卡这一关：`启动.bat` 会等 3001 才拉桥接，但 **3001 在用户改密码之前就可能出现**；此时起桥接，用户还在浏览器里操作，最后会表现为"桥接起来了但机器人没反应"，极难排查。

### S5 · qq-bridge（对应第 3 步）

用户没装 → 让他双击 `<kit>\scripts\installer\安装qq-bridge.bat`：
问目录直接回车（`D:\qq-bridge`），遇到 Y/N 答 **Y**，它会把 `install-node.ps1` 的便携 Node（`<kit>\scripts\installer\_runtime\node`）用上，然后下 qq-bridge + `npm install` + 生成 `config.json` + 弹记事本。

> 它说"填三个值"，实际只填两个：`ownerQQ`、`allow.private`；`snowluma.accessToken` **留空**。
> 它末尾说"双击这个文件夹里的 启动.bat"是旧流程，正确下一步是第 4 步的 `一键部署.bat`。

装完检查：`src\bridge.js` 存在、`node_modules` 非空、`config.json` 存在。
失败分支：下载失败 → 浏览器下 `https://gh-proxy.com/https://github.com/pinganbbOvO/qq-bridge/archive/refs/heads/main.zip` 解压到 `D:\qq-bridge` 再 `npm install`；`npm install` 报 `patch-snowluma-sdk` → 重跑一次。

### S6 · 写 `config.json`

```powershell
$f = 'D:\qq-bridge\config.json'
$c = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json
$c.ownerQQ = <大号>
$c.allow.private = @(<大号>, <小号>)
$c.allowAllWhenEmpty = $false
$c.agentPreset = 'qq-chat'
$c.snowluma.homeDir = 'D:\SnowLuma'
$c.snowluma.launcherPath = 'D:\SnowLuma\launcher.bat'
$c.dsh.baseUrl = 'http://127.0.0.1:' + (DSH 当前端口)
[System.IO.File]::WriteAllText($f, ($c | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
```

**不要手工拼 JSON 字符串**（会写坏转义）。**不要写 BOM**（Node 报 `SyntaxError: Unexpected token '\uFEFF'`）。
`dsh.baseUrl` 写错也能救：S8 的 `sync-dsh-port.mjs` 会自动对齐。

### S7 · 一键部署的内容（对应第 4 步）

用户双击 `<kit>\scripts\一键部署.bat` 会做三件事（你也可代做）：

```powershell
Copy-Item <kit>\scripts\启动.bat           D:\qq-bridge\启动.bat -Force
Copy-Item <kit>\scripts\sync-dsh-port.mjs  D:\qq-bridge\scripts\sync-dsh-port.mjs -Force
Copy-Item <kit>\scripts\watch-dsh-port.mjs D:\qq-bridge\scripts\watch-dsh-port.mjs -Force
& <node> <kit>\scripts\fix-preset-cwd.mjs D:\qq-bridge
```

`fix-preset-cwd.mjs` 把 4 处 `suffix: ...{{cwd}}...` 改成 `Your working directory is the QQ chat workspace.`（2 个源 yml + 2 个生成的 patch.yml），跳过 `#` 注释行；干净时只打印 `✅ 4 处全是好的`。
症状长这样：`unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model`。

### S8 · 装 DSH 预设

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh\profiles" -Directory | Select-Object Name   # 通常 desktop
cd D:\qq-bridge
& <node> scripts\setup-dsh.mjs desktop
```

通过判据：输出含 `dsh plugin --profile desktop install: OK`，且 `~\.dsh\profiles\desktop\cordis.patch.yml` 有 3 条 MCP（`mcp-snowluma` / `mcp-snowluma-host` / `mcp-web-search-safe`）。

> ⚠️ 这个脚本会把 `C:\Users\<你>\.dsh\plugins\qq-agent-presets`（Junction）指向**你运行它的那个 qq-bridge 目录**。所以**必须用 `D:\qq-bridge` 跑**；如果用户之前拿测试目录跑过，删目录后要回来重跑一次，否则 DSH 的预设会断链。

### S9 · 对齐端口并启动桥接

```powershell
cd D:\qq-bridge
& <node> scripts\sync-dsh-port.mjs          # 或直接跑 --dry 只看不改
```

然后让用户双击 `D:\qq-bridge\启动.bat`（它会等 DSH → 对齐端口 → 等 3001 → 起 `dsh-port-watch` 看门狗 → `call start.bat`）。

通过判据（只认这个）：

```powershell
Get-Content D:\qq-bridge\state\bridge.log -Encoding UTF8 -Tail 20
# 出现：[bridge] SnowLuma 已连接：ws://127.0.0.1:3001
```

同时检查：`config.json` 的 `dsh.baseUrl` == DSH 当前端口；`state\bridge.lock` 与 `state\watch-dsh-port.lock` 内 PID 都存活。

> 首次连接必然先看到 `SnowLuma 错误：Received network error`、`token 自愈失败`、`自愈完成：账号 <小号>`，**这是正常过程**，随后才出现 `SnowLuma 已连接`。
> 若 `已连接` 之后又断，且日志出现 `code=1006` 后没有再次 `已连接` → 重启桥接（SnowLuma 重启过就必须重启桥接）。

**以上都过之后，如果 S8 之后还没重启过 DSH，提醒用户重启一次 DSH**（预设与 `{{cwd}}` 修复只在 DSH 启动时装配）。

---

## 6. 验收

让用户用**大号**给**小号**发「在吗」。

通过判据（任一即可）：
- `state\qq-activity.log` 出现 `消息已入未读：在吗` 且随后 `工具统一发送：成功 1/1 条`
- `state\tool-calls.jsonl` 出现 `mcp__snowluma__qq_send_message` 且 `"ok":true`
- `state\sessions.json` 的 `sessions` 里出现 `private:<大号>: session-xxxx`

首次验收后告诉用户：DSH 里会多一个「QQ 聊天」会话，属正常。

---

## 7. 日常运维（用户只做这三步）

1. 桌面 QQ 扫码登录**小号**
2. 双击 `D:\SnowLuma\launcher.bat`
3. 双击 `D:\qq-bridge\启动.bat`，等 `SnowLuma 已连接：ws://127.0.0.1:3001` 出现

你只需要在被叫到时记住：
- 关掉桥接窗口 = 机器人下线 = 不再消耗 token
- `reserved2` 模式**在线即持续消耗 token**（回合内循环等消息）；想只在有人说话时才动 → 控制台切 `chat`
- 控制台 `http://127.0.0.1:3100`，令牌在 `state\console-token`
- 人格：`state\current-role.json` = `{"role":"小鲸鱼","mode":"active"}`，人设 `roles\<角色名>.md`（角色名 = 文件名），改完重启桥接
- 管理员 QQ 可直接发：`/role <名>`、`/role off`、`/silent`、`/active`、`/reset`、`/status`
- `dsh-port-watch` 是看门狗窗口（每 20 秒复查 DSH 端口，变了就重启桥接），**别关**；关了下次双击 `启动.bat` 会重新拉起

---

## 8. 故障决策树（按报错串直接跳到动作）

| 现象 / 报错串 | 根因 | 动作 |
|---|---|---|
| QQ 里只收到「⏳ 系统服务重启中，消息已排队」 | `dsh.baseUrl` 不是 DSH 当前端口 | `node scripts\sync-dsh-port.mjs` → **重启桥接** |
| `DSH 事件流已结束（本次收到 0 帧）` 反复出现 | 同上 | 同上 |
| `bridge already running in another window` | 已有实例（可能是你起的） | 杀 `state\bridge.lock` 内的 PID，再起 |
| `已有实例在运行（锁文件 ...）` 但 PID 已死 | 过期锁 | 删 `state\bridge.lock` |
| `SnowLuma 错误：Received network error` 后无 `已连接` | SnowLuma 没起 / 3001 没开 | 起 SnowLuma，等 `listening 127.0.0.1:3001/`，再重启桥接 |
| `token 自愈失败 … 连不上 OneBot HTTP API` | 3000 不通（SnowLuma 刚重启/已挂） | 起好 SnowLuma，再重启桥接 |
| agent 处理出错：`` `tool_addition` blocks can only be in `system` messages `` | 该会话历史已损坏，重放坏块；重启 DSH 无效 | 备份 `state\sessions.json` → 写成 `{"sessions":{},"sessionPolicies":{}}` → 杀桥接重启 → 下条消息新建干净会话；旧会话留在 DSH 里别管 |
| `unknown prompt variable "{{cwd}}"` | 新版 DSH 不认 `{{cwd}}` | 跑 `fix-preset-cwd.mjs`，**重启 DSH** |
| 机器人身份变成"用户自己"（`自愈完成：账号 <大号>`、`机器人昵称: <用户昵称>`） | 桌面 QQ 同时登了大号+小号，端口被大号抢走 | 杀大号 QQ 进程组 → 重启 SnowLuma → 确认只剩小号 → 重启桥接 |
| SnowLuma 进程页「未检测到可加载 QQ 主进程」 | QQ 没起 | 先启动 QQ 并登录小号 |
| 找不到二维码 | SnowLuma 不产二维码 | 二维码在 **QQ 客户端自己的登录窗口** |
| `3000`/`3001` 没在监听 | 该账号的 `onebot_<小号>.json` 还没生成 | 登录 WebUI → OneBot 配置 → 勾 HTTP(3000)+WS(3001) 保存 |

---

## 9. 交付话术

1. 现在能用了：大号发消息 → 小号会回
2. 日常就三步：扫码登小号 → `launcher.bat` → `启动.bat`；`dsh-port-watch` 窗口别关
3. **SnowLuma 或 QQ 只要重开过，就必须重启一次桥接**
4. 不聊了就关桥接窗口，否则 `reserved2` 会持续消耗 token
5. 控制台 `http://127.0.0.1:3100` 能切模式、改人格；令牌在 `state\console-token`
