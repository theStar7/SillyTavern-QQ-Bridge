/**
 * 配置管理器
 * 负责加载、保存和管理配置文件
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const logger = require('./logger');

class ConfigManager {
    constructor() {
        this.configPath = path.join(__dirname, '../../config/config.yaml');
        this.config = null;
        this.listeners = new Set();
    }

    /**
     * 加载配置文件
     */
    load() {
        try {
            if (!fs.existsSync(this.configPath)) {
                logger.error('ConfigManager', `配置文件不存在: ${this.configPath}`);
                throw new Error('配置文件不存在');
            }

            const content = fs.readFileSync(this.configPath, 'utf8');
            this.config = YAML.parse(content);
            logger.info('ConfigManager', '配置文件加载成功');
            return this.config;
        } catch (error) {
            logger.error('ConfigManager', `加载配置文件失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 保存配置文件
     */
    save(newConfig = null) {
        try {
            if (newConfig) {
                this.config = this.mergeConfig(this.config, newConfig);
            }

            const content = YAML.stringify(this.config, {
                indent: 2,
                lineWidth: 0
            });

            fs.writeFileSync(this.configPath, content, 'utf8');
            logger.info('ConfigManager', '配置文件保存成功');

            // 通知监听器配置已更新
            this.notifyListeners();

            return true;
        } catch (error) {
            logger.error('ConfigManager', `保存配置文件失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 深度合并配置
     */
    mergeConfig(target, source) {
        const result = { ...target };

        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this.mergeConfig(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }

        return result;
    }

    /**
     * 获取配置
     */
    get(path = null) {
        if (!this.config) {
            this.load();
        }

        if (!path) {
            return this.config;
        }

        // 支持点号分隔的路径，如 'sillytavern.apiUrl'
        const keys = path.split('.');
        let value = this.config;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return undefined;
            }
        }

        return value;
    }

    /**
     * 设置配置项
     */
    set(path, value) {
        if (!this.config) {
            this.load();
        }

        const keys = path.split('.');
        let target = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in target) || typeof target[key] !== 'object') {
                target[key] = {};
            }
            target = target[key];
        }

        target[keys[keys.length - 1]] = value;
        this.save();
    }

    /**
     * 添加配置变更监听器
     */
    addListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * 移除配置变更监听器
     */
    removeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * 通知所有监听器
     */
    notifyListeners() {
        this.listeners.forEach(callback => {
            try {
                callback(this.config);
            } catch (err) {
                logger.error('ConfigManager', `配置监听器错误: ${err.message}`);
            }
        });
    }

    /**
     * 获取用于前端显示的安全配置（隐藏敏感信息）
     */
    getSafeConfig() {
        const config = this.get();
        return {
            sillytavern: {
                apiUrl: config.sillytavern?.apiUrl || '',
                apiKey: config.sillytavern?.apiKey ? '******' : '',
                basicAuth: {
                    enabled: config.sillytavern?.basicAuth?.enabled || false,
                    username: config.sillytavern?.basicAuth?.username || '',
                    password: config.sillytavern?.basicAuth?.password ? '******' : ''
                },
                characterId: config.sillytavern?.characterId || ''
            },
            napcat: {
                wsUrl: config.napcat?.wsUrl || '',
                accessToken: config.napcat?.accessToken ? '******' : ''
            },
            reply: config.reply || {},
            accessControl: config.accessControl || {},
            webui: config.webui || {},
            logging: config.logging || {}
        };
    }
}

// 单例导出
const configManager = new ConfigManager();
module.exports = configManager;
