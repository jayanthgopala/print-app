const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Cloudflare Tunnel Manager
 * Automatically manages cloudflared tunnel for production use
 */

class TunnelManager {
    constructor(options = {}) {
        this.port = options.port || 8788;
        this.logPath = options.logPath || path.join(__dirname, 'tunnel.log');
        this.tunnelProcess = null;
        this.tunnelUrl = null;
        this.statusCallback = options.onStatusChange || (() => {});
        this.urlCallback = options.onUrlDetected || (() => {});
        this.restartAttempts = 0;
        this.maxRestartAttempts = 5;
        this.isShuttingDown = false;
    }

    /**
     * Start the tunnel
     */
    async start() {
        if (this.tunnelProcess) {
            console.log('Tunnel already running');
            return { success: true, url: this.tunnelUrl };
        }

        this.isShuttingDown = false;
        this.restartAttempts = 0;

        return new Promise(async (resolve, reject) => {
            try {
                const cloudflaredBinary = await TunnelManager.resolveBinaryPath();
                if (!cloudflaredBinary) {
                    reject(new Error('Cloudflared executable not found'));
                    return;
                }

                console.log(`Starting cloudflared tunnel on port ${this.port}...`);
                this.statusCallback('starting');

                // Spawn cloudflared process
                this.tunnelProcess = spawn(cloudflaredBinary, ['tunnel', '--url', `http://localhost:${this.port}`], {
                    detached: false,
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let outputBuffer = '';
                const timeout = setTimeout(() => {
                    if (!this.tunnelUrl) {
                        this.stop();
                        reject(new Error('Tunnel URL not detected within 30 seconds'));
                    }
                }, 30000);

                // Capture stdout
                this.tunnelProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    outputBuffer += output;
                    this.appendLog(output);

                    // Look for tunnel URL
                    const detectedUrl = TunnelManager.extractTunnelUrl(output);
                    if (detectedUrl && !this.tunnelUrl) {
                        clearTimeout(timeout);
                        this.tunnelUrl = detectedUrl;
                        console.log(`Tunnel URL detected: ${this.tunnelUrl}`);
                        this.statusCallback('url-detected', this.tunnelUrl);
                        this.urlCallback(this.tunnelUrl);
                        resolve({ success: true, url: this.tunnelUrl });
                    }
                });

                // Capture stderr
                this.tunnelProcess.stderr.on('data', (data) => {
                    const output = data.toString();
                    this.appendLog(`[ERROR] ${output}`);
                    
                    // Also check stderr for URL (cloudflared sometimes outputs there)
                    const detectedUrl = TunnelManager.extractTunnelUrl(output);
                    if (detectedUrl && !this.tunnelUrl) {
                        clearTimeout(timeout);
                        this.tunnelUrl = detectedUrl;
                        console.log(`Tunnel URL detected: ${this.tunnelUrl}`);
                        this.statusCallback('url-detected', this.tunnelUrl);
                        this.urlCallback(this.tunnelUrl);
                        resolve({ success: true, url: this.tunnelUrl });
                    }
                });

                // Handle process exit
                this.tunnelProcess.on('exit', (code, signal) => {
                    clearTimeout(timeout);
                    console.log(`Tunnel process exited with code ${code}, signal ${signal}`);
                    this.appendLog(`Tunnel exited: code=${code}, signal=${signal}`);
                    this.tunnelProcess = null;
                    this.tunnelUrl = null;
                    this.statusCallback('offline');

                    // Auto-restart if not intentional shutdown
                    if (!this.isShuttingDown && this.restartAttempts < this.maxRestartAttempts) {
                        this.restartAttempts++;
                        console.log(`Auto-restarting tunnel (attempt ${this.restartAttempts}/${this.maxRestartAttempts})...`);
                        setTimeout(() => this.start(), 5000);
                    }
                });

                // Handle process errors
                this.tunnelProcess.on('error', (error) => {
                    clearTimeout(timeout);
                    console.error('Tunnel process error:', error);
                    this.appendLog(`[ERROR] Process error: ${error.message}`);
                    this.statusCallback('error', null, error.message);
                    reject(error);
                });

            } catch (error) {
                console.error('Failed to start tunnel:', error);
                reject(error);
            }
        });
    }

