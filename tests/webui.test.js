const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { WebSocketServer } = require('ws');
const { configuration, tavern } = require('./helpers');
let browser, page, server, wss, base, profile, failProfile, failReset, requests, errors;
const unsafeName = '<img src="/__missing" onerror="window.toastExecuted=true">';
before(async () => {
    server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) {
            let raw = ''; for await (const chunk of req) raw += chunk;
            const body = raw ? JSON.parse(raw) : undefined;
            requests.push({ method: req.method, path: url.pathname, body });
            let result = { success: true };
            switch (url.pathname) {
                case '/api/config': result = { success: true, data: configuration(), message: '配置已保存；NapCat 正在重连' }; break;
                case '/api/current': result.data = { characterName: 'Example', messageCount: 12 }; break;
                case '/api/characters': result.data = [{ name: 'Example' }, { name: unsafeName }]; break;
                case '/api/chats': result.data = [{ id: 'saved-chat', date: '2026-10-22', preview: 'example' }]; break;
                case '/api/api-settings': result.data = profile === 'a' ? { apiUrl: 'https://api-a.invalid/v1', modelId: 'model-a' } : { apiUrl: '', modelId: '' }; break;
                case '/api/connection-profiles': result.data = ['a', 'b'].map(value => ({ value, name: value, selected: profile === value })); break;
                case '/api/connection-profiles/select':
                    if (failProfile) result = { success: false, data: { error: 'profile unavailable' } };
                    else { profile = body.profile; result.data = { profileName: profile }; } break;
                case '/api/history': if (failReset) result = { success: false, error: 'reset unavailable' }; break;
            }
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
        }
        const files = { '/': 'public/index.html', '/js/app.js': 'public/js/app.js', '/css/style.css': 'public/css/style.css' };
        if (!files[url.pathname]) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(fs.readFileSync(path.resolve(files[url.pathname])));
    });
    wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', socket => socket.send(JSON.stringify({ type: 'status', data: { running: true, sillytavern: { connected: true }, napcat: { connected: true }, stats: {} } })));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
    page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.url().startsWith(base)) request.continue();
        else if (request.url().includes('unpkg.com')) request.respond({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' });
        else request.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
});
after(async () => {
    await browser?.close();
    for (const socket of wss?.clients || []) socket.terminate();
    if (wss) await new Promise(resolve => wss.close(resolve));
    if (server) await new Promise(resolve => server.close(resolve));
});
beforeEach(async () => {
    profile = 'a'; failProfile = false; failReset = false; requests = []; errors = [];
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.app && document.getElementById('st-api-url').value);
});

test('role names are rendered as toast text without executable markup', async () => {
    await page.evaluate(async name => { await app.refreshCharacters(); document.getElementById('character-select').value = name; await app.selectCharacter(); }, unsafeName);
    const state = await page.evaluate(() => ({ executed: !!window.toastExecuted, images: document.querySelectorAll('.toast img').length, text: document.getElementById('toast-container').textContent }));
    assert.equal(state.images, 0);
    assert.equal(state.executed, false);
    assert.ok(state.text.includes(unsafeName));
});

test('switching profiles replaces empty fields and clears the previous key', async () => {
    const fields = await page.evaluate(async () => {
        await app.refreshApiSettings(); document.getElementById('api-key-input').value = 'synthetic-key';
        document.getElementById('profile-select').value = 'b'; await app.selectConnectionProfile();
        return ['api-url-input', 'model-id-input', 'api-key-input'].map(id => document.getElementById(id).value);
    });
    assert.deepEqual(fields, ['', '', '']);
});

test('successful API apply clears the key, failed profile switch preserves edits and explains failure', async () => {
    await page.evaluate(async () => { document.getElementById('api-key-input').value = 'synthetic-key'; await app.applyApiSettings(); });
    assert.equal(await page.$eval('#api-key-input', el => el.value), '');
    failProfile = true;
    const state = await page.evaluate(async () => {
        document.getElementById('api-key-input').value = 'unsaved-key';
        document.getElementById('profile-select').value = 'b'; await app.selectConnectionProfile();
        return { key: document.getElementById('api-key-input').value, error: document.querySelector('.toast-error .toast-message')?.textContent };
    });
    assert.equal(state.key, 'unsaved-key');
    assert.equal(state.error, 'profile unavailable');
});

test('nested backend errors appear in the notification', async () => {
    failProfile = true;
    await page.evaluate(async () => { await app.refreshApiSettings(); document.getElementById('profile-select').value = 'b'; await app.selectConnectionProfile(); });
    assert.equal(await page.$eval('.toast-error .toast-message', el => el.textContent), 'profile unavailable');
});

test('zero delays survive loading, editing and saving', async () => {
    const loaded = await page.$$eval('#reply-delay, #reply-max-delay, #reply-delay-per-char', els => els.map(el => el.value));
    await page.evaluate(async () => { ['reply-delay', 'reply-max-delay', 'reply-delay-per-char'].forEach(id => document.getElementById(id).value = '0'); await app.saveConfig(); });
    const saved = requests.find(request => request.method === 'POST' && request.path === '/api/config').body.reply;
    assert.deepEqual(loaded, ['0', '0', '0']);
    assert.deepEqual([saved.replyDelay, saved.maxReplyDelay, saved.delayPerChar], [0, 0, 0]);
    assert.match(await page.$eval('.toast-success .toast-message', el => el.textContent), /正在重连/);
});

test('refresh loads existing chats without reselecting the character', async () => {
    await page.evaluate(() => app.refreshCharacters());
    assert.equal(await page.$eval('#chat-select option[value="saved-chat"]', el => el.value), 'saved-chat');
});

