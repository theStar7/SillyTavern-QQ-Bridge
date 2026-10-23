const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const WebSocket = require('ws');
const express = require('express');
const { load, silent, configStore, tavern, routes } = require('./helpers');

test('zero delays are honored by the actual reply calculation', () => {
    const bridge = load('server/services/bridgeService.js', { '../utils/logger': silent,
        '../utils/configManager': configStore(), './sillyTavernClient': {}, './napCatClient': {} });
    assert.equal(bridge.calculateReplyDelay('hello'), 0);
});

test('reset creates a new active chat and propagates failure', async () => {
    const st = tavern();
    let calls = 0;
    st.startNewChat = async () => { calls++; return { success: false, error: 'choose a character' }; };
    const result = await st.clearAllHistory();
    assert.equal(calls, 1);
    assert.equal(result.success, false);
    assert.equal(result.error, 'choose a character');
    assert.equal((await st.clearHistory('123')).success, false);
    assert.equal(calls, 1, 'per-user reset is unsupported by the shared chat');
});

test('history endpoint waits for reset and reports its failure', async () => {
    let finish;
    const request = routes({ clearAllHistory: () => new Promise(resolve => { finish = resolve; }) });
    let replied = false;
    const pending = request('delete', '/history').then(value => { replied = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    const premature = replied;
    finish({ success: false, error: 'reset failed' });
    const response = await pending;
    assert.equal(premature, false);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error, 'reset failed');
});

test('connection configuration is reopened before save reports success', async () => {
    const config = configStore();
    const events = [];
    let finish;
    const st = { initialized: true, messageQueue: [], close: async () => { events.push('close'); },
        initialize: () => { events.push('initialize'); return new Promise(resolve => { finish = resolve; }); } };
    const nap = { connected: true, disconnect() { events.push('disconnect'); }, connect() { events.push('connect'); } };
    const request = routes(st, config, nap);
    let replied = false;
    const pending = request('post', '/config', { sillytavern: { apiUrl: 'http://127.0.0.1:9000' }, napcat: { wsUrl: 'ws://127.0.0.1:9001' } }).then(value => { replied = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    const premature = replied;
    finish?.();
    const response = await pending;
    assert.equal(premature, false);
    assert.deepEqual([...events].sort(), ['close', 'connect', 'disconnect', 'initialize']);
    assert.ok(events.indexOf('close') < events.indexOf('initialize'));
    assert.ok(events.indexOf('disconnect') < events.indexOf('connect'));
    assert.equal(response.body.success, true);
    assert.match(response.body.message, /重连/);
});

test('unrelated configuration does not reopen connections', async () => {
    const st = { initialized: true, initialize: () => assert.fail('unnecessary reconnect') };
    const response = await routes(st)('post', '/config', { reply: { replyDelay: 10 } });
    assert.equal(response.body.success, true);
});

test('busy chat rejects connection changes before persisting them', async () => {
    const config = configStore();
    const response = await routes({ initialized: true, isProcessing: true, messageQueue: [], initialize: async () => {} }, config)('post', '/config', { sillytavern: { apiUrl: 'http://127.0.0.1:9000' } });
    assert.equal(response.code, 409);
    assert.equal(config.get('sillytavern.apiUrl'), 'http://127.0.0.1:8000');
});

test('reconnect failure explicitly distinguishes persisted configuration', async () => {
    const st = { initialized: true, messageQueue: [], close: async () => {}, initialize: async () => { throw new Error('offline'); } };
    const response = await routes(st)('post', '/config', { sillytavern: { apiUrl: 'http://127.0.0.1:9000' } });
    assert.equal(response.body.success, false);
    assert.match(response.body.error, /已保存.*重.*失败/);
});

test('intentional NapCat disconnect does not reconnect or corrupt a replacement socket', () => {
    const sockets = [];
    class Socket extends EventEmitter { constructor() { super(); sockets.push(this); } close() {} }
    const nap = load('server/services/napCatClient.js', { ws: Socket, '../utils/logger': silent, '../utils/configManager': configStore() });
    nap.getLoginInfo = () => {};
    nap.connect();
    nap.disconnect();
    sockets[0].emit('close', 1000, 'intentional');
    const unwantedTimer = nap.reconnectTimer;
    if (unwantedTimer) clearTimeout(unwantedTimer);
    nap.reconnectTimer = null;
    nap.connect();
    sockets[1].emit('open');
    sockets[0].emit('close', 1000, 'old socket');
    const replacementConnected = nap.connected;
    nap.disconnect();
    assert.equal(unwantedTimer, null);
    assert.equal(replacementConnected, true);
});

test('WebSocket authentication protects initial logs and revoked subscribers', async () => {
    const config = configStore();
    const ticks = [];
    const listeners = new Set();
    const logger = { ...Object.fromEntries(['info', 'warn', 'error', 'setLevel', 'setMaxEntries'].map(key => [key, () => {}])),
        getLogs: () => [{ message: 'synthetic private log' }], addListener: cb => listeners.add(cb), removeListener: cb => listeners.delete(cb) };
    let wss;
    const result = load('server/index.js', { express, cors: () => (req, res, next) => next(), path,
        http: { createServer(app) { const server = http.createServer(app); const listen = server.listen; server.listen = () => listen.call(server, 0, '127.0.0.1'); return server; } },
        ws: { OPEN: WebSocket.OPEN, Server: class extends WebSocket.Server { constructor(options) { super(options); wss = this; } } },
        './utils/configManager': config, './utils/logger': logger, './routes/api': express.Router(), './services/bridgeService': { getStatus: () => ({ running: true }) }
    }, { process: { on() {} }, setInterval: cb => { ticks.push(cb); return 0; }, clearInterval() {} });
    await once(result.server, 'listening');
    const url = 'ws://127.0.0.1:' + result.server.address().port + '/ws';
    const clients = [];
    const connect = (suffix = '', options) => new Promise(resolve => {
        const socket = new WebSocket(url + suffix, options); clients.push(socket);
        socket.on('error', () => {});
        socket.once('open', () => resolve({ socket, status: 101 }));
        socket.once('unexpected-response', (req, response) => { response.resume(); socket.terminate(); resolve({ status: response.statusCode }); });
    });
    try {
        const missing = await connect();
        const invalid = await connect('?token=invalid');
        const valid = await connect('?token=synthetic-test-token');
        const header = await connect('', { headers: { Authorization: 'Bearer synthetic-test-token' } });
        assert.equal(missing.status, 401);
        assert.equal(invalid.status, 401);
        assert.equal(valid.status, 101);
        assert.equal(header.status, 101);
        const revoked = once(valid.socket, 'close');
        config.config.webui.apiToken = 'rotated-synthetic-token';
        ticks.forEach(cb => cb());
        const [code] = await Promise.race([revoked, new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('revoked socket stayed open')), 2000); timer.unref(); })]);
        assert.equal(code, 1008);
        config.config.webui.apiToken = '';
        assert.equal((await connect()).status, 101);
    } finally {
        clients.forEach(client => client.terminate());
        await new Promise(resolve => wss.close(resolve));
        await new Promise(resolve => result.server.close(resolve));
    }
});
