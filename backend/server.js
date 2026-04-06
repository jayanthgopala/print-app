import { AwsClient } from 'aws4fetch';
import pg from 'pg';

const { Client } = pg;

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const JOB_FETCH_LIMIT = 20;
const MAX_RETRIES = 5;
const STUCK_JOB_TIMEOUT_MINUTES = 15;
const UPLOAD_TICKET_TTL_SECONDS = 10 * 60;
const PUBLIC_SHOP_CACHE_TTL_SECONDS = 30;
const ALLOWED_FILE_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
]);
const RATE_LIMITS = {
    '/upload-url': { limit: 30, windowSeconds: 60 },
    '/job/create': { limit: 60, windowSeconds: 60 },
    '/jobs': { limit: 120, windowSeconds: 60 }
};

export default {
    async fetch(request, env, ctx) {
        const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
        const url = new URL(request.url);
        const baseLog = { request_id: requestId, method: request.method, path: url.pathname };

        try {
            if (request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
            }

            if (request.method === 'GET' && url.pathname === '/') {
                return json({ message: 'Print control plane', request_id: requestId }, 200, request, env);
            }

            if (request.method === 'GET' && url.pathname === '/health') {
                return json({ status: 'ok', request_id: requestId }, 200, request, env);
            }

            if (request.method === 'GET' && matchPath(url.pathname, '/shop/public/:shopCode')) {
                const { shopCode } = matchPath(url.pathname, '/shop/public/:shopCode');
                return await withRequestLogging(request, env, ctx, baseLog, () => handlePublicShopLookup(shopCode, request, env, ctx, requestId));
            }

            if (request.method === 'POST' && (url.pathname === '/auth/login' || url.pathname === '/auth/shop-token')) {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleShopToken(request, env, requestId));
            }

            if (request.method === 'POST' && url.pathname === '/admin/login') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleAdminLogin(request, env, requestId));
            }

            if (request.method === 'POST' && url.pathname === '/admin/create-shop') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleCreateShop(request, env, requestId));
            }

            if (request.method === 'GET' && url.pathname === '/admin/shops') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleListShops(request, env, requestId));
            }

            if (request.method === 'GET' && url.pathname === '/admin/jobs/failed') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleListFailedJobs(request, env, requestId));
            }

            if (request.method === 'POST' && url.pathname === '/admin/job/retry') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleRetryFailedJob(request, env, requestId));
            }

            if (request.method === 'DELETE' && matchPath(url.pathname, '/admin/shop/:shopCode')) {
                const { shopCode } = matchPath(url.pathname, '/admin/shop/:shopCode');
                return await withRequestLogging(request, env, ctx, baseLog, () => handleDeleteShop(shopCode, request, env, requestId));
            }

            if (request.method === 'PATCH' && matchPath(url.pathname, '/admin/shop/:shopCode')) {
                const { shopCode } = matchPath(url.pathname, '/admin/shop/:shopCode');
                return await withRequestLogging(request, env, ctx, baseLog, () => handlePatchShop(shopCode, request, env, requestId));
            }

            if (request.method === 'POST' && url.pathname === '/upload-url') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleUploadUrl(request, env, ctx, requestId));
            }

            if (request.method === 'POST' && url.pathname === '/job/create') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleCreateJob(request, env, ctx, requestId));
            }

            if (request.method === 'GET' && matchPath(url.pathname, '/jobs/:shopCode')) {
                const { shopCode } = matchPath(url.pathname, '/jobs/:shopCode');
                return await withRequestLogging(request, env, ctx, baseLog, () => handleClaimJobs(shopCode, request, env, ctx, requestId));
            }

            if (request.method === 'POST' && url.pathname === '/job/update-status') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleUpdateJobStatus(request, env, ctx, requestId));
            }

            if (request.method === 'POST' && url.pathname === '/job/complete') {
                return await withRequestLogging(request, env, ctx, baseLog, () => handleCompleteJob(request, env, ctx, requestId));
            }

            return json({ error: 'Not found', request_id: requestId }, 404, request, env);
        } catch (error) {
            const status = error instanceof HttpError ? error.status : 500;
            logEvent(status >= 500 ? 'error' : 'warn', 'request_failed', { ...baseLog, error: sanitizeError(error) });
            return json({ error: error instanceof HttpError ? error.message : 'Internal server error', request_id: requestId }, status, request, env);
        }
    }
};

async function withRequestLogging(request, env, ctx, baseLog, handler) {
    const startedAt = Date.now();
    const response = await handler();
    logEvent('info', 'request_complete', { ...baseLog, status: response.status, duration_ms: Date.now() - startedAt });
    if (shouldRunCleanup()) ctx.waitUntil(cleanupRateLimits(env, baseLog.request_id));
    return response;
}

