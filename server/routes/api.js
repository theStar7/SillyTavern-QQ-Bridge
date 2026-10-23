/**
 * REST API 路由
 * 提供 WebUI 所需的 API 端点
 */

const express = require('express');
const router = express.Router();
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');
const bridgeService = require('../services/bridgeService');
const sillyTavernClient = require('../services/sillyTavernClient');
const napCatClient = require('../services/napCatClient');

/**
 * 获取系统状态
 * GET /api/status
 */
router.get('/status', (req, res) => {
    try {
        const status = bridgeService.getStatus();
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取配置
 * GET /api/config
 */
router.get('/config', (req, res) => {
    try {
        const config = configManager.getSafeConfig();
        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 配置 schema 定义（键名 → 类型）
 * 只允许已知字段通过，拒绝未知键
 */
const CONFIG_SCHEMA = {
    sillytavern: {
        apiUrl: 'string',
        apiKey: 'string',
        basicAuth: {
            enabled: 'boolean',
            username: 'string',
            password: 'string'
        },
        characterId: 'string',
        apiMode: 'string'
    },
    napcat: {
        wsUrl: 'string',
        accessToken: 'string'
    },
    reply: {
        triggerPrefixes: 'array',
        requireAtInGroup: 'boolean',
        botQQ: 'string',
        replyDelay: 'number',
        maxReplyDelay: 'number',
        delayPerChar: 'number'
    },
    accessControl: {
        blacklist: 'array',
        whitelist: 'array',
        groupBlacklist: 'array',
        groupWhitelist: 'array'
    },
    webui: {
        port: 'number',
        enabled: 'boolean',
        apiToken: 'string'
    },
    logging: {
        level: 'string',
        maxLogEntries: 'number'
    }
};

/**
 * 校验配置对象，返回错误数组（空数组 = 合法）
 */
function validateConfig(data, schema, prefix = '') {
    const errors = [];

    for (const key of Object.keys(data)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;

        if (!(key in schema)) {
            errors.push(`未知配置项: ${fullPath}`);
            continue;
        }

        const expected = schema[key];
        const value = data[key];

        if (typeof expected === 'string') {
            // 基本类型校验
            if (expected === 'array') {
                if (!Array.isArray(value)) {
                    errors.push(`${fullPath} 应为数组`);
                }
            } else if (typeof value !== expected) {
                errors.push(`${fullPath} 类型错误：期望 ${expected}，实际 ${typeof value}`);
            }
        } else if (typeof expected === 'object' && expected !== null) {
            // 嵌套对象校验
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                errors.push(`${fullPath} 应为对象`);
            } else {
                errors.push(...validateConfig(value, expected, fullPath));
            }
        }
    }

    return errors;
}

/**
 * 保存配置
 * POST /api/config
 */
router.post('/config', async (req, res) => {
    let saved = false;
    try {
        const newConfig = req.body;

        // 验证必要字段
        if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
            return res.status(400).json({
                success: false,
                error: '配置数据不能为空且必须为对象'
            });
        }

        // 结构校验：拒绝未知键和类型错误
        const errors = validateConfig(newConfig, CONFIG_SCHEMA);
        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: '配置校验失败: ' + errors.join('; ')
            });
        }

        // 处理密码字段（如果是 ******, 保持原值）
        const currentConfig = configManager.get();

        if (newConfig.sillytavern?.apiKey === '******') {
            newConfig.sillytavern.apiKey = currentConfig.sillytavern?.apiKey;
        }

        if (newConfig.sillytavern?.basicAuth?.password === '******') {
            newConfig.sillytavern.basicAuth.password = currentConfig.sillytavern?.basicAuth?.password;
        }

        if (newConfig.napcat?.accessToken === '******') {
            newConfig.napcat.accessToken = currentConfig.napcat?.accessToken;
        }

        const stConfig = currentConfig.sillytavern || {};
        const stPatch = newConfig.sillytavern || {};
        const stChanged = ['apiUrl', 'apiKey'].some(key => key in stPatch && stPatch[key] !== stConfig[key]) ||
            ['enabled', 'username', 'password'].some(key => key in (stPatch.basicAuth || {}) && stPatch.basicAuth[key] !== stConfig.basicAuth?.[key]);
        const napChanged = ['wsUrl', 'accessToken'].some(key => key in (newConfig.napcat || {}) && newConfig.napcat[key] !== currentConfig.napcat?.[key]);
        if (stChanged && (sillyTavernClient.isProcessing || sillyTavernClient.messageQueue?.length)) {
            return res.status(409).json({ success: false, error: '正在处理消息，请稍后再修改 SillyTavern 连接配置' });
        }

        configManager.save(newConfig);
        saved = true;

        let napReconnecting = false;
        if (napChanged && (bridgeService.running || napCatClient.connected || napCatClient.ws || napCatClient.reconnectTimer)) {
            napCatClient.disconnect();
            napCatClient.connect();
            napReconnecting = true;
        }
        if (stChanged && (bridgeService.running || sillyTavernClient.initialized)) {
            sillyTavernClient.isProcessing = true;
            try {
                await sillyTavernClient.close();
                await sillyTavernClient.initialize();
            } finally {
                sillyTavernClient.isProcessing = false;
                sillyTavernClient.processQueue?.();
            }
        }

        res.json({
            success: true,
            message: napReconnecting ? '配置已保存；NapCat 正在重连，请查看连接状态' : '配置已保存'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: saved ? '配置已保存，但重新连接失败: ' + error.message : error.message
        });
    }
});

/**
 * 测试 SillyTavern 连接
 * POST /api/test/sillytavern
 */
router.post('/test/sillytavern', async (req, res) => {
    try {
        sillyTavernClient.initialize();
        const result = await sillyTavernClient.testConnection();
        res.json({
            success: result.success,
            data: result.data,
            error: result.error
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 测试 NapCat 连接
 * POST /api/test/napcat
 */
router.post('/test/napcat', async (req, res) => {
    try {
        // 如果已连接，返回当前状态
        if (napCatClient.connected) {
            res.json({
                success: true,
                data: napCatClient.getStatus()
            });
        } else {
            // 尝试连接
            napCatClient.connect();

            // 等待连接结果（最多 5 秒）
            let attempts = 0;
            const checkConnection = () => {
                return new Promise((resolve) => {
                    const interval = setInterval(() => {
                        attempts++;
                        if (napCatClient.connected || attempts >= 10) {
                            clearInterval(interval);
                            resolve(napCatClient.connected);
                        }
                    }, 500);
                });
            };

            const connected = await checkConnection();
            res.json({
                success: connected,
                data: napCatClient.getStatus(),
                error: connected ? null : napCatClient.lastError
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取角色列表
 * GET /api/characters
 */
router.get('/characters', async (req, res) => {
    try {
        const characters = await sillyTavernClient.getCharacters();
        res.json({
            success: true,
            data: characters
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 选择角色
 * POST /api/characters/select
 */
router.post('/characters/select', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({
                success: false,
                error: '角色名不能为空'
            });
        }
        const result = await sillyTavernClient.selectCharacter(name);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取聊天列表
 * GET /api/chats
 */
router.get('/chats', async (req, res) => {
    try {
        const chats = await sillyTavernClient.getChats();
        res.json({
            success: true,
            data: chats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 选择聊天
 * POST /api/chats/select
 */
router.post('/chats/select', async (req, res) => {
    try {
        const { chatId } = req.body;
        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: '聊天 ID 不能为空'
            });
        }
        const result = await sillyTavernClient.selectChat(chatId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 开始新聊天
 * POST /api/chats/new
 */
router.post('/chats/new', async (req, res) => {
    try {
        const result = await sillyTavernClient.startNewChat();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取当前角色和聊天信息
 * GET /api/current
 */
router.get('/current', async (req, res) => {
    try {
        const info = await sillyTavernClient.getCurrentInfo();
        res.json({
            success: true,
            data: info
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 启动桥接服务
 * POST /api/bridge/start
 */
router.post('/bridge/start', async (req, res) => {
    try {
        await bridgeService.start();
        res.json({
            success: true,
            message: '桥接服务已启动'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 停止桥接服务
 * POST /api/bridge/stop
 */
router.post('/bridge/stop', (req, res) => {
    try {
        bridgeService.stop();
        res.json({
            success: true,
            message: '桥接服务已停止'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取日志
 * GET /api/logs
 */
router.get('/logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = logger.getLogs(limit);
        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 清空日志
 * DELETE /api/logs
 */
router.delete('/logs', (req, res) => {
    try {
        logger.clear();
        res.json({
            success: true,
            message: '日志已清空'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 重置当前会话（保留保存的历史）
 * DELETE /api/history
 */
router.delete('/history', async (req, res) => {
    try {
        const userId = req.query.userId;
        const result = userId ? await sillyTavernClient.clearHistory(userId) : await sillyTavernClient.clearAllHistory();
        res.status(result.success ? 200 : 400).json({
            success: result.success,
            message: result.success ? '当前会话已重置，保存的历史仍然保留' : undefined,
            error: result.error
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 重置统计数据
 * POST /api/stats/reset
 */
router.post('/stats/reset', (req, res) => {
    try {
        bridgeService.resetStats();
        res.json({
            success: true,
            message: '统计数据已重置'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== API 设置管理 ====================

/**
 * 获取当前 API 设置
 * GET /api/api-settings
 */
router.get('/api-settings', async (req, res) => {
    try {
        const settings = await sillyTavernClient.getApiSettings();
        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 更改 API 设置
 * POST /api/api-settings
 * Body: { mainApi, chatCompletionSource, apiUrl, apiKey, modelId }
 */
router.post('/api-settings', async (req, res) => {
    try {
        const settings = req.body;
        const result = await sillyTavernClient.setApiSettings(settings);
        res.json({
            success: result.success,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取连接配置文件列表
 * GET /api/connection-profiles
 */
router.get('/connection-profiles', async (req, res) => {
    try {
        const profiles = await sillyTavernClient.getConnectionProfiles();
        res.json({
            success: true,
            data: profiles
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 切换连接配置文件
 * POST /api/connection-profiles/select
 * Body: { profile }
 */
router.post('/connection-profiles/select', async (req, res) => {
    try {
        const { profile } = req.body;
        if (!profile) {
            return res.status(400).json({
                success: false,
                error: '请指定配置文件'
            });
        }
        const result = await sillyTavernClient.selectConnectionProfile(profile);
        res.json({
            success: result.success,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 测试 API 连接
 * POST /api/test-connection
 */
router.post('/test-connection', async (req, res) => {
    try {
        const result = await sillyTavernClient.testApiConnection();
        res.json({
            success: result.success,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 发送测试消息
 * POST /api/test-message
 */
router.post('/test-message', async (req, res) => {
    try {
        const result = await sillyTavernClient.sendTestMessage();
        res.json({
            success: result.success,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
