/**
 * NapCat OneBot 11 客户端
 * 负责通过 WebSocket 与 NapCat 通信
 */

const WebSocket = require('ws');
const logger = require('../utils/logger');
const configManager = require('../utils/configManager');

class NapCatClient {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.lastError = null;
        this.reconnectTimer = null;
        this.reconnectInterval = 5000; // 5秒重连间隔
        this.messageHandlers = new Set();
        this.pendingRequests = new Map(); // echo -> {resolve, reject, timeout}
        this.selfId = null; // 机器人自己的 QQ 号
    }

    /**
     * 连接到 NapCat
     */
    connect() {
        const config = configManager.get('napcat');
        const wsUrl = config.wsUrl;

        if (!wsUrl) {
            logger.error('NapCat', 'WebSocket 地址未配置');
            return;
        }

        logger.info('NapCat', `正在连接到 ${wsUrl}...`);

        try {
            // 如果有 accessToken，添加到 URL
            let url = wsUrl;
            if (config.accessToken) {
                const separator = url.includes('?') ? '&' : '?';
                url = `${url}${separator}access_token=${config.accessToken}`;
            }

            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                this.connected = true;
                this.lastError = null;
                logger.info('NapCat', 'WebSocket 连接成功');

                // 获取登录信息
                this.getLoginInfo();

                // 清除重连定时器
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });

            this.ws.on('close', (code, reason) => {
                this.connected = false;
                logger.warn('NapCat', `WebSocket 连接断开: ${code} - ${reason}`);
                this.scheduleReconnect();
            });

            this.ws.on('error', (error) => {
                this.connected = false;
                this.lastError = error.message;
                logger.error('NapCat', `WebSocket 错误: ${error.message}`);
            });

        } catch (error) {
            this.connected = false;
            this.lastError = error.message;
            logger.error('NapCat', `连接失败: ${error.message}`);
            this.scheduleReconnect();
        }
    }

    /**
     * 安排重连
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            return;
        }

        logger.info('NapCat', `${this.reconnectInterval / 1000}秒后尝试重连...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectInterval);
    }

    /**
     * 断开连接
     */
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.connected = false;
        logger.info('NapCat', '已断开连接');
    }

    /**
     * 处理收到的消息
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());

            // 检查是否是 API 响应
            if (message.echo && this.pendingRequests.has(message.echo)) {
                const { resolve, reject, timeout } = this.pendingRequests.get(message.echo);
                clearTimeout(timeout);
                this.pendingRequests.delete(message.echo);

                if (message.status === 'ok' || message.retcode === 0) {
                    resolve(message.data);
                } else {
                    reject(new Error(message.message || message.wording || 'API 调用失败'));
                }
                return;
            }

            // 处理事件
            if (message.post_type) {
                this.handleEvent(message);
            }

        } catch (error) {
            logger.error('NapCat', `解析消息失败: ${error.message}`);
        }
    }

    /**
     * 处理事件
     */
    handleEvent(event) {
        logger.debug('NapCat', `收到事件: ${event.post_type}`, event);

        // 元事件（心跳等）
        if (event.post_type === 'meta_event') {
            if (event.meta_event_type === 'lifecycle' && event.sub_type === 'connect') {
                logger.info('NapCat', 'OneBot 生命周期: 连接建立');
            }
            return;
        }

        // 消息事件
        if (event.post_type === 'message') {
            this.messageHandlers.forEach(handler => {
                try {
                    handler(event);
                } catch (err) {
                    logger.error('NapCat', `消息处理器错误: ${err.message}`);
                }
            });
        }
    }

    /**
     * 调用 OneBot API
     */
    async callApi(action, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ws || !this.connected) {
                reject(new Error('WebSocket 未连接'));
                return;
            }

            const echo = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const request = {
                action,
                params,
                echo
            };

            // 设置超时
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(echo);
                reject(new Error('API 调用超时'));
            }, 30000);

            this.pendingRequests.set(echo, { resolve, reject, timeout });

            try {
                this.ws.send(JSON.stringify(request));
            } catch (error) {
                clearTimeout(timeout);
                this.pendingRequests.delete(echo);
                reject(error);
            }
        });
    }

    /**
     * 获取登录信息
     */
    async getLoginInfo() {
        try {
            const info = await this.callApi('get_login_info');
            this.selfId = info.user_id?.toString();
            logger.info('NapCat', `登录信息: ${info.nickname} (${this.selfId})`);
            return info;
        } catch (error) {
            logger.error('NapCat', `获取登录信息失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 发送私聊消息
     */
    async sendPrivateMessage(userId, message) {
        try {
            logger.info('NapCat', `发送私聊消息到 ${userId}: ${message.substring(0, 50)}...`);
            const result = await this.callApi('send_private_msg', {
                user_id: parseInt(userId),
                message: message
            });
            return { success: true, messageId: result.message_id };
        } catch (error) {
            logger.error('NapCat', `发送私聊消息失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送群消息
     */
    async sendGroupMessage(groupId, message, atUser = null) {
        try {
            let fullMessage = message;
            if (atUser) {
                fullMessage = `[CQ:at,qq=${atUser}] ${message}`;
            }

            logger.info('NapCat', `发送群消息到 ${groupId}: ${message.substring(0, 50)}...`);
            const result = await this.callApi('send_group_msg', {
                group_id: parseInt(groupId),
                message: fullMessage
            });
            return { success: true, messageId: result.message_id };
        } catch (error) {
            logger.error('NapCat', `发送群消息失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 添加消息处理器
     */
    addMessageHandler(handler) {
        this.messageHandlers.add(handler);
    }

    /**
     * 移除消息处理器
     */
    removeMessageHandler(handler) {
        this.messageHandlers.delete(handler);
    }

    /**
     * 获取连接状态
     */
    getStatus() {
        return {
            connected: this.connected,
            lastError: this.lastError,
            wsUrl: configManager.get('napcat.wsUrl'),
            selfId: this.selfId
        };
    }

    /**
     * 解析消息中的纯文本
     */
    extractPlainText(message) {
        if (typeof message === 'string') {
            // CQ 码格式
            return message.replace(/\[CQ:[^\]]+\]/g, '').trim();
        } else if (Array.isArray(message)) {
            // 消息段格式
            return message
                .filter(seg => seg.type === 'text')
                .map(seg => seg.data?.text || '')
                .join('')
                .trim();
        }
        return '';
    }

    /**
     * 检查消息是否 @ 了机器人
     */
    isAtBot(message) {
        const botQQ = configManager.get('reply.botQQ') || this.selfId;
        if (!botQQ) return false;

        if (typeof message === 'string') {
            return message.includes(`[CQ:at,qq=${botQQ}]`);
        } else if (Array.isArray(message)) {
            return message.some(seg =>
                seg.type === 'at' && seg.data?.qq?.toString() === botQQ.toString()
            );
        }
        return false;
    }
}

// 单例导出
const napCatClient = new NapCatClient();
module.exports = napCatClient;
