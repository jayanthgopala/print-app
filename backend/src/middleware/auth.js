import { sign, verify } from 'hono/jwt';
import {
  getDeviceByToken,
  getShopByCode,
  updateShopSubscription,
} from '../db/sqlite.js';

function getJwtSecret(env = {}) {
  const processSecret = typeof process !== 'undefined' ? process.env.JWT_SECRET : undefined;
  const secret = env.JWT_SECRET || processSecret;

  if (!secret || secret.length < 32) {
    console.warn('WARNING: JWT_SECRET is not set or too short. Use a strong secret in production.');
  }

  return secret;
}

export async function generateToken(shopCode, env = {}, expiresIn = 60 * 60 * 24 * 7) {
  return sign(
    {
      shopCode,
      type: 'shop',
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    },
    getJwtSecret(env)
  );
}

export async function generateDeviceToken(deviceId, shopCode, env = {}, expiresIn = 60 * 60 * 24 * 365) {
  return sign(
    {
      deviceId,
      shopCode,
      type: 'device',
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    },
    getJwtSecret(env)
  );
}

export async function authMiddleware(c, next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: No token provided' }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const decoded = await verify(token, getJwtSecret(c.env));

    if (decoded.type !== 'shop') {
      return c.json({ error: 'Unauthorized: Invalid token type' }, 401);
    }

    const shop = await getShopByCode(c.env, decoded.shopCode);

    if (!shop) {
      return c.json({ error: 'Unauthorized: Shop not found' }, 401);
    }

    if (shop.subscription_status !== 'active') {
      return c.json({ error: 'Subscription inactive or expired' }, 403);
    }

    if (shop.subscription_expiry && new Date(shop.subscription_expiry) < new Date()) {
      await updateShopSubscription(c.env, 'expired', null, shop.shop_code);
      return c.json({ error: 'Subscription expired' }, 403);
    }

    c.set('shop', shop);
    c.set('shopCode', shop.shop_code);

    await next();
  } catch (error) {
    if (error?.name === 'JwtTokenExpired') {
      return c.json({ error: 'Unauthorized: Token expired' }, 401);
    }

    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }
}

export async function verifyDeviceToken(token, env = {}) {
  try {
    const decoded = await verify(token, getJwtSecret(env));

    if (decoded.type !== 'device') {
      return null;
    }

    const device = await getDeviceByToken(env, token);

    if (!device) {
      return null;
    }

    return {
      deviceId: decoded.deviceId,
      shopCode: decoded.shopCode,
      device,
    };
  } catch {
    return null;
  }
}

export default {
  generateToken,
  generateDeviceToken,
  authMiddleware,
  verifyDeviceToken,
};
