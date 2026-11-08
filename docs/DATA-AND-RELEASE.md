# 数据位置、隐私与分发

## 数据不全在数据库里

| 位置 | 内容 | Git／标准发布包 |
| --- | --- | --- |
| `config/buddy.json` | 实际性格、习惯、语气、群规则、应用标识、权限和资源白名单、定时任务、模型设置 | 排除 |
| `.private/apps/*.env` | 飞书 App ID、App Secret | 排除 |
| `.private/memory.json` | 手工填写的私聊／共享背景知识 | 排除 |
| `.private/slo-memory.sqlite` | 长期事实、摘要、用于摘要的对话轮次及来源、修订记录 | 排除 |
| `.private/<应用ID>/state.json` | 所有者配对、群与成员身份、近期历史、线程 ID、任务及去重状态、卡片状态 | 排除 |
| `.private/scheduler.json` | 定时任务运行状态与执行记录 | 排除 |
| `.private/codex/`、`.private/image-workers/` | 本机 Codex 认证副本、隔离运行状态、会话与可能的生成数据 | 排除 |
| `.private/network.json` | 本机代理等网络环境配置，可能含认证信息 | 排除 |
| `.private/` 其他文件 | 会话目录、文档登记、运行锁等 | 整个目录排除 |
| `logs/` | 结构化服务日志和原始错误日志；可能含身份或诊断信息 | 排除 |
| `artifacts/` | 接收、生成、下载的附件、截图和发布包 | 排除 |
| `workspace/` | 用户提供或创建的工作文件 | 排除 |
| `STATUS.md` | 维护者本地调试与验证记录 | 排除 |
| `~/.codex/AGENTS.md`、`~/.codex/auth.json` | 项目外的基础人设和认证来源 | 不属于仓库，不复制到发布包 |
| `config/buddy.example.json` | 全新用户的通用默认值，不含个人配置与身份 | 包含 |
| `examples/feishu.env.example` | 空白凭证模板 | 包含 |

性格配置和手工背景知识没有被迁移或删除，只是从 Git 和发布物里排除。Git 不是个人数据备份。

## 哪些内容会离开本机

“不在发布包里”不等于“永远不离开本机”：

- 普通聊天调用 Codex 时，会向模型服务发送当前请求所需的人设、选定历史、相关记忆、可见背景知识和图片等。
- 飞书消息、图片上传和文档操作会传给飞书；天气查询将城市信息用于天气服务请求。
- 本地文件只有在相应工具允许并被调用后才会读取，但被用于回答的内容可能进入模型上下文。

给其他人使用时，对方必须配置自己的凭证与登录。不要共享自己的 `.private/`，也不要把个人 AGENTS.md 加入通用模板。

## 标准发布流程

```sh
npm test
git status --short
git add README.md docs src scripts skills test examples config/buddy.example.json package.json package-lock.json .gitignore
git commit -m "Prepare distributable Slo-Buddy release"
npm run package
```

打包脚本：

1. 从 `HEAD` 读取文件清单，只接受源码、测试、文档和明确的通用模板路径。
2. 拒绝不在发布白名单中的路径，并扫描常见凭证、真实飞书 ID 和主机用户目录。
3. 要求工作区干净，避免把未提交的实现误当成已发布。
4. 使用 `git archive` 生成 `artifacts/releases/Slo-Buddy-v<版本>-<提交>.tar.gz`，附 SHA-256 校验文件，不包含 Git 历史。

脚本检查是额外保护，不是通用的秘密识别保证。新增资源类型时应先明确是否可发布，再调整白名单。Git 忽略规则也无法撤销已经进入旧提交的数据，因此不要使用 `git add -f` 添加个人文件。

如果系统 Git 被开发工具许可状态阻塞，可通过 `GIT_BIN` 指定已有且可用的 Git；脚本也会尝试 macOS 开发工具中的 Git 可执行文件，不会自动接受许可或修改系统设置。

只把发布包和校验文件发给接收者。不要直接压缩正在使用的整个项目目录；那会绕过 Git 忽略规则。发布包里含源码和使用文档，不含 `node_modules`，接收者需要 `npm ci`。

## 更新与备份

- 更新前停止服务，备份本机 `config/buddy.json`、`.private/` 和需要保留的文件；备份本身也含敏感数据。
- 更新源码时保留自己的配置、数据和工作目录，运行 `npm ci`、`npm test` 后再启动。
- 不要在服务运行时用另一个进程打开并写入同一 SQLite 数据库。当前 SQLite 采用 sql.js 单进程导出持久化，不是多实例数据库服务。
- `npm run setup` 不覆盖已有文件，也不承担未来版本配置或数据库迁移。升级需阅读对应版本说明。
- 替换账号时需要自己的重新登录与应用配对，不应继承上一位用户的授权状态。

## 当前发布范围

本版是本地 Git 仓库与源码发布包，不会自动推送到 GitHub，也不会发布到 npm。仓库保留当前项目既有的 package 元数据；对外开源前请由维护者明确许可证、支持范围和第三方服务使用条件。

## 定向分发时附带指定背景知识

可额外提供一份明确允许分享的 Markdown 文件：

```sh
npm run package -- --shared-knowledge artifacts/recipient-knowledge.md
```

该文件只作为当前发布包的附加种子写入 `examples/background-knowledge.json`，不从本机 `.private/memory.json` 读取，也不进入 Git。初始化时仅在 `.private/memory.json` 尚不存在时写入，私聊背景为空，不覆盖接收者已有知识。

附带的成员 open_id 只是背景资料，不会自动加入机器人白名单或配对权限。open_id 与应用身份相关，换应用后需重新确认，不能仅凭名字或背景里的 ID 就假定身份已经验证。维护者应只提供已获准分享的资料，不要直接复制自己的完整背景知识。
