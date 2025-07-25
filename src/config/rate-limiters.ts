import rateLimit from 'express-rate-limit';

// Authentication rate limiter - strict for security
export const authRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
});

// Public routes rate limiter - moderate limits
export const publicRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Authenticated routes rate limiter - higher limits
export const authenticatedRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID + IP for authenticated routes
    const userId = (req as any).user?.id || 'anonymous';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `${userId}-${ip}`;
  },
});

// Default rate limiter - fallback for uncategorized routes
export const defaultRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for whitelisted IPs
    const whitelist = process.env.RATE_LIMIT_WHITELIST?.split(',').map(ip => ip.trim()) || [];
    const clientIp = req.ip || req.connection.remoteAddress || '';
    return whitelist.includes(clientIp);
  },
});

// Deposit processing rate limiter - prevent abuse
export const depositRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 deposit requests per 5 minutes
  message: { success: false, message: 'Too many deposit requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin routes rate limiter - relaxed for internal use
export const adminRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // 1000 requests per minute
  message: { success: false, message: 'Too many admin requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});