test('lost WebSocket marks status as unknown instead of leaving stale online state', async () => {
    await page.waitForFunction(() => document.querySelector('#st-status .status-text').textContent === '在线');
    for (const socket of wss.clients) socket.close();
    await page.waitForFunction(() => app.ws.readyState === WebSocket.CLOSED);
    const texts = await page.$$eval('#bridge-status .status-text, #st-status .status-text, #nc-status .status-text', els => els.map(el => el.textContent));
    assert.deepEqual(texts, ['连接中断', '未知', '未知']);
});

test('WebSocket URL includes the configured token without corrupting special characters', async () => {
    const value = await page.evaluate(() => { localStorage.setItem('apiToken', 'synthetic +&? token'); app.ws.close(); app.connectWebSocket(); return new URL(app.ws.url).searchParams.get('token'); });
    assert.equal(value, 'synthetic +&? token');
    await page.evaluate(() => localStorage.removeItem('apiToken'));
});

test('failed reset shows an error and successful reset refreshes current chat information', async () => {
    failReset = true;
    await page.evaluate(() => app.clearHistory());
    assert.equal(await page.$eval('.toast-error .toast-message', el => el.textContent), 'reset unavailable');
    failReset = false; requests = [];
    await page.evaluate(() => app.clearHistory());
    assert.ok(requests.some(request => request.path === '/api/current'));
    assert.ok(requests.some(request => request.path === '/api/chats'));
});

test('desktop/mobile navigation, log filters and persisted theme still work', async () => {
    await page.click('.nav-item[data-page="logs"]');
    assert.equal(await page.$eval('#page-logs', el => el.classList.contains('active')), true);
    await page.evaluate(() => { app.addLog({ timestamp: new Date().toISOString(), level: 'info', source: 'test', message: 'info sample' }); app.addLog({ timestamp: new Date().toISOString(), level: 'error', source: 'test', message: 'error sample' }); });
    await page.click('.btn-filter[data-level="error"]');
    const logs = await page.$eval('#logs-container', el => el.textContent);
    assert.ok(logs.includes('error sample')); assert.ok(!logs.includes('info sample'));
    await page.click('#btn-clear-log-display');
    await page.evaluate(() => document.getElementById('toast-container').replaceChildren());
    await page.setViewport({ width: 390, height: 844 });
    await page.click('#btn-menu-toggle');
    assert.equal(await page.$eval('#sidebar', el => el.classList.contains('open')), true);
    await page.click('.nav-item[data-page="settings"]');
    assert.equal(await page.$eval('#sidebar', el => el.classList.contains('open')), false);
    await page.click('#btn-theme-toggle');
    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'), theme);
    assert.deepEqual(errors, []);
});

test('new-chat confirms the dialog, preserves saved history and waits for a changed chat identity', async () => {
    const fixture = await browser.newPage();
    try {
        await fixture.setContent('<button id="options_button">menu</button><button id="option_start_new_chat" hidden>new</button><input id="selected_chat_pole" value="old-chat"><textarea id="send_textarea"></textarea><dialog><input id="del_chat_checkbox" type="checkbox" checked><button class="popup-button-ok">OK</button></dialog>');
        await fixture.evaluate(() => {
            window.chatId = 'old-chat'; window.deleted = null; window.chatLoaded = false;
            const listeners = new Map();
            window.resetEvents = { on(name, handler) { listeners.set(name, handler); }, removeListener(name) { listeners.delete(name); }, emit(name, id) { listeners.get(name)?.(id); } };
            window.SillyTavern = { getContext: () => ({ chatId: window.chatId, eventSource: resetEvents, eventTypes: { CHAT_CHANGED: 'chat-changed' } }) };
            document.getElementById('options_button').onclick = () => document.getElementById('option_start_new_chat').hidden = false;
            document.getElementById('option_start_new_chat').onclick = () => document.querySelector('dialog').showModal();
            document.querySelector('.popup-button-ok').onclick = () => { window.deleted = document.getElementById('del_chat_checkbox').checked; document.querySelector('dialog').close(); setTimeout(() => { window.chatId = 'new-chat'; document.getElementById('selected_chat_pole').value = 'new-chat'; }, 100); setTimeout(() => { window.chatLoaded = true; resetEvents.emit('chat-changed', 'new-chat'); }, 600); };
        });
        const st = tavern(); st.initialized = true; st.page = fixture;
        st.doSendMessage = async () => ({ success: await fixture.evaluate(() => window.chatLoaded) });
        const pending = st.startNewChat();
        await fixture.waitForFunction(() => window.chatId === 'new-chat');
        const queued = st.sendMessage('synthetic-user', 'synthetic-message');
        const result = await pending;
        assert.equal((await queued).success, true, 'queued messages resume after loading');
        assert.equal(await fixture.evaluate(() => '__qqBridgeChatReset' in window), false);
        const state = await fixture.evaluate(() => ({ id: chatId, deleted, loaded: chatLoaded }));
        assert.equal(result.success, true);
        assert.deepEqual(state, { id: 'new-chat', deleted: false, loaded: true });
    } finally { await fixture.close(); }
});

test('new-chat never reports success if chat identity does not change', async () => {
    const st = tavern(); st.initialized = true;
    st.page = { evaluate: async () => ({ success: true }), waitForSelector: async () => ({ click: async () => {}, evaluate: async () => {} }), click: async () => {}, waitForFunction: async () => { throw new Error('chat identity unchanged'); } };
    const result = await st.startNewChat();
    assert.equal(result.success, false);
});
