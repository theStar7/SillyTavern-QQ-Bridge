/**
 * SillyTavern-QQ-Bridge WebUI 前端逻辑
 */

class SillyTavernBridgeApp {
    constructor() {
        this.ws = null;
        this.logs = [];
        this.currentLogFilter = 'all';
        this.autoScroll = true;
        this.init();
    }

    init() {
        // Initialize Lucide icons
        if (window.lucide) {
            lucide.createIcons();
        }
        this.initTheme();
        this.bindNavigation();
        this.bindMobileMenu();
        this.bindButtons();
        this.bindForm();
        this.connectWebSocket();
        this.loadConfig();
    }

    // Theme management
    initTheme() {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
        }
    }

    toggleTheme() {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
        }
    }

    // 导航切换
    bindNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                this.switchPage(page);
                this.closeMobileMenu();
            });
        });

        document.querySelectorAll('.link-more').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.goto;
                if (page) this.switchPage(page);
            });
        });
    }

    switchPage(pageId) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

        document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
        document.getElementById(`page-${pageId}`)?.classList.add('active');
    }

    // Mobile menu
    bindMobileMenu() {
        const toggleBtn = document.getElementById('btn-menu-toggle');
        const overlay = document.getElementById('sidebar-overlay');

        toggleBtn?.addEventListener('click', () => {
            document.getElementById('sidebar')?.classList.toggle('open');
            overlay?.classList.toggle('active');
        });

        overlay?.addEventListener('click', () => this.closeMobileMenu());
    }

    closeMobileMenu() {
        document.getElementById('sidebar')?.classList.remove('open');
        document.getElementById('sidebar-overlay')?.classList.remove('active');
    }

    // 绑定按钮事件
    bindButtons() {
        document.getElementById('btn-theme-toggle')?.addEventListener('click', () => this.toggleTheme());
        document.getElementById('btn-start-service')?.addEventListener('click', () => this.startService());
        document.getElementById('btn-stop-service')?.addEventListener('click', () => this.stopService());
        document.getElementById('btn-test-st')?.addEventListener('click', () => this.testSillyTavern());
        document.getElementById('btn-test-nc')?.addEventListener('click', () => this.testNapCat());
        document.getElementById('btn-clear-history')?.addEventListener('click', () => this.clearHistory());
        document.getElementById('btn-clear-logs')?.addEventListener('click', () => this.clearLogs());
        document.getElementById('btn-reset-stats')?.addEventListener('click', () => this.resetStats());
        document.getElementById('btn-reload-config')?.addEventListener('click', () => this.loadConfig());
        document.getElementById('btn-clear-log-display')?.addEventListener('click', () => this.clearLogDisplay());

        // 角色和聊天管理
        document.getElementById('btn-refresh-chars')?.addEventListener('click', () => this.refreshCharacters());
        document.getElementById('btn-select-char')?.addEventListener('click', () => this.selectCharacter());
        document.getElementById('btn-select-chat')?.addEventListener('click', () => this.selectChat());
        document.getElementById('btn-new-chat')?.addEventListener('click', () => this.startNewChat());

        // API 设置管理
        document.getElementById('btn-refresh-api')?.addEventListener('click', () => this.refreshApiSettings());
        document.getElementById('btn-select-profile')?.addEventListener('click', () => this.selectConnectionProfile());
        document.getElementById('btn-apply-api')?.addEventListener('click', () => this.applyApiSettings());
        document.getElementById('btn-test-connection')?.addEventListener('click', () => this.testApiConnection());
        document.getElementById('btn-test-message')?.addEventListener('click', () => this.sendTestMessage());

        // 日志过滤器
        document.querySelectorAll('.btn-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentLogFilter = btn.dataset.level;
                this.renderLogs();
            });
        });

        // 自动滚动
        document.getElementById('log-auto-scroll')?.addEventListener('change', (e) => {
            this.autoScroll = e.target.checked;
        });
    }

    // 绑定表单
    bindForm() {
        document.getElementById('config-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveConfig();
        });
    }

    // WebSocket 连接
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('apiToken') || '';
        const wsUrl = `${protocol}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket 连接成功');
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWsMessage(data);
            } catch (e) {
                console.error('解析消息失败:', e);
            }
        };

        this.ws.onclose = (event) => {
            this.markDisconnected();
            if (event.code === 1008) {
                this.promptApiToken();
                return;
            }
            console.log('WebSocket 断开，5秒后重连...');
            setTimeout(() => this.connectWebSocket(), 5000);
        };

        this.ws.onerror = (error) => {
            this.markDisconnected();
            console.error('WebSocket 错误:', error);
        };
    }

    markDisconnected() {
        const bridgeEl = document.getElementById('bridge-status');
        bridgeEl.classList.remove('running');
        bridgeEl.classList.add('offline');
        this.setStatusIcon(bridgeEl, 'alert-circle');
        bridgeEl.querySelector('.status-text').textContent = '连接中断';
        for (const prefix of ['st', 'nc']) {
            this.updateServiceStatus(prefix, false);
            document.querySelector(`#${prefix}-status .status-text`).textContent = '未知';
        }
    }

    handleWsMessage(data) {
        switch (data.type) {
            case 'status':
                this.updateStatus(data.data);
                break;
            case 'log':
                this.addLog(data.data);
                break;
            case 'logs':
                this.logs = data.data || [];
                this.renderLogs();
                break;
        }
    }

    // 更新状态显示
    updateStatus(status) {
        // 桥接服务状态
        const bridgeEl = document.getElementById('bridge-status');
        if (bridgeEl) {
            if (status.running) {
                bridgeEl.classList.add('running');
                bridgeEl.classList.remove('offline');
                this.setStatusIcon(bridgeEl, 'play-circle');
                bridgeEl.querySelector('.status-text').textContent = '运行中';
            } else {
                bridgeEl.classList.remove('running');
                bridgeEl.classList.add('offline');
                this.setStatusIcon(bridgeEl, 'pause-circle');
                bridgeEl.querySelector('.status-text').textContent = '已停止';
            }
        }

        // SillyTavern 状态
        this.updateServiceStatus('st', status.sillytavern?.connected);

        // NapCat 状态
        this.updateServiceStatus('nc', status.napcat?.connected);

        // 统计数据
        if (status.stats) {
            document.getElementById('stat-received').textContent = status.stats.messagesReceived || 0;
            document.getElementById('stat-processed').textContent = status.stats.messagesProcessed || 0;
            document.getElementById('stat-replies').textContent = status.stats.repliesSent || 0;
            document.getElementById('stat-errors').textContent = status.stats.errors || 0;
        }
    }

    setStatusIcon(el, iconName) {
        const iconEl = el.querySelector('.status-icon');
        if (iconEl) {
            iconEl.setAttribute('data-lucide', iconName);
            if (window.lucide) lucide.createIcons({ nodes: [iconEl] });
        }
    }

    updateServiceStatus(prefix, connected) {
        const statusEl = document.getElementById(`${prefix}-status`);
        const dotEl = document.getElementById(`${prefix}-status-dot`);

        if (statusEl) {
            if (connected) {
                statusEl.classList.add('online');
                statusEl.classList.remove('offline');
                this.setStatusIcon(statusEl, 'check-circle');
                statusEl.querySelector('.status-text').textContent = '在线';
            } else {
                statusEl.classList.remove('online');
                statusEl.classList.add('offline');
                this.setStatusIcon(statusEl, 'x-circle');
                statusEl.querySelector('.status-text').textContent = '离线';
            }
        }

        if (dotEl) {
            dotEl.classList.toggle('online', connected);
            dotEl.classList.toggle('offline', !connected);
        }
    }

    // 日志处理
    addLog(log) {
        this.logs.push(log);
        if (this.logs.length > 500) this.logs.shift();
        this.renderLogs();
    }

    renderLogs() {
        const container = document.getElementById('logs-container');
        const preview = document.getElementById('logs-preview');

        const filteredLogs = this.currentLogFilter === 'all'
            ? this.logs
            : this.logs.filter(l => l.level === this.currentLogFilter);

        const html = filteredLogs.length === 0
            ? '<div class="log-empty">暂无日志</div>'
            : filteredLogs.map(log => this.renderLogEntry(log)).join('');

        if (container) {
            container.innerHTML = html;
            if (this.autoScroll) {
                container.scrollTop = container.scrollHeight;
            }
        }

        if (preview) {
            const recentLogs = this.logs.slice(-5);
            preview.innerHTML = recentLogs.length === 0
                ? '<div class="log-empty">暂无日志</div>'
                : recentLogs.map(log => this.renderLogEntry(log)).join('');
        }
    }

    renderLogEntry(log) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        return `
            <div class="log-entry log-${log.level}">
                <span class="log-time">${time}</span>
                <span class="log-level ${log.level}">${log.level}</span>
                <span class="log-category">[${log.category}]</span>
                <span class="log-message">${this.escapeHtml(log.message)}</span>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clearLogDisplay() {
        this.logs = [];
        this.renderLogs();
        this.showToast('success', '已清空', '日志显示已清空');
    }

    // API 调用
    async apiCall(method, endpoint, data = null) {
        try {
            const token = localStorage.getItem('apiToken') || '';
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                }
            };
            if (data) options.body = JSON.stringify(data);

            const response = await fetch(`/api${endpoint}`, options);

            if (response.status === 401) {
                this.promptApiToken();
                return { success: false, error: '需要 API Token 认证' };
            }

            const result = await response.json();
            if (!result.success) {
                result.error = result.error || result.data?.error || '请求失败';
            }
            return result;
        } catch (error) {
            console.error('API 调用失败:', error);
            return { success: false, error: error.message };
        }
    }

    promptApiToken() {
        if (document.getElementById('token-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'token-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `
            <div style="background:var(--bg-primary);padding:24px;border-radius:12px;max-width:400px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 12px;">API Token 认证</h3>
                <p style="margin:0 0 16px;color:var(--text-secondary);font-size:14px;">服务器已启用 API Token 认证，请输入 Token：</p>
                <input type="password" id="token-input" placeholder="输入 API Token"
                    style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);box-sizing:border-box;margin-bottom:12px;">
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button id="token-cancel" style="padding:6px 16px;border:none;border-radius:6px;cursor:pointer;background:var(--bg-secondary);color:var(--text-primary);">取消</button>
                    <button id="token-submit" style="padding:6px 16px;border:none;border-radius:6px;cursor:pointer;background:var(--accent-color);color:#fff;">确认</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        const input = document.getElementById('token-input');
        const submit = () => {
            const val = input.value.trim();
            if (val) {
                localStorage.setItem('apiToken', val);
                modal.remove();
                location.reload();
            }
        };

        document.getElementById('token-submit').onclick = submit;
        document.getElementById('token-cancel').onclick = () => modal.remove();
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        input.focus();
    }

    async startService() {
        const result = await this.apiCall('POST', '/bridge/start');
        if (result.success) {
            this.showToast('success', '启动成功', '桥接服务已启动');
        } else {
            this.showToast('error', '启动失败', result.error);
        }
    }

    async stopService() {
        const result = await this.apiCall('POST', '/bridge/stop');
        if (result.success) {
            this.showToast('success', '已停止', '桥接服务已停止');
        } else {
            this.showToast('error', '停止失败', result.error);
        }
    }

    async testSillyTavern() {
        this.showToast('info', '测试中...', '正在测试 SillyTavern 连接');
        const result = await this.apiCall('POST', '/test/sillytavern');
        if (result.success) {
            this.showToast('success', '连接成功', 'SillyTavern 连接正常');
        } else {
            this.showToast('error', '连接失败', result.error || '无法连接到 SillyTavern');
        }
    }

    async testNapCat() {
        this.showToast('info', '测试中...', '正在测试 NapCat 连接');
        const result = await this.apiCall('POST', '/test/napcat');
        if (result.success) {
            this.showToast('success', '连接成功', 'NapCat 连接正常');
        } else {
            this.showToast('error', '连接失败', result.error || '无法连接到 NapCat');
        }
    }

    async clearHistory() {
        const result = await this.apiCall('DELETE', '/history');
        if (result.success) {
            this.showToast('success', '已重置', result.message || '已开始新会话，保存的历史仍然保留');
            await this.loadChats();
            await this.loadCurrentInfo();
        } else {
            this.showToast('error', '重置失败', result.error);
        }
    }

    async clearLogs() {
        const result = await this.apiCall('DELETE', '/logs');
        if (result.success) {
            this.logs = [];
            this.renderLogs();
            this.showToast('success', '已清空', '服务器日志已清空');
        }
    }

    async resetStats() {
        const result = await this.apiCall('POST', '/stats/reset');
        if (result.success) {
            this.showToast('success', '已重置', '统计数据已重置');
        }
    }

    // 角色和聊天管理
    async refreshCharacters() {
        this.showToast('info', '加载中...', '正在获取角色列表');

        // 获取当前信息
        const currentResult = await this.apiCall('GET', '/current');
        if (currentResult.success && currentResult.data) {
            document.getElementById('current-char-name').textContent =
                currentResult.data.characterName || '未选择';
            document.getElementById('current-msg-count').textContent =
                currentResult.data.messageCount || 0;
        }

        // 获取角色列表
        const result = await this.apiCall('GET', '/characters');
        if (result.success && result.data) {
            const select = document.getElementById('character-select');
            select.innerHTML = '<option value="">-- 选择角色 --</option>';
            result.data.forEach(char => {
                const option = document.createElement('option');
                option.value = char.name;
                option.textContent = char.name;
                select.appendChild(option);
            });
            await this.loadChats();
            this.showToast('success', '加载成功', `发现 ${result.data.length} 个角色`);
        } else {
            this.showToast('error', '加载失败', result.error || '无法获取角色列表');
        }
    }

    async selectCharacter() {
        const select = document.getElementById('character-select');
        const name = select.value;
        if (!name) {
            this.showToast('warning', '请选择', '请先选择一个角色');
            return;
        }

        this.showToast('info', '切换中...', `正在切换到角色: ${name}`);
        const result = await this.apiCall('POST', '/characters/select', { name });

        if (result.success) {
            this.showToast('success', '切换成功', `已切换到: ${name}`);
            // 刷新聊天列表
            await this.loadChats();
            // 刷新当前信息
            await this.loadCurrentInfo();
        } else {
            this.showToast('error', '切换失败', result.error);
        }
    }

    async loadChats() {
        const result = await this.apiCall('GET', '/chats');
        if (result.success && result.data) {
            const select = document.getElementById('chat-select');
            select.innerHTML = '<option value="">-- 选择聊天 --</option>';
            result.data.forEach(chat => {
                const option = document.createElement('option');
                option.value = chat.id;
                option.textContent = `${chat.date || ''} - ${chat.preview || '(无预览)'}`;
                select.appendChild(option);
            });
        }
    }

    async selectChat() {
        const select = document.getElementById('chat-select');
        const chatId = select.value;
        if (!chatId) {
            this.showToast('warning', '请选择', '请先选择一个聊天');
            return;
        }

        this.showToast('info', '切换中...', '正在切换聊天');
        const result = await this.apiCall('POST', '/chats/select', { chatId });

        if (result.success) {
            this.showToast('success', '切换成功', '已切换到选定的聊天');
            await this.loadCurrentInfo();
        } else {
            this.showToast('error', '切换失败', result.error);
        }
    }

    async startNewChat() {
        this.showToast('info', '创建中...', '正在开始新聊天');
        const result = await this.apiCall('POST', '/chats/new');

        if (result.success) {
            this.showToast('success', '创建成功', '已开始新聊天');
            await this.loadChats();
            await this.loadCurrentInfo();
        } else {
            this.showToast('error', '创建失败', result.error);
        }
    }

    async loadCurrentInfo() {
        const result = await this.apiCall('GET', '/current');
        if (result.success && result.data) {
            document.getElementById('current-char-name').textContent =
                result.data.characterName || '未选择';
            document.getElementById('current-msg-count').textContent =
                result.data.messageCount || 0;
        }
    }

    // ==================== API 设置管理 ====================

    async refreshApiSettings() {
        this.showToast('info', '加载中...', '正在获取 API 设置');

        // 获取当前 API 设置
        const settingsResult = await this.apiCall('GET', '/api-settings');
        if (settingsResult.success && settingsResult.data) {
            const data = settingsResult.data;
            document.getElementById('current-api-name').textContent =
                data.chatCompletionSource?.text || data.mainApi?.text || '未知';
            document.getElementById('current-model-name').textContent =
                data.modelId || '未知';

            // 填充表单
            document.getElementById('api-url-input').value = data.apiUrl ?? '';
            document.getElementById('model-id-input').value = data.modelId ?? '';
        }

        // 获取连接配置文件列表
        const profilesResult = await this.apiCall('GET', '/connection-profiles');
        if (profilesResult.success && profilesResult.data) {
            const select = document.getElementById('profile-select');
            select.innerHTML = '<option value="">-- 选择配置文件 --</option>';
            profilesResult.data.forEach(profile => {
                const option = document.createElement('option');
                option.value = profile.value;
                option.textContent = profile.name;
                if (profile.selected) option.selected = true;
                select.appendChild(option);
            });
            this.showToast('success', '加载成功', `发现 ${profilesResult.data.length} 个配置文件`);
        } else {
            this.showToast('error', '加载失败', profilesResult.error || '无法获取配置文件');
        }
    }

    async selectConnectionProfile() {
        const select = document.getElementById('profile-select');
        const profile = select.value;
        if (!profile) {
            this.showToast('warning', '请选择', '请先选择一个配置文件');
            return;
        }

        this.showToast('info', '切换中...', '正在切换配置文件');
        const result = await this.apiCall('POST', '/connection-profiles/select', { profile });

        if (result.success) {
            for (const id of ['api-url-input', 'model-id-input', 'api-key-input']) {
                document.getElementById(id).value = '';
            }
            this.showToast('success', '切换成功', `已切换到: ${result.data?.profileName || profile}`);
            // 刷新 API 设置显示
            await this.refreshApiSettings();
        } else {
            this.showToast('error', '切换失败', result.error);
        }
    }

    async applyApiSettings() {
        const apiUrl = document.getElementById('api-url-input').value;
        const apiKey = document.getElementById('api-key-input').value;
        const modelId = document.getElementById('model-id-input').value;

        if (!apiUrl && !apiKey && !modelId) {
            this.showToast('warning', '请填写', '请至少填写一项设置');
            return;
        }

        this.showToast('info', '应用中...', '正在更新 API 设置');

        const settings = {};
        if (apiUrl) settings.apiUrl = apiUrl;
        if (apiKey) settings.apiKey = apiKey;
        if (modelId) settings.modelId = modelId;

        const result = await this.apiCall('POST', '/api-settings', settings);

        if (result.success) {
            document.getElementById('api-key-input').value = '';
            this.showToast('success', '应用成功', `已更新: ${result.data?.changes?.join(', ') || '设置'}`);
            // 刷新显示
            await this.refreshApiSettings();
        } else {
            this.showToast('error', '应用失败', result.error);
        }
    }

    async testApiConnection() {
        this.showToast('info', '测试中...', '正在测试 API 连接，请稍候');

        const result = await this.apiCall('POST', '/test-connection');

        if (result.success && result.data?.success) {
            if (result.data.connected) {
                this.showToast('success', '连接成功', 'API 连接正常');
            } else {
                this.showToast('warning', '连接已发送', '已发送连接请求，请检查 SillyTavern 界面确认状态');
            }
        } else {
            this.showToast('error', '连接失败', result.error || result.data?.error || '无法连接到 API');
        }
    }

    async sendTestMessage() {
        this.showToast('info', '发送中...', '正在发送测试消息，这可能需要几秒钟');

        const result = await this.apiCall('POST', '/test-message');

        if (result.success && result.data?.success) {
            if (result.data.testPassed) {
                this.showToast('success', '测试通过', 'API 响应正常，测试消息发送成功');
            } else {
                this.showToast('warning', '已发送', '测试消息已发送，请检查 SillyTavern 界面查看结果');
            }
        } else {
            this.showToast('error', '测试失败', result.error || result.data?.error || '发送测试消息失败');
        }
    }

    // 配置管理
    async loadConfig() {
        const result = await this.apiCall('GET', '/config');
        if (result.success && result.data) {
            this.fillForm(result.data);
        }
    }

    fillForm(config) {
        // SillyTavern
        this.setFormValue('st-api-url', config.sillytavern?.apiUrl);
        this.setFormValue('st-api-key', config.sillytavern?.apiKey);
        this.setFormValue('st-character', config.sillytavern?.characterId);
        this.setFormValue('st-basic-auth-enabled', config.sillytavern?.basicAuth?.enabled, 'checkbox');
        this.setFormValue('st-basic-auth-username', config.sillytavern?.basicAuth?.username);
        this.setFormValue('st-basic-auth-password', config.sillytavern?.basicAuth?.password);

        // NapCat
        this.setFormValue('nc-ws-url', config.napcat?.wsUrl);
        this.setFormValue('nc-access-token', config.napcat?.accessToken);

        // Reply
        const prefixes = config.reply?.triggerPrefixes?.join(', ') || '';
        this.setFormValue('reply-prefixes', prefixes);
        this.setFormValue('reply-bot-qq', config.reply?.botQQ);
        this.setFormValue('reply-require-at', config.reply?.requireAtInGroup !== false, 'checkbox');
        this.setFormValue('reply-delay', config.reply?.replyDelay);
        this.setFormValue('reply-max-delay', config.reply?.maxReplyDelay);
        this.setFormValue('reply-delay-per-char', config.reply?.delayPerChar);

        // Access Control
        this.setFormValue('ac-blacklist', config.accessControl?.blacklist?.join('\n') || '');
        this.setFormValue('ac-whitelist', config.accessControl?.whitelist?.join('\n') || '');
        this.setFormValue('ac-group-blacklist', config.accessControl?.groupBlacklist?.join('\n') || '');
        this.setFormValue('ac-group-whitelist', config.accessControl?.groupWhitelist?.join('\n') || '');
    }

    setFormValue(id, value, type = 'text') {
        const el = document.getElementById(id);
        if (!el) return;
        if (type === 'checkbox') {
            el.checked = !!value;
        } else {
            el.value = value ?? '';
        }
    }

    async saveConfig() {
        const readDelay = (id, fallback) => {
            const value = parseInt(document.getElementById(id)?.value, 10);
            return Number.isNaN(value) ? fallback : value;
        };
        const config = {
            sillytavern: {
                apiUrl: document.getElementById('st-api-url')?.value || '',
                apiKey: document.getElementById('st-api-key')?.value || '',
                characterId: document.getElementById('st-character')?.value || '',
                basicAuth: {
                    enabled: document.getElementById('st-basic-auth-enabled')?.checked || false,
                    username: document.getElementById('st-basic-auth-username')?.value || '',
                    password: document.getElementById('st-basic-auth-password')?.value || ''
                }
            },
            napcat: {
                wsUrl: document.getElementById('nc-ws-url')?.value || '',
                accessToken: document.getElementById('nc-access-token')?.value || ''
            },
            reply: {
                triggerPrefixes: (document.getElementById('reply-prefixes')?.value || '')
                    .split(',').map(s => s.trim()).filter(s => s),
                botQQ: document.getElementById('reply-bot-qq')?.value || '',
                requireAtInGroup: document.getElementById('reply-require-at')?.checked ?? true,
                replyDelay: readDelay('reply-delay', 500),
                maxReplyDelay: readDelay('reply-max-delay', 3000),
                delayPerChar: readDelay('reply-delay-per-char', 50)
            },
            accessControl: {
                blacklist: this.textToArray(document.getElementById('ac-blacklist')?.value),
                whitelist: this.textToArray(document.getElementById('ac-whitelist')?.value),
                groupBlacklist: this.textToArray(document.getElementById('ac-group-blacklist')?.value),
                groupWhitelist: this.textToArray(document.getElementById('ac-group-whitelist')?.value)
            }
        };

        const result = await this.apiCall('POST', '/config', config);
        if (result.success) {
            this.showToast('success', '保存成功', result.message || '配置已保存');
        } else {
            this.showToast('error', '保存失败', result.error);
        }
    }

    textToArray(text) {
        if (!text) return [];
        return text.split('\n').map(s => s.trim()).filter(s => s);
    }

    // Toast 通知
    showToast(type, title, message) {
        const container = document.getElementById('toast-container');
        const iconMap = {
            success: 'check-circle',
            error: 'x-circle',
            warning: 'alert-triangle',
            info: 'info'
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i data-lucide="${iconMap[type] || 'info'}" class="toast-icon"></i>
            <div class="toast-content">
                <div class="toast-title"></div>
                <div class="toast-message"></div>
            </div>
            <button class="toast-close"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
        `;

        toast.querySelector('.toast-title').textContent = title ?? '';
        toast.querySelector('.toast-message').textContent = message ?? '';

        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        });

        container.appendChild(toast);

        // Initialize Lucide icons for the new toast
        if (window.lucide) lucide.createIcons({ nodes: toast.querySelectorAll('[data-lucide]') });

        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('toast-out');
                setTimeout(() => toast.remove(), 300);
            }
        }, 4000);
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.app = new SillyTavernBridgeApp();
});
