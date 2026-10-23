const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const silent = new Proxy({}, { get: () => () => {} });
function load(file, mocks, globals = {}) {
    const filename = path.resolve(file);
    const context = { module: { exports: {} }, require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        throw new Error('Unexpected dependency: ' + name);
    }, __dirname: path.dirname(filename), console: silent, URL,
    setTimeout, clearTimeout, setInterval, clearInterval, ...globals };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return context.module.exports;
}
function configuration() {
    return {
        sillytavern: { apiUrl: 'http://127.0.0.1:8000', apiKey: '', characterId: '', basicAuth: { enabled: false, username: '', password: '' } },
        napcat: { wsUrl: 'ws://127.0.0.1:3001', accessToken: '' },
        reply: { triggerPrefixes: ['#chat'], requireAtInGroup: true, botQQ: '123', replyDelay: 0, maxReplyDelay: 0, delayPerChar: 0 },
        accessControl: { blacklist: [], whitelist: [], groupBlacklist: [], groupWhitelist: [] },
        webui: { enabled: false, apiToken: 'synthetic-test-token' }
    };
}
function configStore(config = configuration()) {
    return { config, load() {}, get(key) { return key ? key.split('.').reduce((value, part) => value?.[part], this.config) : this.config; },
        save(patch) { for (const key of Object.keys(patch)) this.config[key] = { ...this.config[key], ...patch[key] }; } };
}
function tavern() {
    return load('server/services/sillyTavernClient.js', { puppeteer: {}, '../utils/logger': silent, '../utils/configManager': configStore() });
}
function routes(st, config = configStore(), nap = {}, bridge = { running: true }) {
    const handlers = new Map();
    const router = {};
    for (const method of ['get', 'post', 'delete']) router[method] = (route, handler) => handlers.set(method + ' ' + route, handler);
    load('server/routes/api.js', { express: { Router: () => router }, '../utils/logger': silent,
        '../utils/configManager': config, '../services/sillyTavernClient': st, '../services/napCatClient': nap, '../services/bridgeService': bridge });
    return async (method, route, body = {}, query = {}) => {
        const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
        await handlers.get(method + ' ' + route)({ body, query }, response);
        return response;
    };
}
module.exports = { load, silent, configuration, configStore, tavern, routes };
