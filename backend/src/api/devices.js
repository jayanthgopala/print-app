import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { deleteDevice, getDevicesByShopCode } from '../db/sqlite.js';

const devices = new Hono();

devices.use('*', authMiddleware);

devices.get('/', async (c) => {
  const shopCode = c.get('shopCode');

  try {
    const deviceList = await getDevicesByShopCode(c.env, shopCode);

    return c.json({
      devices: deviceList.map((device) => ({
        deviceId: device.device_id,
        pcName: device.pc_name,
        status: device.status,
        lastSeen: device.last_seen,
      })),
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
    return c.json({ error: 'Failed to fetch devices' }, 500);
  }
});

devices.get('/:deviceId', async (c) => {
  const shopCode = c.get('shopCode');
  const deviceId = c.req.param('deviceId');

  try {
    const device = (await getDevicesByShopCode(c.env, shopCode)).find((item) => item.device_id === deviceId);

    if (!device) {
      return c.json({ error: 'Device not found' }, 404);
    }

    return c.json({
      deviceId: device.device_id,
      pcName: device.pc_name,
      status: device.status,
      lastSeen: device.last_seen,
      createdAt: device.created_at,
    });
  } catch (error) {
    console.error('Error fetching device:', error);
    return c.json({ error: 'Failed to fetch device' }, 500);
  }
});

devices.delete('/:deviceId', async (c) => {
  const shopCode = c.get('shopCode');
  const deviceId = c.req.param('deviceId');

  try {
    const device = (await getDevicesByShopCode(c.env, shopCode)).find((item) => item.device_id === deviceId);

    if (!device) {
      return c.json({ error: 'Device not found' }, 404);
    }

    await deleteDevice(c.env, deviceId);

    return c.json({ success: true, message: 'Device removed' });
  } catch (error) {
    console.error('Error deleting device:', error);
    return c.json({ error: 'Failed to delete device' }, 500);
  }
});

export default devices;
