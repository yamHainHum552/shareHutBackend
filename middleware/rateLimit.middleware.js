import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many attempts, try again later." },
});

export const joinRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { error: "Too many join requests." },
});
