/**
 * SillyTavern 客户端
 * 使用 Puppeteer 模拟酒馆网页操作
 */

const puppeteer = require('puppeteer');
const logger = require('../utils/logger');
const configManager = require('../utils/configManager');

class SillyTavernClient {
    constructor() {
        this.browser = null;
        this.page = null;
        this.connected = false;
        this.lastError = null;
        this.isProcessing = false;
        this.messageQueue = [];
        this.initialized = false;
    }

    /**
     * 初始化浏览器和页面
     */
    async initialize() {
        if (this.initialized && this.browser && this.page) {
            return;
        }

        try {
            const config = configManager.get('sillytavern');

            logger.info('SillyTavern', '正在启动无头浏览器...');

            this.browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });

            this.page = await this.browser.newPage();
            await this.page.setViewport({ width: 1280, height: 800 });

            // 设置超时
            this.page.setDefaultTimeout(60000);

            const url = config.apiUrl || 'http://127.0.0.1:8000';
            logger.info('SillyTavern', `正在加载酒馆页面: ${url}`);

            await this.page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 60000
            });

            // 等待聊天界面加载
            logger.info('SillyTavern', '等待聊天界面加载...');
            await this.page.waitForSelector('#send_textarea', { timeout: 30000 });

            this.connected = true;
            this.initialized = true;
            logger.info('SillyTavern', '✅ 酒馆页面加载完成，浏览器准备就绪');

        } catch (error) {
            this.connected = false;
            this.lastError = error.message;
            logger.error('SillyTavern', `初始化失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 测试连接
     */
    async testConnection() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }
            return { success: true, data: { status: 'ok' } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送消息（队列方式）
     */
    async sendMessage(userId, message, userName = 'User') {
        return new Promise((resolve) => {
            this.messageQueue.push({ userId, message, userName, resolve });
            this.processQueue();
        });
    }

    /**
     * 处理消息队列
     */
    async processQueue() {
        if (this.isProcessing || this.messageQueue.length === 0) return;

        this.isProcessing = true;
        const { userId, message, userName, resolve } = this.messageQueue.shift();

        try {
            const result = await this.doSendMessage(userId, message, userName);
            resolve(result);
        } catch (error) {
            resolve({ success: false, error: error.message });
        } finally {
            this.isProcessing = false;
            if (this.messageQueue.length > 0) {
                setTimeout(() => this.processQueue(), 500);
            }
        }
    }

    /**
     * 实际发送消息
     */
    async doSendMessage(userId, message, userName) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info('SillyTavern', `发送消息: ${message.substring(0, 50)}...`);

            // 记录发送前的消息数量
            const beforeCount = await this.page.evaluate(() => {
                const msgs = document.querySelectorAll('.mes');
                return msgs.length;
            });

            // 清空并输入消息
            await this.page.evaluate(() => {
                const textarea = document.querySelector('#send_textarea');
                if (textarea) {
                    textarea.value = '';
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });

            await this.page.type('#send_textarea', message, { delay: 5 });

            // 按回车发送（比点击按钮更可靠）
            await this.page.keyboard.press('Enter');

            logger.info('SillyTavern', '消息已发送，等待 AI 回复...');

            // 等待回复
            const reply = await this.waitForReply(beforeCount);

            if (reply) {
                logger.info('SillyTavern', `收到回复: ${reply.substring(0, 50)}...`);
                return { success: true, reply };
            }

            return { success: false, error: '未收到回复' };

        } catch (error) {
            logger.error('SillyTavern', `发送失败: ${error.message}`);

            // 尝试恢复
            this.initialized = false;

            return { success: false, error: error.message };
        }
    }

    /**
     * 等待 AI 回复
     */
    async waitForReply(beforeCount, timeout = 120000) {
        const startTime = Date.now();
        let lastLength = 0;
        let stableCount = 0;

        logger.debug('SillyTavern', `等待回复, 之前消息数: ${beforeCount}`);

        while (Date.now() - startTime < timeout) {
            await new Promise(r => setTimeout(r, 1000));

            try {
                const result = await this.page.evaluate((prevCount) => {
                    const messages = document.querySelectorAll('.mes');

                    // 检查是否有新消息
                    if (messages.length <= prevCount) {
                        return { status: 'waiting', count: messages.length, prevCount };
                    }

                    // 获取最后一条消息
                    const lastMsg = messages[messages.length - 1];
                    const isUserAttr = lastMsg.getAttribute('is_user');
                    // is_user 可能是 'true', 'false', 或空字符串
                    const isUser = isUserAttr === 'true';

                    if (isUser) {
                        return { status: 'waiting_for_ai', count: messages.length };
                    }

                    // 检查是否在生成中
                    const sendBtn = document.querySelector('#send_but');
                    const stopBtn = document.querySelector('#mes_stop');
                    const isGenerating = sendBtn?.classList.contains('spin') ||
                        stopBtn?.offsetParent !== null ||  // 停止按钮可见
                        document.querySelector('.mes.typing') !== null;

                    // 获取消息内容
                    const mesText = lastMsg.querySelector('.mes_text');
                    const content = mesText?.innerText?.trim() || '';

                    return {
                        status: isGenerating ? 'generating' : 'done',
                        content: content,
                        length: content.length,
                        count: messages.length,
                        isUserAttr: isUserAttr
                    };
                }, beforeCount);

                if (result.status === 'done' && result.content) {
                    // 检查内容是否稳定（不再变化）
                    if (result.length === lastLength) {
                        stableCount++;
                        if (stableCount >= 2) {
                            logger.info('SillyTavern', `回复稳定, 返回内容 (${result.length} 字符)`);
                            return result.content;
                        }
                    } else {
                        stableCount = 0;
                        lastLength = result.length;
                    }
                } else if (result.status === 'generating') {
                    lastLength = result.length || 0;
                    stableCount = 0;
                    logger.debug('SillyTavern', `生成中... 当前长度: ${lastLength}`);
                } else if (result.status === 'waiting') {
                    logger.debug('SillyTavern', `等待中, 消息数: ${result.count}/${result.prevCount}`);
                }

            } catch (error) {
                logger.debug('SillyTavern', `等待时出错: ${error.message}`);
            }
        }

        // 超时后尝试获取最后一条消息作为调试
        try {
            const debugInfo = await this.page.evaluate(() => {
                const messages = document.querySelectorAll('.mes');
                if (messages.length === 0) return { count: 0 };
                const lastMsg = messages[messages.length - 1];
                return {
                    count: messages.length,
                    lastIsUser: lastMsg.getAttribute('is_user'),
                    lastContent: lastMsg.querySelector('.mes_text')?.innerText?.substring(0, 100) || 'empty'
                };
            });
            logger.warn('SillyTavern', `等待超时, 调试信息: ${JSON.stringify(debugInfo)}`);
        } catch (e) { }

        return null;
    }

    /**
     * 关闭浏览器
     */
    async close() {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) { }
            this.browser = null;
            this.page = null;
            this.connected = false;
            this.initialized = false;
        }
    }

    getStatus() {
        return {
            connected: this.connected,
            lastError: this.lastError,
            apiUrl: configManager.get('sillytavern.apiUrl'),
            queueLength: this.messageQueue.length,
            initialized: this.initialized
        };
    }

    async clearHistory(userId) {
        if (userId) {
            return { success: false, error: '当前为共享会话，无法按用户重置历史' };
        }
        return this.startNewChat();
    }

    clearAllHistory() {
        return this.clearHistory();
    }

    /**
     * 获取所有角色卡列表
     * 直接从 SillyTavern 的内部变量获取数据
     */
    async getCharacters() {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', '获取角色列表...');

            // 直接从 SillyTavern 的全局变量获取角色数据
            const characters = await this.page.evaluate(() => {
                // SillyTavern 将角色存储在全局变量 characters 中
                if (typeof characters !== 'undefined' && Array.isArray(characters)) {
                    return characters.map(char => ({
                        id: char.avatar || '',
                        name: char.name || '',
                        avatar: char.avatar || ''
                    }));
                }

                // 备选方案：从 DOM 获取
                const charElements = document.querySelectorAll('.character_select, [data-chid]');
                const chars = [];
                charElements.forEach(el => {
                    const name = el.querySelector('.ch_name')?.textContent?.trim() ||
                        el.getAttribute('title') ||
                        el.textContent?.trim();
                    if (name && !chars.find(c => c.name === name)) {
                        chars.push({
                            id: el.getAttribute('chid') || el.getAttribute('data-chid') || '',
                            name: name,
                            avatar: el.querySelector('img')?.src || ''
                        });
                    }
                });
                return chars;
            });

            logger.info('SillyTavern', `发现 ${characters.length} 个角色`);
            return characters;

        } catch (error) {
            logger.error('SillyTavern', `获取角色列表失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 选择角色
     * 通过在页面中执行 JavaScript 来选择角色
     */
    async selectCharacter(characterName) {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', `选择角色: ${characterName}`);

            // 在页面中执行选择角色的操作
            const result = await this.page.evaluate(async (name) => {
                // 查找并点击角色
                const chars = document.querySelectorAll('.character_select, [data-chid]');
                for (const char of chars) {
                    const charName = char.querySelector('.ch_name')?.textContent?.trim() ||
                        char.getAttribute('title') ||
                        char.textContent?.trim();
                    if (charName && charName.toLowerCase().includes(name.toLowerCase())) {
                        char.click();
                        return { found: true, name: charName };
                    }
                }
                return { found: false };
            }, characterName);

            if (result.found) {
                await new Promise(r => setTimeout(r, 2000));
                logger.info('SillyTavern', `已选择角色: ${result.name}`);
                return { success: true };
            }

            return { success: false, error: '未找到角色' };

        } catch (error) {
            logger.error('SillyTavern', `选择角色失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取当前角色的聊天列表
     */
    async getChats() {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', '获取聊天列表...');

            // 通过在页面内执行 JavaScript 打开聊天列表并获取数据
            const chats = await this.page.evaluate(async () => {
                // 辅助函数：等待元素可见
                const waitForVisible = async (selector, timeout = 3000) => {
                    const start = Date.now();
                    while (Date.now() - start < timeout) {
                        const el = document.querySelector(selector);
                        if (el && el.offsetParent !== null) return el;
                        await new Promise(r => setTimeout(r, 100));
                    }
                    return null;
                };

                // 1. 先点击汉堡菜单打开选项
                const menuBtn = document.getElementById('options_button');
                if (menuBtn) {
                    menuBtn.click();
                    await new Promise(r => setTimeout(r, 800));
                }

                // 2. 点击"管理聊天文件"按钮
                const selectChatBtn = document.getElementById('option_select_chat');
                if (selectChatBtn) {
                    selectChatBtn.click();
                    await new Promise(r => setTimeout(r, 1000));
                }

                // 3. 等待弹窗出现
                let popup = await waitForVisible('#select_chat_popup, #shadow_select_chat_popup');
                if (!popup) {
                    // 如果还是没有弹窗，尝试用 jQuery
                    if (typeof $ !== 'undefined') {
                        $('#option_select_chat').trigger('click');
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                // 4. 获取聊天数据
                // 历史聊天即使在 select_chat_popup 中，也可能有不同的结构，需要同时检查 ID
                const chatElements = document.querySelectorAll('.select_chat_block');
                const chatList = [];

                chatElements.forEach((el, index) => {
                    // 确保是聊天块
                    if (!el.classList.contains('select_chat_block')) return;

                    const fileName = el.getAttribute('file_name') ||
                        el.getAttribute('id')?.replace('chat_block_', '') || '';

                    const preview = el.querySelector('.select_chat_block_mes')?.textContent?.trim() || '';
                    const date = el.querySelector('.select_chat_block_date')?.textContent?.trim() ||
                        el.querySelector('small')?.textContent?.trim() || '';

                    if (fileName) {
                        chatList.push({
                            id: fileName,
                            index: index,
                            preview: preview.substring(0, 50) + (preview.length > 50 ? '...' : ''),
                            date: date
                        });
                    }
                });

                // 5. 关闭弹窗
                // 尝试点击关闭按钮
                const closeBtn = document.querySelector('#select_chat_popup .cross_button') ||
                    document.querySelector('#select_chat_cross');
                if (closeBtn) {
                    closeBtn.click();
                } else {
                    // 按 ESC
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
                }

                return chatList;
            });

            logger.info('SillyTavern', `发现 ${chats.length} 个聊天`);
            return chats;

        } catch (error) {
            logger.error('SillyTavern', `获取聊天列表失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 选择指定的聊天
     */
    async selectChat(chatId) {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', `选择聊天: ${chatId}`);

            const result = await this.page.evaluate(async (targetId) => {
                // 1. 先点击汉堡菜单打开选项
                const menuBtn = document.getElementById('options_button');
                if (menuBtn) {
                    menuBtn.click();
                    await new Promise(r => setTimeout(r, 800));
                }

                // 2. 点击"管理聊天文件"按钮
                const selectChatBtn = document.getElementById('option_select_chat');
                if (selectChatBtn) {
                    selectChatBtn.click();
                    await new Promise(r => setTimeout(r, 1000));
                }

                // 3. 查找并点击目标聊天
                const chatElements = document.querySelectorAll('.select_chat_block');
                for (const el of chatElements) {
                    const fileName = el.getAttribute('file_name');
                    // 精确匹配 file_name
                    if (fileName === targetId) {
                        el.click();
                        return { success: true };
                    }
                }

                // 如果不能精确匹配，尝试模糊匹配
                for (const el of chatElements) {
                    const fileName = el.getAttribute('file_name') || '';
                    if (fileName.includes(targetId) || el.textContent.includes(targetId)) {
                        el.click();
                        return { success: true };
                    }
                }

                // 关闭弹窗
                const closeBtn = document.querySelector('#select_chat_cross, .popup_close');
                if (closeBtn) closeBtn.click();
                return { success: false };
            }, chatId);

            if (result.success) {
                await new Promise(r => setTimeout(r, 2000)); // 等待聊天加载
                logger.info('SillyTavern', `已选择聊天: ${chatId}`);
                return { success: true };
            }

            return { success: false, error: '未找到指定聊天' };

        } catch (error) {
            logger.error('SillyTavern', `选择聊天失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 开始新聊天
     */
    async startNewChat() {
        if (this.isProcessing || this.messageQueue.length) {
            return { success: false, error: '正在处理消息，请稍后再开始新聊天' };
        }
        this.isProcessing = true;
        try {
            if (!this.initialized) await this.initialize();
            const previousChat = await this.page.evaluate(() =>
                window.SillyTavern?.getContext?.().chatId || document.getElementById('selected_chat_pole')?.value);
            if (!previousChat) return { success: false, error: '请先选择角色或群聊' };

            const opened = await this.page.evaluate(() => {
                const button = document.getElementById('option_start_new_chat');
                if (!button || button.offsetParent === null) document.getElementById('options_button')?.click();
                return !!button;
            });
            if (!opened) return { success: false, error: '未找到新聊天按钮' };
            const button = await this.page.waitForSelector('#option_start_new_chat', { visible: true, timeout: 3000 });
            await this.page.evaluate(previous => {
                const context = window.SillyTavern?.getContext?.();
                const event = context?.eventTypes?.CHAT_CHANGED || context?.event_types?.CHAT_CHANGED;
                if (!event || !context.eventSource?.on || !context.eventSource?.removeListener) {
                    throw new Error('当前酒馆版本未提供聊天加载事件，无法确认重置完成');
                }
                const state = { loaded: false };
                const listener = chatId => {
                    if (chatId && chatId !== previous && window.SillyTavern.getContext().chatId === chatId) state.loaded = true;
                };
                state.cleanup = () => context.eventSource.removeListener(event, listener);
                window.__qqBridgeChatReset = state;
                context.eventSource.on(event, listener);
            }, previousChat);
            await button.click();

            // 新版 dialog 和旧版确认弹窗；不勾选删除已有聊天。
            try {
                const confirm = await this.page.waitForSelector('dialog[open] .popup-button-ok, #dialogue_popup_ok, .popup_ok', { visible: true, timeout: 3000 });
                await this.page.evaluate(() => {
                    const deleteChat = document.getElementById('del_chat_checkbox');
                    if (deleteChat) deleteChat.checked = false;
                });
                await confirm.click();
            } catch (error) {
                if (error.name !== 'TimeoutError') throw error;
            }
            await this.page.waitForFunction(previous => {
                const current = window.SillyTavern?.getContext?.().chatId || document.getElementById('selected_chat_pole')?.value;
                return current && current !== previous && window.__qqBridgeChatReset?.loaded;
            }, { timeout: 15000 }, previousChat);
            logger.info('SillyTavern', '已开始新聊天');
            return { success: true };
        } catch (error) {
            logger.error('SillyTavern', `开始新聊天失败: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            if (this.page) {
                await this.page.evaluate(() => {
                    window.__qqBridgeChatReset?.cleanup();
                    delete window.__qqBridgeChatReset;
                }).catch(() => {});
            }
            this.isProcessing = false;
            this.processQueue();
        }
    }

    /**
     * 获取当前角色和聊天信息
     */
    async getCurrentInfo() {
        try {
            if (!this.initialized) await this.initialize();

            const info = await this.page.evaluate(() => {
                const charName = document.querySelector('#rm_button_selected_ch .ch_name')?.textContent?.trim() ||
                    document.querySelector('.selected_char_name')?.textContent?.trim() ||
                    '';
                const avatar = document.querySelector('#rm_button_selected_ch img')?.src || '';

                // 获取最后一条消息
                const messages = document.querySelectorAll('.mes');
                const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
                const lastMsgText = lastMsg?.querySelector('.mes_text')?.textContent?.trim()?.substring(0, 100) || '';

                return {
                    characterName: charName,
                    avatar: avatar,
                    messageCount: messages.length,
                    lastMessage: lastMsgText
                };
            });

            return info;

        } catch (error) {
            logger.error('SillyTavern', `获取当前信息失败: ${error.message}`);
            return { characterName: '', messageCount: 0 };
        }
    }

    /**
     * 获取当前 API 设置
     */
    async getApiSettings() {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', '获取 API 设置...');

            const settings = await this.page.evaluate(() => {
                const getSelectInfo = (id) => {
                    const el = document.getElementById(id);
                    if (!el) return null;
                    return {
                        value: el.value,
                        text: el.options[el.selectedIndex]?.text || '',
                        options: Array.from(el.options).map(o => ({
                            value: o.value,
                            text: o.text
                        }))
                    };
                };

                const getInputValue = (id) => {
                    const el = document.getElementById(id);
                    return el ? el.value : null;
                };

                return {
                    mainApi: getSelectInfo('main_api'),
                    chatCompletionSource: getSelectInfo('chat_completion_source'),
                    connectionProfile: getSelectInfo('connection_profiles'),
                    apiUrl: getInputValue('custom_api_url_text'),
                    modelId: getInputValue('custom_model_id'),
                    hasApiKey: !!document.getElementById('api_key_custom')?.value
                };
            });

            logger.info('SillyTavern', `当前 API: ${settings.mainApi?.text || 'unknown'}`);
            return settings;

        } catch (error) {
            logger.error('SillyTavern', `获取 API 设置失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 更改 API 设置
     * @param {Object} settings - 要更改的设置
     * @param {string} settings.mainApi - 主 API (如 'openai', 'textgenerationwebui')
     * @param {string} settings.chatCompletionSource - 聊天补全源
     * @param {string} settings.apiUrl - API URL
     * @param {string} settings.apiKey - API Key
     * @param {string} settings.modelId - 模型 ID
     */
    async setApiSettings(settings) {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', '更改 API 设置...');

            const result = await this.page.evaluate(async (newSettings) => {
                const setSelectValue = (id, value) => {
                    const el = document.getElementById(id);
                    if (el && value !== undefined) {
                        el.value = value;
                        // 触发 change 事件
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        if (typeof $ !== 'undefined') {
                            $(el).trigger('change');
                        }
                        return true;
                    }
                    return false;
                };

                const setInputValue = (id, value) => {
                    const el = document.getElementById(id);
                    if (el && value !== undefined) {
                        el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                };

                const changes = [];

                if (newSettings.mainApi) {
                    if (setSelectValue('main_api', newSettings.mainApi)) {
                        changes.push('mainApi');
                        await new Promise(r => setTimeout(r, 500));
                    }
                }

                if (newSettings.chatCompletionSource) {
                    if (setSelectValue('chat_completion_source', newSettings.chatCompletionSource)) {
                        changes.push('chatCompletionSource');
                        await new Promise(r => setTimeout(r, 500));
                    }
                }

                if (newSettings.apiUrl) {
                    if (setInputValue('custom_api_url_text', newSettings.apiUrl)) {
                        changes.push('apiUrl');
                    }
                }

                if (newSettings.apiKey) {
                    if (setInputValue('api_key_custom', newSettings.apiKey)) {
                        changes.push('apiKey');
                    }
                }

                if (newSettings.modelId) {
                    if (setInputValue('custom_model_id', newSettings.modelId)) {
                        changes.push('modelId');
                    }
                }

                return { success: true, changes };
            }, settings);

            await new Promise(r => setTimeout(r, 1000));
            logger.info('SillyTavern', `API 设置已更新: ${result.changes.join(', ')}`);
            return result;

        } catch (error) {
            logger.error('SillyTavern', `更改 API 设置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取连接配置文件列表
     */
    async getConnectionProfiles() {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', '获取连接配置文件列表...');

            const profiles = await this.page.evaluate(() => {
                const el = document.getElementById('connection_profiles');
                if (!el) return [];
                return Array.from(el.options).map(o => ({
                    value: o.value,
                    name: o.text,
                    selected: o.selected
                }));
            });

            logger.info('SillyTavern', `发现 ${profiles.length} 个配置文件`);
            return profiles;

        } catch (error) {
            logger.error('SillyTavern', `获取配置文件列表失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 选择连接配置文件
     * @param {string} profileValue - 配置文件的 value
     */
    async selectConnectionProfile(profileValue) {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', `选择配置文件: ${profileValue}`);

            const result = await this.page.evaluate(async (value) => {
                const el = document.getElementById('connection_profiles');
                if (!el) return { success: false, error: '未找到配置文件选择器' };

                // 查找匹配的选项
                const option = Array.from(el.options).find(o =>
                    o.value === value || o.text.includes(value)
                );

                if (!option) return { success: false, error: '未找到指定的配置文件' };

                el.value = option.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof $ !== 'undefined') {
                    $(el).trigger('change');
                }

                await new Promise(r => setTimeout(r, 1000));
                return { success: true, profileName: option.text };
            }, profileValue);

            if (result.success) {
                await new Promise(r => setTimeout(r, 1000));
                logger.info('SillyTavern', `已切换到配置文件: ${result.profileName}`);
            }
            return result;

        } catch (error) {
            logger.error('SillyTavern', `选择配置文件失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 测试 API 连接
     * 点击连接按钮并等待响应
     */
    async testApiConnection() {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', '测试 API 连接...');

            const result = await this.page.evaluate(async () => {
                // 获取当前 API 类型
                const mainApi = document.getElementById('main_api')?.value || 'openai';

                // 根据 API 类型找到对应的连接按钮
                const buttonIds = [
                    'api_button_openai',
                    'api_button_textgenerationwebui',
                    'api_button_novel',
                    'api_button_kobold',
                    'horde_api_key_button'
                ];

                let connectBtn = null;
                for (const id of buttonIds) {
                    const btn = document.getElementById(id);
                    if (btn && btn.offsetParent !== null) {
                        connectBtn = btn;
                        break;
                    }
                }

                if (!connectBtn) {
                    // 尝试通用选择器
                    connectBtn = document.querySelector('[id^="api_button_"]');
                }

                if (!connectBtn) {
                    return { success: false, error: '未找到连接按钮' };
                }

                // 点击连接按钮
                connectBtn.click();

                // 等待响应（检查状态指示器变化）
                await new Promise(r => setTimeout(r, 3000));

                // 检查连接状态
                const statusIndicator = document.getElementById('api_loading_textgenerationwebui') ||
                    document.getElementById('api_loading_openai') ||
                    document.querySelector('.api_loading');

                const isConnected = document.querySelector('.api_button:not(.error)') !== null ||
                    document.getElementById('API-status-top')?.classList.contains('success');

                return {
                    success: true,
                    connected: isConnected,
                    message: '连接测试已发送'
                };
            });

            await new Promise(r => setTimeout(r, 2000));
            logger.info('SillyTavern', `API 连接测试完成`);
            return result;

        } catch (error) {
            logger.error('SillyTavern', `测试 API 连接失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送测试消息
     * 使用 SillyTavern 内置的测试消息功能
     */
    async sendTestMessage() {
        try {
            if (!this.initialized) await this.initialize();

            logger.info('SillyTavern', '发送测试消息...');

            const result = await this.page.evaluate(async () => {
                // 查找测试按钮
                const testBtn = document.getElementById('test_api_button');

                if (!testBtn) {
                    return { success: false, error: '未找到测试消息按钮' };
                }

                // 点击测试按钮
                testBtn.click();

                // 等待响应
                await new Promise(r => setTimeout(r, 5000));

                // 检查是否有成功消息
                // SillyTavern 通常会用 toastr 显示结果
                const toastr = document.querySelector('.toast-success, .toastr-success');
                const hasSuccess = !!toastr;

                return {
                    success: true,
                    testPassed: hasSuccess,
                    message: '测试消息已发送'
                };
            });

            await new Promise(r => setTimeout(r, 3000));
            logger.info('SillyTavern', `测试消息发送完成`);
            return result;

        } catch (error) {
            logger.error('SillyTavern', `发送测试消息失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

const sillyTavernClient = new SillyTavernClient();
module.exports = sillyTavernClient;
