import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { authMiddleware } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validation.js';
import { printJobRateLimiter } from '../middleware/rateLimiter.js';
import { getDevicesByShopCode } from '../db/sqlite.js';
import { sendJobToDevice, getOnlineDevicesForShop } from '../websocket/deviceManager.js';
import {
  createJobRecord,
  getJobRecord,
  getJobsByShop,
  updateJobStatus,
  cancelJob,
} from '../store/jobStore.js';

const jobs = new Hono();

jobs.use('*', authMiddleware);

jobs.post('/', printJobRateLimiter(), validateBody(schemas.printJob), async (c) => {
  const shopCode = c.get('shopCode');
  const jobData = c.get('validatedBody');

  try {
    const liveConnections = getOnlineDevicesForShop(shopCode).filter((device) => device.isOnline);
    const liveDeviceIds = new Set(liveConnections.map((device) => device.deviceId));
    const devices = await getDevicesByShopCode(c.env, shopCode);
    const onlineDevices = devices.filter(
      (device) => device.status === 'online' && liveDeviceIds.has(device.device_id)
    );

    if (onlineDevices.length === 0) {
      return c.json(
        {
          error: 'No online devices available',
          message: c.env?.DB
            ? 'Worker mode serves the API, but the stateful device relay still needs a Node process or Durable Object.'
            : 'Please ensure your PC application is running and connected',
        },
        503
      );
    }

    const jobId = nanoid();
    createJobRecord({
      jobId,
      shopCode,
      deviceId: onlineDevices[0].device_id,
      fileUrl: jobData.fileUrl,
      fileName: jobData.fileName,
      fileSize: jobData.fileSize,
      fileType: jobData.fileType,
      printerName: jobData.printerName || null,
      copies: jobData.copies || 1,
      pageRange: jobData.pageRange || null,
      status: 'pending',
    });

    const sent = await sendJobToDevice(onlineDevices[0].device_id, {
      jobId,
      fileUrl: jobData.fileUrl,
      fileName: jobData.fileName,
      fileType: jobData.fileType,
      printerName: jobData.printerName,
      copies: jobData.copies || 1,
      pageRange: jobData.pageRange,
    });

    if (!sent) {
      updateJobStatus(jobId, 'failed', 'Device did not acknowledge print job in time');
      return c.json(
        {
          error: 'Device did not acknowledge print job',
          message: 'The shop appears online but did not confirm receipt. Try again.',
          jobId,
        },
        504
      );
    }

    return c.json(
      {
        success: true,
        jobId,
        status: 'queued',
        deviceId: onlineDevices[0].device_id,
      },
      201
    );
  } catch (error) {
    console.error('Error creating print job:', error);
    return c.json({ error: 'Failed to create print job' }, 500);
  }
});

jobs.get('/:jobId', async (c) => {
  const shopCode = c.get('shopCode');
  const jobId = c.req.param('jobId');

  try {
    const job = getJobRecord(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    if (job.shopCode !== shopCode) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    return c.json({
      jobId: job.jobId,
      status: job.status,
      fileName: job.fileName,
      copies: job.copies,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorMessage: job.errorMessage,
    });
  } catch (error) {
    console.error('Error fetching job:', error);
    return c.json({ error: 'Failed to fetch job' }, 500);
  }
});

jobs.get('/', async (c) => {
  const shopCode = c.get('shopCode');
  const limit = parseInt(c.req.query('limit') || '50');

  try {
    const jobsList = getJobsByShop(shopCode, limit);

    return c.json({
      jobs: jobsList.map((job) => ({
        jobId: job.jobId,
        status: job.status,
        fileName: job.fileName,
        copies: job.copies,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return c.json({ error: 'Failed to fetch jobs' }, 500);
  }
});

jobs.delete('/:jobId', async (c) => {
  const shopCode = c.get('shopCode');
  const jobId = c.req.param('jobId');

  try {
    const job = getJobRecord(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    if (job.shopCode !== shopCode) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    if (job.status === 'completed' || job.status === 'printing') {
      return c.json({ error: 'Cannot cancel job in current state' }, 400);
    }

    cancelJob(jobId);

    return c.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    console.error('Error cancelling job:', error);
    return c.json({ error: 'Failed to cancel job' }, 500);
  }
});

export default jobs;
