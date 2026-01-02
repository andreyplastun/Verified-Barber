import { z } from 'zod';
import { insertBookingSchema, insertReviewSchema, specialists, bookings, reviews } from './schema';

// === SHARED ERROR SCHEMAS ===
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  conflict: z.object({
    message: z.string(),
  }),
};

// === API CONTRACT ===
export const api = {
  specialists: {
    list: {
      method: 'GET' as const,
      path: '/api/specialists',
      responses: {
        200: z.array(z.custom<typeof specialists.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/specialists/:id',
      responses: {
        200: z.custom<typeof specialists.$inferSelect & { reviews: typeof reviews.$inferSelect[] }>(),
        404: errorSchemas.notFound,
      },
    },
  },
  bookings: {
    create: {
      method: 'POST' as const,
      path: '/api/bookings',
      input: insertBookingSchema,
      responses: {
        201: z.custom<typeof bookings.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    list: { // For "Admin" view to mark as completed
      method: 'GET' as const,
      path: '/api/bookings',
      responses: {
        200: z.array(z.custom<typeof bookings.$inferSelect>()),
      },
    },
    get: { // To check status before review
      method: 'GET' as const,
      path: '/api/bookings/:id',
      responses: {
        200: z.custom<typeof bookings.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    complete: { // Mark as visited (simple admin action)
      method: 'PATCH' as const,
      path: '/api/bookings/:id/complete',
      responses: {
        200: z.custom<typeof bookings.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    }
  },
  reviews: {
    create: {
      method: 'POST' as const,
      path: '/api/reviews',
      input: insertReviewSchema,
      responses: {
        201: z.custom<typeof reviews.$inferSelect>(),
        400: errorSchemas.validation,
        409: errorSchemas.conflict, // Already reviewed or not visited
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/specialists/:id/reviews',
      responses: {
        200: z.array(z.custom<typeof reviews.$inferSelect>()),
      },
    }
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
