/**
 * 日志管理器
 * 提供统一的日志记录功能，支持 WebUI 实时日志推送
 */

class Logger {
    constructor() {
        this.logs = [];
        this.maxLogEntries = 500;
        this.level = 'info';
        this.listeners = new Set();
        
        // 日志级别权重
        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
    }

    /**
     * 设置日志级别
     */
    setLevel(level) {
        this.level = level;
    }

    /**
     * 设置最大日志条数
     */
    setMaxEntries(max) {
        this.maxLogEntries = max;
    }

    /**
     * 添加日志监听器（用于 WebSocket 推送）
     */
    addListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * 移除日志监听器
     */
    removeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * 通知所有监听器
     */
    notifyListeners(logEntry) {
        this.listeners.forEach(callback => {
            try {
                callback(logEntry);
            } catch (err) {
                console.error('日志监听器错误:', err);
            }
        });
    }

    /**
     * 记录日志
     */
    log(level, category, message, data = null) {
        // 检查日志级别
        if (this.levels[level] < this.levels[this.level]) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logEntry = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            timestamp,
            level,
            category,
            message,
            data
        };

        // 添加到日志数组
        this.logs.push(logEntry);

        // 限制日志条数
        if (this.logs.length > this.maxLogEntries) {
            this.logs.shift();
        }

        // 控制台输出
        const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}`;
        switch (level) {
            case 'debug':
                console.debug('\x1b[36m%s\x1b[0m', consoleMsg);
                break;
            case 'info':
                console.info('\x1b[32m%s\x1b[0m', consoleMsg);
                break;
            case 'warn':
                console.warn('\x1b[33m%s\x1b[0m', consoleMsg);
                break;
            case 'error':
                console.error('\x1b[31m%s\x1b[0m', consoleMsg);
                break;
        }

        // 通知监听器
        this.notifyListeners(logEntry);

        return logEntry;
    }

    debug(category, message, data) {
        return this.log('debug', category, message, data);
    }

    info(category, message, data) {
        return this.log('info', category, message, data);
    }

    warn(category, message, data) {
        return this.log('warn', category, message, data);
    }

    error(category, message, data) {
        return this.log('error', category, message, data);
    }

    /**
     * 获取所有日志
     */
    getLogs(limit = 100) {
        return this.logs.slice(-limit);
    }

    /**
     * 清空日志
     */
    clear() {
        this.logs = [];
    }
}

// 单例导出
const logger = new Logger();
module.exports = logger;
