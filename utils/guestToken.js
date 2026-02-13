import crypto from "crypto";

export const generateGuestOwnerToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

export const hashGuestToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};
