import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  FRONTEND_URL: process.env.FRONTEND_URL,
  MAX_ROOMS_PER_USER: process.env.MAX_ROOMS_PER_USER,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  CLIENT_URL: process.env.CLIENT_URL,
};
