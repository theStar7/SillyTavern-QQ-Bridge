/**
 * 桥接服务
 * 核心业务逻辑：处理 QQ 消息并转发到 SillyTavern
 */

const logger = require('../utils/logger');
const configManager = require('../utils/configManager');
const sillyTavernClient = require('./sillyTavernClient');
const napCatClient = require('./napCatClient');

class BridgeService {
    constructor() {
        this.running = false;
        this.stats = {
            messagesReceived: 0,
            messagesProcessed: 0,
            repliesSent: 0,
            errors: 0
        };
    }

    /**
     * 启动桥接服务
     */
    async start() {
        if (this.running) {
            logger.warn('Bridge', '桥接服务已在运行');
            return;
        }

        logger.info('Bridge', '正在启动桥接服务...');

        // 初始化 SillyTavern 客户端
        try {
            await sillyTavernClient.initialize();
        } catch (error) {
            logger.warn('Bridge', `SillyTavern 初始化失败: ${error.message}，服务仍将启动`);
        }

        // 测试 SillyTavern 连接
        const stResult = await sillyTavernClient.testConnection();
        if (!stResult.success) {
            logger.warn('Bridge', 'SillyTavern 连接测试失败，但服务仍将启动');
        }

        // 连接到 NapCat
        napCatClient.connect();

        // 注册消息处理器
        napCatClient.addMessageHandler(this.handleQQMessage.bind(this));

        this.running = true;
        logger.info('Bridge', '桥接服务已启动');
    }

    /**
     * 停止桥接服务
     */
    stop() {
        if (!this.running) {
            return;
        }

        logger.info('Bridge', '正在停止桥接服务...');

        napCatClient.disconnect();
        this.running = false;

        logger.info('Bridge', '桥接服务已停止');
    }

    /**
     * 处理 QQ 消息
     */
    async handleQQMessage(event) {
        this.stats.messagesReceived++;

        try {
            const messageType = event.message_type; // 'private' 或 'group'
            const userId = event.user_id?.toString();
            const groupId = event.group_id?.toString();
            const rawMessage = event.message;
            const sender = event.sender || {};

            // 提取纯文本消息
            const plainText = napCatClient.extractPlainText(rawMessage);

            if (!plainText) {
                logger.debug('Bridge', '收到空消息，忽略');
                return;
            }

            logger.info('Bridge', `收到 QQ 消息 [${sender.nickname || userId}]: ${plainText}`);

            // 访问控制检查
            if (!this.checkAccessControl(userId, groupId, messageType)) {
                logger.debug('Bridge', `消息被访问控制拦截: 用户=${userId}, 群=${groupId}`);
                return;
            }

            // 检查触发条件
            const { triggered, cleanMessage } = this.checkTrigger(plainText, rawMessage, messageType);
            if (!triggered) {
                logger.debug('Bridge', '消息未触发对话');
                return;
            }

            this.stats.messagesProcessed++;

            // 发送到 SillyTavern
            const conversationId = messageType === 'group' ? `group_${groupId}_${userId}` : `private_${userId}`;
            const result = await sillyTavernClient.sendMessage(
                conversationId,
                cleanMessage,
                sender.nickname || sender.card || `User_${userId}`
            );

            if (result.success && result.reply) {
                // 计算回复延迟
                const delay = this.calculateReplyDelay(result.reply);
                await this.delay(delay);

                // 发送回复
                if (messageType === 'private') {
                    await napCatClient.sendPrivateMessage(userId, result.reply);
                } else {
                    await napCatClient.sendGroupMessage(groupId, result.reply, userId);
                }

                this.stats.repliesSent++;
                logger.info('Bridge', `已发送回复: ${result.reply.substring(0, 50)}...`);
            } else {
                logger.error('Bridge', `获取回复失败: ${result.error}`);
                this.stats.errors++;
            }

        } catch (error) {
            this.stats.errors++;
            logger.error('Bridge', `处理消息时出错: ${error.message}`);
        }
    }

    /**
     * 检查访问控制
     */
    checkAccessControl(userId, groupId, messageType) {
        const accessControl = configManager.get('accessControl') || {};

        // 用户黑名单
        if (accessControl.blacklist?.includes(userId)) {
            return false;
        }

        // 用户白名单（如果设置了白名单，则只允许白名单内的用户）
        if (accessControl.whitelist?.length > 0 && !accessControl.whitelist.includes(userId)) {
            return false;
        }

        // 群聊检查
        if (messageType === 'group' && groupId) {
            // 群黑名单
            if (accessControl.groupBlacklist?.includes(groupId)) {
                return false;
            }

            // 群白名单
            if (accessControl.groupWhitelist?.length > 0 && !accessControl.groupWhitelist.includes(groupId)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 检查触发条件
     */
    checkTrigger(plainText, rawMessage, messageType) {
        const replyConfig = configManager.get('reply') || {};
        const triggerPrefixes = replyConfig.triggerPrefixes || [];
        const requireAtInGroup = replyConfig.requireAtInGroup !== false;

        let cleanMessage = plainText;
        let triggered = false;

        // 检查命令前缀
        for (const prefix of triggerPrefixes) {
            if (plainText.startsWith(prefix)) {
                cleanMessage = plainText.slice(prefix.length).trim();
                triggered = true;
                break;
            }
        }

        // 群聊中检查是否 @ 了机器人
        if (messageType === 'group') {
            const isAtBot = napCatClient.isAtBot(rawMessage);

            if (isAtBot) {
                // 移除 @ 相关的文本
                cleanMessage = cleanMessage.replace(/@[^\s]+/g, '').trim();
                triggered = true;
            } else if (requireAtInGroup && !triggered) {
                // 群聊需要 @ 或前缀才触发
                triggered = false;
            }
        } else {
            // 私聊总是触发（如果没有前缀要求）
            if (!triggered && triggerPrefixes.length === 0) {
                triggered = true;
            }
        }

        return { triggered, cleanMessage: cleanMessage || plainText };
    }

    /**
     * 计算回复延迟
     */
    calculateReplyDelay(reply) {
        const replyConfig = configManager.get('reply') || {};
        const baseDelay = replyConfig.replyDelay ?? 500;
        const maxDelay = replyConfig.maxReplyDelay ?? 3000;
        const delayPerChar = replyConfig.delayPerChar ?? 50;

        const calculatedDelay = baseDelay + (reply.length * delayPerChar);
        return Math.min(calculatedDelay, maxDelay);
    }

    /**
     * 延迟函数
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 获取服务状态
     */
    getStatus() {
        return {
            running: this.running,
            stats: this.stats,
            sillytavern: sillyTavernClient.getStatus(),
            napcat: napCatClient.getStatus()
        };
    }

    /**
     * 重置统计数据
     */
    resetStats() {
        this.stats = {
            messagesReceived: 0,
            messagesProcessed: 0,
            repliesSent: 0,
            errors: 0
        };
    }
}

// 单例导出
const bridgeService = new BridgeService();
module.exports = bridgeService;
