import { z } from 'zod';

// Validation schemas
export const schemas = {
  login: z.object({
    shopCode: z.string().min(3).max(50).regex(/^[A-Z0-9_-]+$/),
    password: z.string().min(6).max(100),
  }),

  createShop: z.object({
    shopCode: z.string().min(3).max(50).regex(/^[A-Z0-9_-]+$/),
    password: z.string().min(8).max(100),
    name: z.string().min(1).max(200),
    email: z.string().email().optional(),
  }),

  printJob: z.object({
    fileUrl: z.string().url(),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive().max(50 * 1024 * 1024), // Max 50MB
    fileType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']),
    printerName: z.string().max(200).optional(),
    copies: z.number().int().min(1).max(10).optional(),
    pageRange: z.string().max(50).optional(),
  }),

  deviceRegister: z.object({
    deviceId: z.string().min(1).max(100),
    pcName: z.string().min(1).max(200),
    shopCode: z.string().min(3).max(50),
    deviceToken: z.string().optional(),
  }),

  jobUpdate: z.object({
    jobId: z.string().min(1),
    status: z.enum(['queued', 'printing', 'completed', 'failed']),
    errorMessage: z.string().max(500).optional(),
  }),
};

// Validation middleware factory
export function validateBody(schema) {
  return async (c, next) => {
    try {
      const body = await c.req.json();
      const validated = schema.parse(body);
      c.set('validatedBody', validated);
      await next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({
          error: 'Validation failed',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        }, 400);
      }
      return c.json({ error: 'Invalid request body' }, 400);
    }
  };
}

// Sanitize file name to prevent path traversal
export function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 255);
}

// Validate file type
export function isAllowedFileType(mimeType) {
  const allowed = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
  ];
  return allowed.includes(mimeType);
}

export default {
  schemas,
  validateBody,
  sanitizeFileName,
  isAllowedFileType,
};
