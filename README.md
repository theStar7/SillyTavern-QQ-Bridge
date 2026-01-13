# SillyTavern-QQ-Bridge

**开发中，谨慎使用**

SillyTavern 与 NapCat (QQ) 之间的消息桥接中间件

这是一个功能完整的中间件应用，能够实现 SillyTavern（酒馆）与 NapCat（QQ OneBot 11）之间的双向消息转发，并提供现代化的 WebUI 控制面板。

---

## 什么是 SillyTavern-QQ-Bridge？

简单来说，这个工具可以让你：
1. 在 QQ 上给机器人发消息
2. 消息自动转发到 SillyTavern
3. SillyTavern 的 AI 生成回复
4. 回复自动发送回 QQ

这样你就可以在 QQ 上和 SillyTavern 的 AI 角色聊天了！

---

## 功能特性

### 核心功能
- **双向消息桥接**：QQ 私聊/群聊与 SillyTavern AI 对话互通
- **完整认证支持**：支持 SillyTavern 的 Basic Auth 和 API Key 认证
- **实时通信**：基于 WebSocket 的低延迟消息转发
- **灵活触发**：支持命令前缀（如 `#chat`）和 @ 机器人触发

### WebUI 控制面板
- **仪表盘**：实时查看服务状态和统计数据
- **配置管理**：可视化配置所有参数，无需手动编辑文件
- **实时日志**：在线查看和过滤运行日志
- **使用指南**：内置详细的配置说明文档

### 其他特性
- **访问控制**：支持用户/群组的黑白名单
- **回复延迟**：模拟打字效果，更自然的对话体验
- **自动重连**：WebSocket 断开后自动重连
- **对话记忆**：保持上下文的多轮对话

---

## 前置要求

在使用本工具之前，请确保你已经安装并配置好以下软件：

| 软件        | 说明                                   | 下载地址                                   |
| ----------- | -------------------------------------- | ------------------------------------------ |
| Node.js     | JavaScript 运行环境（建议 v18 或更高） | https://nodejs.org/                        |
| SillyTavern | AI 角色扮演前端（酒馆）                | https://github.com/SillyTavern/SillyTavern |
| NapCat      | QQ 机器人框架（OneBot 11 协议）        | https://github.com/NapNeko/NapCatQQ        |

**重要**：请确保 SillyTavern 和 NapCat 都能正常运行后，再来配置本桥接工具。

---

## 项目结构

```
SillyTavern-QQ-Bridge/
├── config/
│   └── config.yaml          # 配置文件
├── public/
│   ├── css/
│   │   └── style.css        # WebUI 样式
│   ├── js/
│   │   └── app.js           # WebUI 脚本
│   └── index.html           # WebUI 主页面
├── server/
│   ├── routes/
│   │   └── api.js           # REST API 路由
│   ├── services/
│   │   ├── bridgeService.js     # 核心桥接服务
│   │   ├── napCatClient.js      # NapCat 客户端
│   │   └── sillyTavernClient.js # SillyTavern 客户端
│   ├── utils/
│   │   ├── configManager.js # 配置管理器
│   │   └── logger.js        # 日志管理器
│   └── index.js             # 服务器入口
├── package.json
└── README.md
```

---

## 快速开始

### 第一步：下载并安装依赖

1. 下载本项目到本地
2. 打开终端（命令行），进入项目目录
3. 执行以下命令安装依赖：

```bash
cd SillyTavern-QQ-Bridge
npm install
```

等待安装完成即可。

---

### 第二步：配置 SillyTavern

SillyTavern 默认不允许外部程序访问，需要手动开启。

找到 SillyTavern 根目录下的 `config.yaml` 文件，进行以下修改：

```yaml
# 允许远程连接（必须开启）
listen: true

# 添加白名单（本机运行使用 127.0.0.1）
whitelist:
  - ::1
  - 127.0.0.1

# 如需认证（可选，但推荐开启以增加安全性）
basicAuthMode: true
basicAuthUser:
  username: "你的用户名"
  password: "你的密码"
```

修改完成后，**重启 SillyTavern** 使配置生效。

---

### 第三步：配置 NapCat

NapCat 需要开启 WebSocket 连接，以便本工具能够接收 QQ 消息。

1. 打开 NapCat 的网页配置界面
2. 找到「网络配置」或「连接设置」
3. 启用「反向 WebSocket」，地址填写：`ws://127.0.0.1:3001`
4. 保存配置

**注意**：如果你修改了端口号，后续步骤中也需要相应修改。

---

### 第四步：配置桥接服务

有两种方式可以配置本工具：

**方式一：通过 WebUI 配置（推荐）**

先启动服务（见第五步），然后在浏览器中打开控制面板进行可视化配置。

**方式二：手动编辑配置文件**

