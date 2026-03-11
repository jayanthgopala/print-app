import { EventEmitter } from 'events';
import axios from 'axios';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import ptp from 'pdf-to-printer';
import os from 'os';

const BASE_DATA_DIR = path.join(os.homedir(), '.print-platform');
const TEMP_FOLDER = process.env.TEMP_FOLDER || path.join(BASE_DATA_DIR, 'temp');
const QUEUE_STORE_PATH = process.env.QUEUE_STORE_PATH || path.join(BASE_DATA_DIR, 'queue.json');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');

export class PrintQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.processing = false;
    this.currentJob = null;
    this.deviceClient = null;
    this.jobIndex = new Set();

    if (!existsSync(TEMP_FOLDER)) {
      mkdirSync(TEMP_FOLDER, { recursive: true });
    }
    const queueDir = path.dirname(QUEUE_STORE_PATH);
    if (!existsSync(queueDir)) {
      mkdirSync(queueDir, { recursive: true });
    }
  }

  async initialize() {
    await this.loadQueue();
    if (this.queue.length > 0) {
      console.log(`Loaded ${this.queue.length} jobs from local queue`);
      this.processQueue();
    }
  }

  setDeviceClient(deviceClient) {
    this.deviceClient = deviceClient;
  }

  async addJob(job) {
    if (!job?.jobId) {
      console.warn('Ignoring print job without jobId');
      return false;
    }

    if (this.jobIndex.has(job.jobId)) {
      console.log(`Duplicate job ${job.jobId} ignored`);
      return false;
    }

    const queueItem = {
      jobId: job.jobId,
      fileUrl: job.fileUrl,
      fileName: job.fileName,
      fileType: job.fileType,
      printerName: job.printerName || null,
      copies: job.copies || 1,
      pageRange: job.pageRange || null,
      status: 'queued',
      addedAt: new Date().toISOString(),
      retries: 0,
      error: null,
      localFilePath: null,
    };

    this.queue.push(queueItem);
    this.jobIndex.add(queueItem.jobId);
    await this.persistQueue();

    console.log(`Job ${job.jobId} added to queue (${this.queue.length} jobs)`);

    if (!this.processing) {
      this.processQueue();
    }

    return true;
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const nextIndex = this.queue.findIndex(j => j.status === 'queued');
        if (nextIndex === -1) break;

        const job = this.queue[nextIndex];
        this.currentJob = job;

        try {
          await this.processJob(job);
          this.queue.splice(nextIndex, 1);
          this.jobIndex.delete(job.jobId);
          await this.persistQueue();
        } catch (error) {
          console.error(`Error processing job ${job.jobId}:`, error.message);
          await this.persistQueue();

          // Keep failed job in queue for manual/automatic retry later.
          if (job.status === 'failed') {
            this.queue.splice(nextIndex, 1);
            this.queue.push(job);
          } else if (job.status === 'queued') {
            this.queue.splice(nextIndex, 1);
            this.queue.push(job);
          }
        } finally {
          this.currentJob = null;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async processJob(job) {
    console.log(`Processing job ${job.jobId}...`);
    job.status = 'printing';
    job.error = null;
    await this.persistQueue();

    this.emit('job-started', job.jobId);
    this.sendJobUpdate(job.jobId, 'printing');

    try {
      const filePath = await this.ensureLocalFile(job);
      await this.printFile(filePath, job);

      await this.cleanupFile(filePath);
      job.localFilePath = null;
      job.status = 'completed';

      console.log(`Job ${job.jobId} completed`);
      this.emit('job-completed', job.jobId);
      this.sendJobUpdate(job.jobId, 'completed');
    } catch (error) {
      job.retries += 1;
      job.error = error.message;

      if (job.retries <= MAX_RETRIES) {
        job.status = 'queued';
        console.warn(`Job ${job.jobId} failed, retry ${job.retries}/${MAX_RETRIES}: ${error.message}`);
        throw error;
      }

      // Keep file for reprint and preserve failed state in queue.
      job.status = 'failed';
      console.error(`Job ${job.jobId} failed permanently: ${error.message}`);
      this.emit('job-failed', job.jobId, error.message);
      this.sendJobUpdate(job.jobId, 'failed', error.message);
      throw error;
    }
  }

  async ensureLocalFile(job) {
    if (job.localFilePath && existsSync(job.localFilePath)) {
      return job.localFilePath;
    }

    const filePath = await this.downloadFile(job.fileUrl, job.fileName);
    job.localFilePath = filePath;
    await this.persistQueue();
    return filePath;
  }

  async downloadFile(url, fileName) {
    console.log(`Downloading file: ${fileName}`);

    const sanitizedName = this.sanitizeFileName(fileName);
    const filePath = path.join(TEMP_FOLDER, sanitizedName);
    const resolvedTemp = path.resolve(TEMP_FOLDER);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(resolvedTemp)) {
      throw new Error('Unsafe file path detected');
    }

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      await fs.writeFile(filePath, response.data);
      console.log(`File downloaded: ${filePath}`);
      return filePath;
    } catch (error) {
      throw new Error(`File download failed: ${error.message}`);
    }
  }

  async printFile(filePath, job) {
    const options = {
      printer: job.printerName || process.env.DEFAULT_PRINTER,
    };

    if (job.copies && job.copies > 1) options.copies = job.copies;
    if (job.pageRange) options.pages = job.pageRange;

    try {
      const printers = await ptp.getPrinters();
      if (printers.length === 0) throw new Error('No printers available');

      if (!options.printer) {
        const defaultPrinter = printers.find(p => p.default);
        options.printer = defaultPrinter ? defaultPrinter.name : printers[0].name;
      }

      console.log(`Printing ${job.jobId} to: ${options.printer}`);
      await ptp.print(filePath, options);
    } catch (error) {
      throw new Error(`Print failed: ${error.message}`);
    }
  }

  async cleanupFile(filePath) {
    try {
      await fs.unlink(filePath);
      console.log(`Deleted local file: ${filePath}`);
    } catch (error) {
      console.warn(`Could not delete local file: ${error.message}`);
    }
  }

  sanitizeFileName(fileName) {
    const basename = path.basename(fileName);
    const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    const ext = path.extname(sanitized);
    const name = path.basename(sanitized, ext);
    return `${name}_${timestamp}${ext}`;
  }

  sendJobUpdate(jobId, status, errorMessage = null) {
    if (!this.deviceClient) return;
    this.deviceClient.sendJobUpdate(jobId, status, errorMessage);
  }

  async persistQueue() {
    const data = {
      updatedAt: new Date().toISOString(),
      queue: this.queue.map(job => ({
        jobId: job.jobId,
        fileUrl: job.fileUrl,
        fileName: job.fileName,
        fileType: job.fileType,
        printerName: job.printerName,
        copies: job.copies,
        pageRange: job.pageRange,
        status: job.status,
        addedAt: job.addedAt,
        retries: job.retries,
        error: job.error,
        localFilePath: job.localFilePath,
      })),
    };

    await fs.writeFile(QUEUE_STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  async loadQueue() {
    try {
      if (!existsSync(QUEUE_STORE_PATH)) return;
      const raw = await fs.readFile(QUEUE_STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw);

      this.queue = (parsed.queue || []).map(job => ({
        ...job,
        status: job.status === 'completed' ? 'queued' : job.status,
      }));
      this.jobIndex = new Set(this.queue.map(job => job.jobId));
    } catch (error) {
      console.error(`Failed to load queue store ${QUEUE_STORE_PATH}:`, error.message);
      this.queue = [];
      this.jobIndex = new Set();
    }
  }

  getJobs() {
    return this.queue.map(job => ({
      jobId: job.jobId,
      fileName: job.fileName,
      status: job.status,
      addedAt: job.addedAt,
      copies: job.copies,
      printerName: job.printerName,
      retries: job.retries,
      error: job.error,
    }));
  }

  getQueueLength() {
    return this.queue.filter(j => j.status === 'queued' || j.status === 'printing').length;
  }
}

export default PrintQueue;