async function handlePublicShopLookup(shopCode, request, env, ctx, requestId) {
    const normalizedShopCode = requireShopCode(shopCode);
    const cache = caches.default;
    const cacheKey = new Request(new URL(`/shop/public/${normalizedShopCode}`, request.url).toString(), { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) return withResponseHeader(cached, 'x-request-id', requestId);

    const db = await createDbClient(env);
    try {
        const shop = await getShopByCode(db, normalizedShopCode);
        if (!shop) return json({ error: 'Shop not found', request_id: requestId }, 404, request, env);
        if (isExpired(shop.subscription_end)) return json({ error: 'Subscription expired', request_id: requestId }, 403, request, env);

        const response = json({
            request_id: requestId,
            shop: {
                code: shop.shop_code,
                name: shop.shop_name,
                status: 'online',
                colorPrice: shop.color_price,
                bwPrice: shop.bw_price
            }
        }, 200, request, env, { 'Cache-Control': `public, max-age=${PUBLIC_SHOP_CACHE_TTL_SECONDS}` });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
    } finally {
        await db.end();
    }
}

async function handleShopToken(request, env, requestId) {
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;

    const shopCode = requireShopCode(body.data.shopCode);
    const password = requireString(body.data.password, 'password', { min: 1, max: 200 });
    const db = await createDbClient(env);
    try {
        const shop = await getShopByCode(db, shopCode);
        if (!shop || !(await comparePassword(password, shop.password_hash))) {
            return json({ error: 'Invalid credentials', request_id: requestId }, 401, request, env);
        }
        if (isExpired(shop.subscription_end)) {
            return json({ error: 'Subscription expired', request_id: requestId }, 403, request, env);
        }

        const token = await signJwt({
            type: 'SHOP',
            shopId: shop.id,
            shopCode: shop.shop_code,
            exp: unixTime() + (30 * 24 * 60 * 60)
        }, env.JWT_SECRET);

        return json({
            request_id: requestId,
            token,
            shop: {
                code: shop.shop_code,
                name: shop.shop_name,
                colorPrice: shop.color_price,
                bwPrice: shop.bw_price,
                subscriptionEnd: shop.subscription_end
            }
        }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleAdminLogin(request, env, requestId) {
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;
    const username = requireString(body.data.username, 'username', { min: 1, max: 100 });
    const password = requireString(body.data.password, 'password', { min: 1, max: 200 });

    const db = await createDbClient(env);
    try {
        const result = await db.query('SELECT id, username, password_hash FROM admins WHERE username = $1 LIMIT 1', [username]);
        const admin = result.rows[0];
        if (!admin || !(await comparePassword(password, admin.password_hash))) {
            return json({ error: 'Invalid credentials', request_id: requestId }, 401, request, env);
        }

        const token = await signJwt({
            isAdmin: true,
            adminId: admin.id,
            username: admin.username,
            exp: unixTime() + (12 * 60 * 60)
        }, env.JWT_SECRET);

        return json({ request_id: requestId, token, admin: { id: admin.id, username: admin.username } }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleCreateShop(request, env, requestId) {
    const auth = await requireAdminAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;

    const shopCode = requireShopCode(body.data.shopCode);
    const shopName = requireString(body.data.shopName || shopCode, 'shopName', { min: 1, max: 120 });
    const password = requireString(body.data.password, 'password', { min: 8, max: 200 });
    const colorPrice = optionalNumber(body.data.colorPrice);
    const bwPrice = optionalNumber(body.data.bwPrice);
    const subscriptionEnd = resolveSubscriptionEnd(body.data.subscriptionEnd, body.data.subscriptionDays);

    const db = await createDbClient(env);
    try {
        await db.query(
            `INSERT INTO shops (id, shop_code, shop_name, password_hash, color_price, bw_price, subscription_end)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [crypto.randomUUID(), shopCode, shopName, await hashPassword(password), colorPrice, bwPrice, subscriptionEnd]
        );
        const created = await getShopByCode(db, shopCode);
        return json({ request_id: requestId, success: true, shop: created }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleListShops(request, env, requestId) {
    const auth = await requireAdminAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const db = await createDbClient(env);
    try {
        const result = await db.query(
            `SELECT shop_code, shop_name, color_price, bw_price, subscription_end, created_at
             FROM shops
             ORDER BY shop_code ASC`
        );
        return json({ request_id: requestId, shops: result.rows }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleListFailedJobs(request, env, requestId) {
    const auth = await requireAdminAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const db = await createDbClient(env);
    try {
        const result = await db.query(
            `SELECT id, shop_code, file_name, retry_count, last_error, updated_at
             FROM jobs
             WHERE status = 'failed'
             ORDER BY updated_at DESC
             LIMIT 50`
        );
        return json({ request_id: requestId, jobs: result.rows }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleRetryFailedJob(request, env, requestId) {
    const auth = await requireAdminAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;
    const jobId = requireUuid(body.data.jobId, 'jobId');

    const db = await createDbClient(env);
    try {
        const result = await db.query(
            `UPDATE jobs
             SET status = 'pending',
                 retry_count = 0,
                 last_attempt_at = NULL,
                 last_error = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND status = 'failed'
             RETURNING id, status`,
            [jobId]
        );
        if (!result.rows[0]) return json({ error: 'Failed job not found', request_id: requestId }, 404, request, env);
        return json({ request_id: requestId, success: true, job: result.rows[0] }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleDeleteShop(shopCode, request, env, requestId) {
    const auth = await requireAdminAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const db = await createDbClient(env);
    try {
        await db.query('DELETE FROM shops WHERE shop_code = $1', [requireShopCode(shopCode)]);
        return json({ request_id: requestId, success: true }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handlePatchShop(shopCode, request, env, requestId) {
    const auth = await requireAdminAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const normalizedShopCode = requireShopCode(shopCode);
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;

    const clauses = [];
    const params = [];
    let index = 1;
    if (body.data.shopName !== undefined) {
        clauses.push(`shop_name = $${index++}`);
        params.push(requireString(body.data.shopName, 'shopName', { min: 1, max: 120 }));
    }
    if (body.data.colorPrice !== undefined) {
        clauses.push(`color_price = $${index++}`);
        params.push(optionalNumber(body.data.colorPrice));
    }
    if (body.data.bwPrice !== undefined) {
        clauses.push(`bw_price = $${index++}`);
        params.push(optionalNumber(body.data.bwPrice));
    }
    if (body.data.password) {
        clauses.push(`password_hash = $${index++}`);
        params.push(await hashPassword(requireString(body.data.password, 'password', { min: 8, max: 200 })));
    }
    if (body.data.subscriptionEnd !== undefined || body.data.subscriptionDays !== undefined) {
        clauses.push(`subscription_end = $${index++}`);
        params.push(resolveSubscriptionEnd(body.data.subscriptionEnd, body.data.subscriptionDays));
    }
    if (!clauses.length) return json({ error: 'No fields to update', request_id: requestId }, 400, request, env);

    params.push(normalizedShopCode);
    const db = await createDbClient(env);
    try {
        await db.query(`UPDATE shops SET ${clauses.join(', ')}, updated_at = NOW() WHERE shop_code = $${index}`, params);
        return json({ request_id: requestId, success: true }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleUploadUrl(request, env, ctx, requestId) {
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;

    const shopCode = requireShopCode(body.data.shopCode);
    const fileName = requireFileName(body.data.fileName);
    const contentType = requireContentType(body.data.contentType);
    const fileSize = requireFileSize(body.data.fileSize);

    const db = await createDbClient(env);
    try {
        await enforceRateLimit(db, request, '/upload-url', `${shopCode}:${clientAddress(request)}`, requestId);
        const shop = await getShopByCode(db, shopCode);
        if (!shop) return json({ error: 'Shop not found', request_id: requestId }, 404, request, env);
        if (isExpired(shop.subscription_end)) return json({ error: 'Subscription expired', request_id: requestId }, 403, request, env);

        const objectKey = buildObjectKey(shopCode, fileName);
        const fileUrl = buildR2ObjectUrl(env, objectKey);
        const signedRequest = await awsClient(env).sign(
            new Request(fileUrl, { method: 'PUT', headers: { 'Content-Type': contentType } }),
            { aws: { signQuery: true } }
        );
        const uploadTicket = await signJwt({
            type: 'UPLOAD_TICKET',
            shopCode,
            fileName,
            contentType,
            fileSize,
            objectKey,
            fileUrl,
            exp: unixTime() + UPLOAD_TICKET_TTL_SECONDS
        }, env.JWT_SECRET);

        return json({
            request_id: requestId,
            uploadUrl: signedRequest.url,
            fileUrl,
            objectKey,
            uploadTicket,
            expiresIn: UPLOAD_TICKET_TTL_SECONDS
        }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleCreateJob(request, env, ctx, requestId) {
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;
    const payload = validateCreateJobPayload(body.data);
    const verifiedTicket = await verifyUploadTicket(payload.uploadTicket, env);
    if (!verifiedTicket.ok) return json({ error: verifiedTicket.error, request_id: requestId }, 403, request, env);
    if (!doesTicketMatchPayload(verifiedTicket.ticket, payload)) {
        return json({ error: 'Upload ticket does not match request payload', request_id: requestId }, 403, request, env);
    }

    const db = await createDbClient(env);
    try {
        await enforceRateLimit(db, request, '/job/create', `${payload.shopCode}:${clientAddress(request)}`, requestId);
        const shop = await getShopByCode(db, payload.shopCode);
        if (!shop) return json({ error: 'Shop not found', request_id: requestId }, 404, request, env);
        if (isExpired(shop.subscription_end)) return json({ error: 'Subscription expired', request_id: requestId }, 403, request, env);

        const objectInfo = await env.FILES_BUCKET?.head(payload.objectKey);
        if (!objectInfo) return json({ error: 'Uploaded file not found in R2', request_id: requestId }, 400, request, env);
        const r2ContentType = requireContentType(objectInfo.httpMetadata?.contentType || payload.contentType);
        if (r2ContentType !== verifiedTicket.ticket.contentType) return json({ error: 'Uploaded file content type mismatch', request_id: requestId }, 400, request, env);
        if (Number(objectInfo.size || 0) !== verifiedTicket.ticket.fileSize) return json({ error: 'Uploaded file size mismatch', request_id: requestId }, 400, request, env);

        const result = await retryWithBackoff(() => db.query(
            `INSERT INTO jobs (
                id, shop_code, file_url, object_key, file_name, content_type, copies, color_mode, status,
                color_pages, bw_pages, paper_size, orientation, duplex, scale, retry_count, last_attempt_at, last_error
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, 'pending',
                $9, $10, $11, $12, $13, $14, 0, NULL, NULL
            )
            ON CONFLICT (object_key) DO UPDATE SET object_key = jobs.object_key
            RETURNING id, shop_code, file_url, file_name, copies, color_mode, status, created_at, retry_count, last_attempt_at`,
            [
                crypto.randomUUID(),
                payload.shopCode,
                payload.fileUrl,
                payload.objectKey,
                payload.fileName,
                r2ContentType,
                payload.copies,
                payload.colorMode,
                payload.colorPages,
                payload.bwPages,
                payload.paperSize,
                payload.orientation,
                payload.duplex,
                payload.scale
            ]
        ));

        return json({ request_id: requestId, success: true, job: result.rows[0] }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleClaimJobs(shopCode, request, env, ctx, requestId) {
    const auth = await requireShopAuth(request, env, requestId, shopCode);
    if (auth.errorResponse) return auth.errorResponse;
    const db = await createDbClient(env);
    try {
        await enforceRateLimit(db, request, '/jobs', auth.shopCode, requestId);
        const jobs = await retryWithBackoff(() => claimPendingJobs(db, auth.shopCode, requestId, auth.shopCode, env));
        return json({ request_id: requestId, jobs, limit: JOB_FETCH_LIMIT }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleUpdateJobStatus(request, env, ctx, requestId) {
    const auth = await requireShopAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;
    const jobId = requireUuid(body.data.jobId, 'jobId');
    const nextStatus = requireJobStatus(body.data.status, false);
    const errorText = optionalString(body.data.error, { max: 500 });

    const db = await createDbClient(env);
    try {
        const result = await retryWithBackoff(() => transitionJobStatus(db, {
            jobId,
            shopCode: auth.shopCode,
            nextStatus,
            requestId,
            userId: auth.shopCode,
            errorText
        }));
        if (!result.found) return json({ error: 'Job not found', request_id: requestId }, 404, request, env);
        if (result.invalidTransition) return json({ error: 'Invalid status transition', request_id: requestId }, 400, request, env);
        return json({ request_id: requestId, success: true, job: result.job }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function handleCompleteJob(request, env, ctx, requestId) {
    const auth = await requireShopAuth(request, env, requestId);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await readJson(request, env, requestId);
    if (body.errorResponse) return body.errorResponse;
    const jobId = requireUuid(body.data.jobId, 'jobId');

    const db = await createDbClient(env);
    try {
        const lookup = await retryWithBackoff(() => db.query(
            `SELECT id, object_key, status
             FROM jobs
             WHERE id = $1 AND shop_code = $2
             LIMIT 1`,
            [jobId, auth.shopCode]
        ));
        const job = lookup.rows[0];
        if (!job) return json({ request_id: requestId, success: true, alreadyCompleted: true }, 200, request, env);
        if (!['printing', 'completed'].includes(String(job.status || '').toLowerCase())) {
            return json({ error: 'Job must be printing before completion', request_id: requestId }, 400, request, env);
        }

        await retryWithBackoff(() => env.FILES_BUCKET.delete(job.object_key));
        await retryWithBackoff(() => db.query('DELETE FROM jobs WHERE id = $1 AND shop_code = $2', [jobId, auth.shopCode]));
        logEvent('info', 'job_completed', { request_id: requestId, job_id: jobId, user_id: auth.shopCode });
        return json({ request_id: requestId, success: true }, 200, request, env);
    } finally {
        await db.end();
    }
}

async function claimPendingJobs(db, shopCode, requestId, userId, env) {
    await db.query('BEGIN');
    try {
        const stale = await db.query(
            `UPDATE jobs
             SET status = CASE WHEN retry_count + 1 >= $2 THEN 'failed' ELSE 'pending' END,
                 retry_count = retry_count + 1,
                 last_attempt_at = NOW(),
                 last_error = 'job_timeout',
                 updated_at = NOW()
             WHERE shop_code = $1
               AND status = 'printing'
               AND last_attempt_at IS NOT NULL
               AND last_attempt_at < NOW() - INTERVAL '${STUCK_JOB_TIMEOUT_MINUTES} minutes'
             RETURNING id, status, retry_count`,
            [shopCode, MAX_RETRIES]
        );

        for (const row of stale.rows) {
            await recordFailure(db, {
                requestId,
                jobId: row.id,
                userId,
                error: row.status === 'failed' ? 'job_timeout_dead_lettered' : 'job_timeout_reset'
            });
        }

        const claimed = await db.query(
            `WITH candidates AS (
                SELECT id
                FROM jobs
                WHERE shop_code = $1 AND status = 'pending'
                ORDER BY created_at ASC
                LIMIT $2
                FOR UPDATE SKIP LOCKED
             )
             UPDATE jobs AS job
             SET status = 'printing',
                 last_attempt_at = NOW(),
                 updated_at = NOW()
             FROM candidates
             WHERE job.id = candidates.id
             RETURNING
                 job.id,
                 job.shop_code,
                 job.file_url,
                 job.object_key,
                 job.file_name,
                 job.content_type,
                 job.copies,
                 job.color_mode,
                 job.status,
                 job.created_at,
                 job.color_pages,
                 job.bw_pages,
                 job.paper_size,
                 job.orientation,
                 job.duplex,
                 job.scale,
                 job.retry_count,
                 job.last_attempt_at`,
            [shopCode, JOB_FETCH_LIMIT]
        );

        await db.query('COMMIT');
        return await Promise.all(claimed.rows.map(async (job) => ({
            ...job,
            download_url: await createSignedDownloadUrl(job.object_key, env)
        })));
    } catch (error) {
        await db.query('ROLLBACK');
        throw error;
    }
}

async function transitionJobStatus(db, { jobId, shopCode, nextStatus, requestId, userId, errorText }) {
    await db.query('BEGIN');
    try {
        const currentResult = await db.query(
            `SELECT id, status, retry_count
             FROM jobs
             WHERE id = $1 AND shop_code = $2
             FOR UPDATE`,
            [jobId, shopCode]
        );
        const current = currentResult.rows[0];
        if (!current) {
            await db.query('ROLLBACK');
            return { found: false };
        }

        const currentStatus = String(current.status || '').toLowerCase();
        let finalStatus = nextStatus;
        let retryCount = Number(current.retry_count || 0);
        let lastError = null;

        if (nextStatus === 'pending') {
            retryCount += 1;
            lastError = errorText || 'job_processing_failed';
            finalStatus = retryCount >= MAX_RETRIES ? 'failed' : 'pending';
        } else if (!isAllowedTransition(currentStatus, nextStatus)) {
            await db.query('ROLLBACK');
            return { found: true, invalidTransition: true, job: { id: current.id, status: currentStatus } };
        }

        const updated = await db.query(
            `UPDATE jobs
             SET status = $1,
                 retry_count = $2,
                 last_attempt_at = NOW(),
                 last_error = $3,
                 updated_at = NOW()
             WHERE id = $4 AND shop_code = $5
             RETURNING id, status, retry_count, last_attempt_at`,
            [finalStatus, retryCount, lastError, jobId, shopCode]
        );

        if (finalStatus === 'failed' || lastError) {
            await recordFailure(db, {
                requestId,
                jobId,
                userId,
                error: lastError || 'job_dead_lettered'
            });
        }

        await db.query('COMMIT');
        return { found: true, invalidTransition: false, job: updated.rows[0] };
    } catch (error) {
        await db.query('ROLLBACK');
        throw error;
    }
}

async function recordFailure(db, { requestId, jobId, userId, error }) {
    logEvent('error', 'job_failure', { request_id: requestId, job_id: jobId, user_id: userId, error });
    await db.query(
        `INSERT INTO job_failures (id, job_id, user_id, error_message, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [crypto.randomUUID(), jobId, userId || null, error]
    );
}

async function enforceRateLimit(db, request, routeKey, subjectKey, requestId) {
    const config = RATE_LIMITS[routeKey];
    if (!config) return;
    const bucket = currentRateBucket(config.windowSeconds);
    const rateKey = `${routeKey}:${subjectKey}:${bucket}`;
    const result = await db.query(
        `INSERT INTO request_rate_limits (rate_key, window_start, request_count, updated_at)
         VALUES ($1, TO_TIMESTAMP($2), 1, NOW())
         ON CONFLICT (rate_key)
         DO UPDATE SET request_count = request_rate_limits.request_count + 1, updated_at = NOW()
         RETURNING request_count`,
        [rateKey, bucket]
    );
    if (Number(result.rows[0]?.request_count || 0) > config.limit) {
        logEvent('warn', 'rate_limited', { request_id: requestId, route: routeKey, subject: subjectKey, ip: clientAddress(request) });
        throw new HttpError(429, 'Rate limit exceeded');
    }
}

async function cleanupRateLimits(env, requestId) {
    const db = await createDbClient(env);
    try {
        await db.query(`DELETE FROM request_rate_limits WHERE updated_at < NOW() - INTERVAL '1 day'`);
    } catch (error) {
        logEvent('warn', 'rate_limit_cleanup_failed', { request_id: requestId, error: sanitizeError(error) });
    } finally {
        await db.end();
    }
}

async function requireAdminAuth(request, env, requestId) {
    const token = getBearerToken(request);
    if (!token) return { errorResponse: json({ error: 'Unauthorized', request_id: requestId }, 401, request, env) };
    try {
        const decoded = await verifyJwt(token, env.JWT_SECRET);
        if (!decoded?.isAdmin) return { errorResponse: json({ error: 'Forbidden', request_id: requestId }, 403, request, env) };
        return decoded;
    } catch {
        return { errorResponse: json({ error: 'Invalid token', request_id: requestId }, 401, request, env) };
    }
}

async function requireShopAuth(request, env, requestId, expectedShopCode) {
    const token = getBearerToken(request);
    if (!token) return { errorResponse: json({ error: 'Unauthorized', request_id: requestId }, 401, request, env) };
    try {
        const decoded = await verifyJwt(token, env.JWT_SECRET);
        if (decoded?.type !== 'SHOP' || !decoded.shopCode) {
            return { errorResponse: json({ error: 'Shop token required', request_id: requestId }, 403, request, env) };
        }
        const shopCode = requireShopCode(decoded.shopCode);
        if (expectedShopCode && shopCode !== requireShopCode(expectedShopCode)) {
            return { errorResponse: json({ error: 'Shop mismatch', request_id: requestId }, 403, request, env) };
        }
        return { shopId: decoded.shopId, shopCode };
    } catch {
        return { errorResponse: json({ error: 'Invalid token', request_id: requestId }, 401, request, env) };
    }
}

async function verifyUploadTicket(token, env) {
    try {
        const decoded = await verifyJwt(token, env.JWT_SECRET);
        if (decoded?.type !== 'UPLOAD_TICKET') return { ok: false, error: 'Invalid upload ticket' };
        return { ok: true, ticket: decoded };
    } catch {
        return { ok: false, error: 'Upload ticket expired or invalid' };
    }
}

function validateCreateJobPayload(data) {
    return {
        shopCode: requireShopCode(data.shopCode),
        fileUrl: requireHttpsUrl(data.fileUrl, 'fileUrl'),
        objectKey: requireString(data.objectKey, 'objectKey', { min: 1, max: 400 }),
        uploadTicket: requireString(data.uploadTicket, 'uploadTicket', { min: 10, max: 2000 }),
        fileName: requireFileName(data.fileName),
        contentType: requireContentType(data.contentType),
        copies: requireInteger(data.copies, 'copies', { min: 1, max: 20 }),
        colorMode: requireEnum(data.colorMode, 'colorMode', ['color', 'bw']),
        colorPages: optionalString(data.colorPages, { max: 200 }),
        bwPages: optionalString(data.bwPages, { max: 200 }),
        paperSize: requireEnum(data.paperSize || 'A4', 'paperSize', ['A4', 'A3', 'Letter', 'Legal']),
        orientation: requireEnum(data.orientation || 'portrait', 'orientation', ['portrait', 'landscape']),
        duplex: requireEnum(data.duplex || 'simplex', 'duplex', ['simplex', 'long-edge', 'short-edge']),
        scale: requireEnum(data.scale || 'fit', 'scale', ['fit', 'actual'])
    };
}

function doesTicketMatchPayload(ticket, payload) {
    return ticket.shopCode === payload.shopCode
        && ticket.fileName === payload.fileName
        && ticket.contentType === payload.contentType
        && ticket.objectKey === payload.objectKey
        && ticket.fileUrl === payload.fileUrl;
}

async function createDbClient(env) {
    const connectionString = env.DATABASE_URL || env.SUPABASE_DATABASE_URL || '';
    if (!connectionString) throw new Error('DATABASE_URL is not configured');
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return client;
}

async function getShopByCode(db, shopCode) {
    const result = await db.query(
        `SELECT id, shop_code, shop_name, password_hash, color_price, bw_price, subscription_end, created_at, updated_at
         FROM shops
         WHERE shop_code = $1
         LIMIT 1`,
        [shopCode]
    );
    return result.rows[0] || null;
}

function buildObjectKey(shopCode, fileName) {
    return `${shopCode}/${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

function buildR2ObjectUrl(env, objectKey) {
    const keyPath = objectKey.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${keyPath}`;
}

async function createSignedDownloadUrl(objectKey, env) {
    const signedRequest = await awsClient(env).sign(
        new Request(buildR2ObjectUrl(env, objectKey), { method: 'GET' }),
        { aws: { signQuery: true } }
    );
    return signedRequest.url;
}

function awsClient(env) {
    if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID || !env.R2_BUCKET_NAME) {
        throw new Error('R2 credentials are not configured');
    }
    return new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
}

async function retryWithBackoff(fn, attempt = 0) {
    try {
        return await fn();
    } catch (error) {
        if (attempt >= MAX_RETRIES - 1 || error instanceof HttpError) throw error;
        await sleep(backoffDelay(attempt));
        return retryWithBackoff(fn, attempt + 1);
    }
}

function backoffDelay(attempt) {
    return (1000 * (2 ** attempt)) + secureRandomInt(250);
}

function secureRandomInt(maxExclusive) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return Number(values[0] % maxExclusive);
}

function shouldRunCleanup() {
    return secureRandomInt(100) === 0;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAllowedTransition(currentStatus, nextStatus) {
    if (currentStatus === nextStatus) return true;
    return (
        (currentStatus === 'pending' && nextStatus === 'printing') ||
        (currentStatus === 'printing' && ['pending', 'completed', 'failed'].includes(nextStatus))
    );
}

function currentRateBucket(windowSeconds) {
    return Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
}

function clientAddress(request) {
    return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

function resolveSubscriptionEnd(explicitDate, daysValue) {
    if (explicitDate) {
        const date = new Date(explicitDate);
        if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Invalid subscriptionEnd');
        return date.toISOString();
    }
    const days = requireInteger(daysValue ?? 365, 'subscriptionDays', { min: 1, max: 3650 });
    return new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString();
}

function isExpired(value) {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function unixTime() {
    return Math.floor(Date.now() / 1000);
}

function requireShopCode(value) {
    const normalized = normalizeShopCode(value);
    if (!normalized) throw new HttpError(400, 'shopCode required');
    if (!/^[A-Z0-9_-]{3,40}$/.test(normalized)) throw new HttpError(400, 'Invalid shopCode');
    return normalized;
}

function requireUuid(value, field) {
    const normalized = String(value || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
        throw new HttpError(400, `${field} must be a valid UUID`);
    }
    return normalized;
}

function requireString(value, field, { min = 0, max = 500 } = {}) {
    const normalized = String(value || '').trim();
    if (normalized.length < min || normalized.length > max) throw new HttpError(400, `${field} is invalid`);
    return normalized;
}

function optionalString(value, { max = 500 } = {}) {
    if (value === undefined || value === null || value === '') return '';
    return requireString(value, 'value', { min: 0, max });
}

function requireInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new HttpError(400, `${field} must be an integer`);
    return parsed;
}

function optionalNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new HttpError(400, 'Invalid number');
    return parsed;
}

function requireEnum(value, field, options) {
    const normalized = String(value || '').trim();
    if (!options.includes(normalized)) throw new HttpError(400, `${field} is invalid`);
    return normalized;
}

function requireFileName(value) {
    const normalized = sanitizeFileName(requireString(value, 'fileName', { min: 1, max: 255 }));
    if (!normalized) throw new HttpError(400, 'fileName is invalid');
    return normalized;
}

function requireContentType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!ALLOWED_FILE_TYPES.has(normalized)) throw new HttpError(400, 'Unsupported content type');
    return normalized;
}

function requireFileSize(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_FILE_SIZE_BYTES) throw new HttpError(400, 'Invalid fileSize');
    return Math.floor(parsed);
}

function requireHttpsUrl(value, field) {
    const normalized = String(value || '').trim();
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new HttpError(400, `${field} must be a valid URL`);
    }
    if (parsed.protocol !== 'https:') throw new HttpError(400, `${field} must use https`);
    return parsed.toString();
}

function requireJobStatus(value, allowFailed) {
    const options = allowFailed ? ['pending', 'printing', 'completed', 'failed'] : ['pending', 'printing', 'completed'];
    return requireEnum(String(value || '').trim().toLowerCase(), 'status', options);
}

function sanitizeFileName(value) {
    return String(value || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
}

function normalizeShopCode(value) {
    return String(value || '').trim().replace(/[<>]/g, '').toUpperCase();
}

async function readJson(request, env, requestId) {
    try {
        return { data: await request.json() };
    } catch {
        return { errorResponse: json({ error: 'Invalid JSON', request_id: requestId }, 400, request, env) };
    }
}

function matchPath(pathname, pattern) {
    const current = pathname.split('/').filter(Boolean);
    const expected = pattern.split('/').filter(Boolean);
    if (current.length !== expected.length) return null;
    const params = {};
    for (let index = 0; index < expected.length; index += 1) {
        if (expected[index].startsWith(':')) params[expected[index].slice(1)] = decodeURIComponent(current[index]);
        else if (current[index] !== expected[index]) return null;
    }
    return params;
}

function getBearerToken(request) {
    return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || '';
}

function buildCorsHeaders(request, env) {
    const origin = request.headers.get('origin');
    const allowedOrigins = [env.FRONTEND_URL, env.ADMIN_FRONTEND_URL, env.ALLOWED_ORIGINS]
        .filter(Boolean)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
    const headers = {
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept,X-Request-Id',
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin'
    };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    return headers;
}

function json(payload, status, request, env, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...buildCorsHeaders(request, env),
            ...extraHeaders
        }
    });
}

function withResponseHeader(response, name, value) {
    const headers = new Headers(response.headers);
    headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function logEvent(level, event, data) {
    console.log(JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...data }));
}

function sanitizeError(error) {
    if (!error) return 'unknown';
    if (error instanceof Error) return error.message;
    return String(error);
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function signJwt(payload, secret) {
    if (!secret) throw new Error('JWT_SECRET is not configured');
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64UrlEncode(JSON.stringify(payload));
    const input = `${header}.${body}`;
    return `${input}.${await hmacSha256(input, secret)}`;
}

async function verifyJwt(token, secret) {
    if (!secret) throw new Error('JWT_SECRET is not configured');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const [header, body, signature] = parts;
    const expected = await hmacSha256(`${header}.${body}`, secret);
    if (!timingSafeEqual(signature, expected)) throw new Error('Invalid signature');
    const parsedHeader = JSON.parse(base64UrlDecode(header));
    if (parsedHeader.alg !== 'HS256') throw new Error('Invalid algorithm');
    const parsedBody = JSON.parse(base64UrlDecode(body));
    if (parsedBody.exp && unixTime() > parsedBody.exp) throw new Error('Token expired');
    return parsedBody;
}

async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']),
        256
    );
    return bytesToBase64(new Uint8Array([...salt, ...new Uint8Array(derivedBits)]));
}

async function comparePassword(password, hash) {
    if (!hash) return false;
    try {
        const bytes = base64ToBytes(hash);
        const salt = bytes.slice(0, 16);
        const original = bytes.slice(16);
        const derivedBits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']),
            256
        );
        const candidate = new Uint8Array(derivedBits);
        let mismatch = candidate.length === original.length ? 0 : 1;
        for (let index = 0; index < Math.min(candidate.length, original.length); index += 1) mismatch |= candidate[index] ^ original[index];
        return mismatch === 0;
    } catch {
        return false;
    }
}

async function hmacSha256(value, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
    return base64UrlFromBytes(new Uint8Array(signature));
}

function base64UrlEncode(value) {
    return base64UrlFromBytes(new TextEncoder().encode(value));
}

function base64UrlFromBytes(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
}

function timingSafeEqual(left, right) {
    if (left.length !== right.length) return false;
    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return mismatch === 0;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}