编辑 `config/config.yaml` 文件：

```yaml
# SillyTavern 连接配置
sillytavern:
  apiUrl: "http://127.0.0.1:8000"      # SillyTavern 的地址和端口
  basicAuth:
    enabled: false                      # 是否启用认证
    username: ""                        # 用户名（如已启用认证）
    password: ""                        # 密码（如已启用认证）

# NapCat 连接配置
napcat:
  wsUrl: "ws://127.0.0.1:3001"         # NapCat 反向 WebSocket 地址

# 回复触发配置
reply:
  triggerPrefixes:                      # 触发前缀列表
    - "#chat"
  requireAtInGroup: true                # 群聊是否需要 @ 机器人
```

---

### 第五步：启动服务

在项目目录下执行：

```bash
npm start
```

如果看到类似以下输出，说明启动成功：

```
[INFO] 服务器已启动，端口: 3000
[INFO] WebUI 控制面板: http://localhost:3000
```

---

### 第六步：访问控制面板

打开浏览器，访问：

```
http://localhost:3000
```

在控制面板中你可以：
- 查看各服务的连接状态
- 修改配置参数
- 启动/停止桥接服务
- 查看实时日志
- 测试连接是否正常

---

## 使用说明

### 如何触发对话

| 场景    | 触发方式         | 示例           |
| ------- | ---------------- | -------------- |
| QQ 私聊 | 直接发送消息即可 | `你好`         |
| QQ 群聊 | @ 机器人 + 消息  | `@机器人 你好` |
| QQ 群聊 | 使用命令前缀     | `#chat 你好`   |

**说明**：
- 私聊时直接发消息就会被转发
- 群聊时需要 @ 机器人或使用前缀（如 `#chat`），避免所有消息都被转发
- 前缀可以在配置中自定义

### 访问控制（黑白名单）

如果你只想让特定的人或群使用机器人，可以设置黑白名单：

- **白名单模式**：只有名单中的用户/群组可以使用（留空则不限制）
- **黑名单模式**：名单中的用户/群组将被拒绝

在 WebUI 的「配置」页面中可以设置。

---

## API 接口

供开发者使用的 REST API：

| 方法   | 路径                    | 说明                  |
| ------ | ----------------------- | --------------------- |
| GET    | `/api/status`           | 获取服务状态          |
| GET    | `/api/config`           | 获取当前配置          |
| POST   | `/api/config`           | 保存配置              |
| POST   | `/api/bridge/start`     | 启动桥接服务          |
| POST   | `/api/bridge/stop`      | 停止桥接服务          |
| POST   | `/api/test/sillytavern` | 测试 SillyTavern 连接 |
| POST   | `/api/test/napcat`      | 测试 NapCat 连接      |
| GET    | `/api/logs`             | 获取日志              |
| DELETE | `/api/logs`             | 清空日志              |
| DELETE | `/api/history`          | 清除对话历史          |

---

## 常见问题

### Q: 启动后提示端口被占用怎么办？

A: 默认使用 3000 端口，如果被占用，可以修改 `server/index.js` 中的端口号，或关闭占用该端口的程序。

### Q: SillyTavern 连接失败？

检查以下几点：
1. SillyTavern 是否已启动
2. `config.yaml` 中的 `listen: true` 是否已设置
3. 白名单是否包含 `127.0.0.1`
4. 端口号是否正确（默认 8000）

### Q: NapCat 连接失败？

检查以下几点：
1. NapCat 是否已启动并登录 QQ
2. 反向 WebSocket 是否已启用
3. WebSocket 地址和端口是否正确

### Q: 消息发送成功但没有收到回复？

检查以下几点：
1. 在 SillyTavern 中是否已选择 AI 角色和模型
2. AI 后端（如 OpenAI、Claude 等）是否配置正确
3. 查看 WebUI 日志是否有错误信息

---

## 安全提示

1. **不要**将 SillyTavern 直接暴露到公网
2. 生产环境请启用 Basic Auth 认证
3. 测试时使用 `0.0.0.0/0` 白名单存在风险，测试后请改回具体 IP
4. NapCat 的 access_token 请妥善保管

---

## 许可证

## 许可证

本软件使用 [CC-BY-NC-SA-4.0 (知识共享署名-非商业性使用-相同方式共享 4.0 国际许可协议)](LICENSE) 进行许可。

您可以：
- **分享**：在任何媒介以任何形式复制、发行本作品
- **演绎**：修改、转换或以本作品为基础进行创作

必须遵守以下条件：
- **署名**：必须给出适当的署名，提供指向本许可协议的链接
- **非商业性使用**：不得将本作品用于商业目的
- **相同方式共享**：如果您再混合、转换或者基于本作品进行创作，您必须基于与原先许可协议相同的许可协议分发您贡献的作品