    /**
     * Stop the tunnel
     */
    stop() {
        this.isShuttingDown = true;
        
        if (this.tunnelProcess) {
            console.log('Stopping tunnel...');
            this.appendLog('Stopping tunnel...');
            
            try {
                this.tunnelProcess.kill('SIGTERM');
                
                // Force kill after 5 seconds if still running
                setTimeout(() => {
                    if (this.tunnelProcess) {
                        this.tunnelProcess.kill('SIGKILL');
                    }
                }, 5000);
            } catch (error) {
                console.error('Error stopping tunnel:', error);
            }
            
            this.tunnelProcess = null;
            this.tunnelUrl = null;
            this.statusCallback('offline');
        }
    }

    /**
     * Restart the tunnel
     */
    async restart() {
        console.log('Restarting tunnel...');
        this.stop();
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.start();
    }

    /**
     * Get current tunnel URL
     */
    getUrl() {
        return this.tunnelUrl;
    }

    /**
     * Check if tunnel is running
     */
    isRunning() {
        return this.tunnelProcess !== null && this.tunnelUrl !== null;
    }

    /**
     * Check if cloudflared is installed
     */
    static async checkInstalled() {
        const binaryPath = await TunnelManager.resolveBinaryPath();
        if (!binaryPath) {
            return { installed: false };
        }

        return new Promise((resolve) => {
            const check = spawn(binaryPath, ['--version'], { stdio: 'pipe' });
            
            let output = '';
            check.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            check.on('exit', (code) => {
                if (code === 0) {
                    resolve({ installed: true, version: output.trim(), path: binaryPath });
                } else {
                    resolve({ installed: false });
                }
            });
            
            check.on('error', () => {
                resolve({ installed: false });
            });
        });
    }

    static async resolveBinaryPath() {
        const candidates = [
            process.env.CLOUDFLARED_PATH,
            path.join(process.env.ProgramFiles || '', 'cloudflared', 'cloudflared.exe'),
            path.join(process.env['ProgramFiles(x86)'] || '', 'cloudflared', 'cloudflared.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Cloudflare.cloudflared_8wekyb3d8bbwe', 'cloudflared.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'cloudflared.exe'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'cloudflared.exe'),
            path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cloudflared.exe')
        ].filter(Boolean);

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        const discovered = await TunnelManager.findBinaryWithWhere();
        return discovered || '';
    }

    static async findBinaryWithWhere() {
        return new Promise((resolve) => {
            const lookup = spawn('where.exe', ['cloudflared'], { stdio: ['ignore', 'pipe', 'ignore'] });
            let output = '';

            lookup.stdout.on('data', (data) => {
                output += data.toString();
            });

            lookup.on('exit', (code) => {
                if (code !== 0) {
                    resolve('');
                    return;
                }

                const match = output
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .find((line) => line.toLowerCase().endsWith('cloudflared.exe') && fs.existsSync(line));

                resolve(match || '');
            });

            lookup.on('error', () => resolve(''));
        });
    }

    static extractTunnelUrl(output) {
        const match = String(output || '').match(/https:\/\/[^\s"']*?\.trycloudflare\.com/i);
        return match ? match[0].replace(/\/+$/, '') : '';
    }

    /**
     * Append to log file
     */
    appendLog(message) {
        try {
            const timestamp = new Date().toISOString();
            const logLine = `[${timestamp}] ${message}\n`;
            fs.appendFileSync(this.logPath, logLine);
        } catch (error) {
            // Ignore log errors
        }
    }
}

module.exports = TunnelManager;
