import { Resend } from "resend";
import { env } from "../../config/env.js";
import { pool } from "../../config/db.js";
const resend = new Resend(env.RESEND_API_KEY);

export const sendVerificationEmail = async (email, token) => {
  const verifyUrl = `${env.CLIENT_URL}/verify-email?token=${token}`;

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: email,
    subject: "Verify your email to activate ShareHut",
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,0.05);">

          <!-- Logo / Header -->
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <h1 style="margin:0;font-size:26px;color:#111;">
                ShareHut
              </h1>
              <p style="margin:5px 0 0;color:#666;font-size:14px;">
                Secure Real-Time Text Sharing
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td>
              <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="color:#333;font-size:16px;line-height:1.6;">
              <p style="margin:0 0 15px;">
                Welcome to <strong>ShareHut</strong> 🚀
              </p>

              <p style="margin:0 0 20px;">
                Please confirm your email address to activate your account and start collaborating securely in real time.
              </p>

              <div style="text-align:center;margin:30px 0;">
                <a href="${verifyUrl}"
                  style="background:#111;color:#ffffff;padding:14px 24px;
                         border-radius:8px;text-decoration:none;
                         font-weight:bold;font-size:15px;
                         display:inline-block;">
                  Verify Email
                </a>
              </div>

              <p style="font-size:14px;color:#777;margin:0 0 10px;">
                This verification link will expire in <strong>1 hour</strong>.
              </p>

              <p style="font-size:14px;color:#777;margin:0;">
                If you did not create a ShareHut account, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td>
              <hr style="border:none;border-top:1px solid #eee;margin:30px 0;" />
            </td>
          </tr>

          <!-- Fallback Link -->
          <tr>
            <td style="font-size:12px;color:#999;word-break:break-all;">
              <p style="margin:0 0 8px;">
                If the button above doesn’t work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;color:#555;">
                ${verifyUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:30px;font-size:12px;color:#aaa;">
              © ${new Date().getFullYear()} ShareHut. All rights reserved.
              <br />
              sharehutlive.com
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
    `,
  });
};

/**
 * Save verification token
 */
export const saveVerificationToken = async (userId, token, expires) => {
  await pool.query(
    `
    UPDATE users
    SET email_verification_token = $1,
        email_verification_expires = $2
    WHERE id = $3
    `,
    [token, expires, userId],
  );
};

/**
 * Verify token
 */
export const verifyUserByToken = async (hashedToken) => {
  const { rows } = await pool.query(
    `
    SELECT id FROM users
    WHERE email_verification_token = $1
    AND email_verification_expires > NOW()
    `,
    [hashedToken],
  );

  if (!rows[0]) return null;

  await pool.query(
    `
    UPDATE users
    SET is_verified = TRUE,
        email_verification_token = NULL,
        email_verification_expires = NULL
    WHERE id = $1
    `,
    [rows[0].id],
  );

  return rows[0];
};
