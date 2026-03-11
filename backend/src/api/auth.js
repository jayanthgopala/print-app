import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { verify } from 'hono/jwt';
import {
  createShop,
  getShopByCode,
  updateShopSubscription,
} from '../db/sqlite.js';
import { generateToken } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validation.js';
import { loginRateLimiter } from '../middleware/rateLimiter.js';

const auth = new Hono();
const processJwtSecret = typeof process !== 'undefined' ? process.env.JWT_SECRET : undefined;

auth.post('/login', loginRateLimiter(), validateBody(schemas.login), async (c) => {
  const { shopCode, password } = c.get('validatedBody');

  try {
    const shop = await getShopByCode(c.env, shopCode);

    if (!shop) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const isValid = await bcrypt.compare(password, shop.password_hash);

    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    if (shop.subscription_status !== 'active') {
      return c.json({ error: 'Subscription is not active' }, 403);
    }

    if (shop.subscription_expiry && new Date(shop.subscription_expiry) < new Date()) {
      await updateShopSubscription(c.env, 'expired', null, shopCode);
      return c.json({ error: 'Subscription has expired' }, 403);
    }

    const token = await generateToken(shopCode, c.env);

    return c.json({
      success: true,
      token,
      shop: {
        shopCode: shop.shop_code,
        name: shop.name,
        subscriptionStatus: shop.subscription_status,
        subscriptionExpiry: shop.subscription_expiry,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

auth.post('/register', validateBody(schemas.createShop), async (c) => {
  const { shopCode, password, name, email } = c.get('validatedBody');

  try {
    const existing = await getShopByCode(c.env, shopCode);
    if (existing) {
      return c.json({ error: 'Shop code already exists' }, 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await createShop(c.env, shopCode, passwordHash, name, email || null);

    return c.json(
      {
        success: true,
        message: 'Shop created successfully',
        shopCode,
      },
      201
    );
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

auth.get('/verify', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ valid: false }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const decoded = await verify(token, c.env?.JWT_SECRET || processJwtSecret);
    const shop = await getShopByCode(c.env, decoded.shopCode);

    if (!shop || shop.subscription_status !== 'active') {
      return c.json({ valid: false }, 401);
    }

    return c.json({
      valid: true,
      shopCode: shop.shop_code,
      name: shop.name,
    });
  } catch {
    return c.json({ valid: false }, 401);
  }
});

export default auth;
