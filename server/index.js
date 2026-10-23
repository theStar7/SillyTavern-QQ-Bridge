/**
 * SillyTavern-QQ-Bridge 服务器入口
 * SillyTavern 与 NapCat (QQ) 之间的消息桥接中间件
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

const configManager = require('./utils/configManager');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const bridgeService = require('./services/bridgeService');

// 加载配置
try {
    configManager.load();
    logger.setLevel(configManager.get('logging.level') || 'info');
    logger.setMaxEntries(configManager.get('logging.maxLogEntries') || 500);
} catch (error) {
    console.error('加载配置失败:', error.message);
    process.exit(1);
}

// 创建 Express 应用
const app = express();
const server = http.createServer(app);

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（WebUI）
app.use(express.static(path.join(__dirname, '../public')));

// REST 和 WebSocket 共用认证（apiToken 为空时跳过认证）
function isAuthorized(req) {
    const apiToken = configManager.get('webui.apiToken');
    if (!apiToken) return true;

    const authHeader = req.headers['authorization'] || '';
    const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

    return token === apiToken;
}

app.use('/api', (req, res, next) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ success: false, error: '未授权：无效的 API Token' });
    }
    next();
});

// API 路由
app.use('/api', apiRoutes);

// 首页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 创建 WebSocket 服务器（用于实时日志推送）
const wss = new WebSocket.Server({
    server,
    path: '/ws',
    verifyClient: ({ req }, done) => done(isAuthorized(req), 401, 'Unauthorized')
});

wss.on('connection', (ws, req) => {
    const checkAuthorization = () => {
        if (isAuthorized(req)) return true;
        ws.close(1008, 'Unauthorized');
        return false;
    };
    logger.info('WebUI', '新的 WebSocket 客户端已连接');

    // 发送当前状态
    const status = bridgeService.getStatus();
    ws.send(JSON.stringify({ type: 'status', data: status }));

    // 发送历史日志
    const logs = logger.getLogs(50);
    ws.send(JSON.stringify({ type: 'logs', data: logs }));

    // 添加日志监听器
    const logListener = (logEntry) => {
        if (ws.readyState === WebSocket.OPEN && checkAuthorization()) {
            ws.send(JSON.stringify({ type: 'log', data: logEntry }));
        }
    };
    logger.addListener(logListener);

    // 定期发送状态更新
    const statusInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && checkAuthorization()) {
            const status = bridgeService.getStatus();
            ws.send(JSON.stringify({ type: 'status', data: status }));
        }
    }, 2000);

    ws.on('close', () => {
        logger.removeListener(logListener);
        clearInterval(statusInterval);
        logger.info('WebUI', 'WebSocket 客户端已断开');
    });

    ws.on('error', (error) => {
        logger.error('WebUI', `WebSocket 错误: ${error.message}`);
    });
});

// 获取端口
const port = configManager.get('webui.port') || 3000;

// 启动服务器
server.listen(port, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                                                               ║');
    console.log('║                                                               ║');
    console.log('║                                                               ║');
    console.log('║        S I L L Y T A V E R N   Q Q   B R I D G E              ║');
    console.log('║                                                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    logger.info('Server', `服务器已启动，端口: ${port}`);
    logger.info('Server', `WebUI 地址: http://localhost:${port}`);
    console.log('');
});

// 自动启动桥接服务
const autoStart = configManager.get('webui.enabled') !== false;
if (autoStart) {
    setTimeout(async () => {
        try {
            await bridgeService.start();
        } catch (err) {
            logger.error('Server', `自动启动桥接服务失败: ${err.message}`);
        }
    }, 1000);
}

// 优雅关闭
process.on('SIGINT', () => {
    logger.info('Server', '收到关闭信号，正在关闭服务...');
    bridgeService.stop();
    server.close(() => {
        logger.info('Server', '服务器已关闭');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    logger.info('Server', '收到终止信号，正在关闭服务...');
    bridgeService.stop();
    server.close(() => {
        logger.info('Server', '服务器已关闭');
        process.exit(0);
    });
});

module.exports = { app, server };
