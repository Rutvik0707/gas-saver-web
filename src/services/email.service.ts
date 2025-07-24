import * as nodemailer from 'nodemailer';
import { logger, config } from '../config';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
    });
  }

  /**
   * Send verification email
   * @param email - Recipient email address
   * @param verificationToken - Email verification token
   * @param userName - User's name (optional)
   */
  async sendVerificationEmail(
    email: string,
    verificationToken: string,
    userName?: string
  ): Promise<boolean> {
    try {
      const verificationUrl = `${config.frontendUrl}/verify-email?token=${verificationToken}`;

      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject: 'Verify Your Gas Saver Account',
        html: `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Account</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">

            <div style="background-color: #f5f5f5; padding: 40px 20px;">
              <!-- Email Container -->
              <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">

                <!-- Content -->
                <div style="padding: 48px 40px; text-align: center;">

                  <!-- Logo -->
                  <div style="display: inline-block; width: 56px; height: 56px; background: #e53e3e; border-radius: 12px; margin-bottom: 32px; box-shadow: 0 4px 12px rgba(229, 62, 62, 0.2); position: relative;">
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; font-weight: bold;">⚡</div>
                  </div>

                  <!-- Title -->
                  <h1 style="color: #1a1a1a; margin: 0 0 40px; font-size: 24px; font-weight: 600; line-height: 1.3;">Welcome to Gas Saver!</h1>

                  <!-- Message -->
                  <p style="color: #666; margin: 0 0 32px; font-size: 16px; line-height: 1.6;">Thank you for registering. Please verify your email address to activate your account and start saving money on TRON transactions.</p>

                  <!-- CTA Button -->
                  <div style="margin: 40px 0;">
                    <a href="${verificationUrl}" style="display: inline-block; background: #e53e3e; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(229, 62, 62, 0.3);">Verify Email Address</a>
                  </div>

                  <!-- Alternative Link -->
                  <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; margin: 32px 0; text-align: left;">
                    <p style="color: #666; margin: 0 0 8px; font-size: 13px; font-weight: 600;">Can't click the button? Copy this link:</p>
                    <p style="color: #e53e3e; margin: 0; font-size: 12px; word-break: break-all;">${verificationUrl}</p>
                  </div>

                  <!-- Expiry Notice -->
                  <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 16px; margin: 32px 0; text-align: left;">
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                      <div style="color: #856404; font-weight: bold; margin-top: 1px;">⏰</div>
                      <div>
                        <p style="color: #856404; margin: 0 0 4px; font-size: 14px; font-weight: 600;">Time Limit</p>
                        <p style="color: #856404; margin: 0; font-size: 13px; line-height: 1.4;">This verification link expires in <strong>24 hours</strong>. Please complete verification soon.</p>
                      </div>
                    </div>
                  </div>

                  <!-- Footer -->
                  <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #e9ecef;">
                    <p style="color: #6c757d; margin: 0 0 8px; font-size: 12px;">If you didn't create a Gas Saver account, you can safely ignore this email.</p>
                    <p style="color: #adb5bd; margin: 0; font-size: 11px;">© 2024 Gas Saver. Save money on TRON transactions.</p>
                  </div>

                </div>
              </div>
            </div>

          </body>
          </html>
        `,
      };

      await this.transporter.sendMail(mailOptions);
      logger.info('Verification email sent successfully', { email });
      return true;
    } catch (error) {
      logger.error('Failed to send verification email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        email,
      });
      return false;
    }
  }

  /**
   * Send OTP email
   * @param email - Recipient email address
   * @param otp - One-time password
   * @param username - User's name (optional)
   */
  async sendOTPEmail(email: string, otp: string, username?: string): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject: 'Your Gas Saver Verification Code',
        html: `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gas Saver Verification</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">

            <div style="background-color: #f5f5f5; padding: 40px 20px;">
              <!-- Email Container -->
              <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">

                <!-- Content -->
                <div style="padding: 48px 40px; text-align: center;">

                  <!-- Logo -->
                  <div style="display: inline-block; width: 56px; height: 56px; background: #e53e3e; border-radius: 12px; margin-bottom: 32px; box-shadow: 0 4px 12px rgba(229, 62, 62, 0.2); position: relative;">
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; font-weight: bold;">⚡</div>
                  </div>

                  <!-- Title -->
                  <h1 style="color: #1a1a1a; margin: 0 0 40px; font-size: 24px; font-weight: 600; line-height: 1.3;">Your Signup verification Code</h1>

                  <!-- OTP Code Display -->
                  <div style="margin: 40px 0; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; text-align: center;">
                    ${otp
                      .split('')
                      .map(
                        (digit) => `
                      <div style="width: 48px; height: 56px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 600; color: #1a1a1a; text-align: center;">${digit}</div>
                    `
                      )
                      .join('')}
                  </div>

                  <!-- Warning -->
                  <p style="color: #6c757d; margin: 32px 0; font-size: 14px; font-weight: 500;">Don't share this code to anyone!</p>

                  <!-- Security Notice -->
                  <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 16px; margin: 32px 0; text-align: left;">
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                      <div style="color: #856404; font-weight: bold; margin-top: 1px;">⚠️</div>
                      <div>
                        <p style="color: #856404; margin: 0 0 4px; font-size: 14px; font-weight: 600;">Security Notice</p>
                        <p style="color: #856404; margin: 0; font-size: 13px; line-height: 1.4;">This code expires in <strong>10 minutes</strong>. If you did not initiate this request, you can safely ignore this email.</p>
                      </div>
                    </div>
                  </div>

                  <!-- Footer -->
                  <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #e9ecef;">
                    <p style="color: #6c757d; margin: 0 0 8px; font-size: 12px;">This is an automated message. <strong>Please do not reply.</strong></p>
                    <p style="color: #adb5bd; margin: 0; font-size: 11px;">© 2024 Gas Saver. Save money on TRON transactions.</p>
                  </div>

                </div>
              </div>
            </div>

          </body>
          </html>
        `,
      };

      await this.transporter.sendMail(mailOptions);
      logger.info('OTP email sent successfully', { email });
      return true;
    } catch (error) {
      logger.error('Failed to send OTP email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        email,
      });
      return false;
    }
  }

  /**
   * Send password reset email
   * @param email - Recipient email address
   * @param resetToken - Password reset token
   * @param userName - User's name (optional)
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    userName?: string
  ): Promise<boolean> {
    try {
      const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject: 'Reset Your Gas Saver Password',
        html: `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Password</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">

            <div style="background-color: #f5f5f5; padding: 40px 20px;">
              <!-- Email Container -->
              <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">

                <!-- Content -->
                <div style="padding: 48px 40px; text-align: center;">

                  <!-- Logo -->
                  <div style="display: inline-block; width: 56px; height: 56px; background: #e53e3e; border-radius: 12px; margin-bottom: 32px; box-shadow: 0 4px 12px rgba(229, 62, 62, 0.2); position: relative;">
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; font-weight: bold;">🔒</div>
                  </div>

                  <!-- Title -->
                  <h1 style="color: #1a1a1a; margin: 0 0 40px; font-size: 24px; font-weight: 600; line-height: 1.3;">Password Reset Request</h1>

                  <!-- Message -->
                  <p style="color: #666; margin: 0 0 32px; font-size: 16px; line-height: 1.6;">We received a request to reset your password. Click the button below to create a new password for your Gas Saver account.</p>

                  <!-- CTA Button -->
                  <div style="margin: 40px 0;">
                    <a href="${resetUrl}" style="display: inline-block; background: #e53e3e; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(229, 62, 62, 0.3);">Reset My Password</a>
                  </div>

                  <!-- Alternative Link -->
                  <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; margin: 32px 0; text-align: left;">
                    <p style="color: #666; margin: 0 0 8px; font-size: 13px; font-weight: 600;">Can't click the button? Copy this link:</p>
                    <p style="color: #e53e3e; margin: 0; font-size: 12px; word-break: break-all;">${resetUrl}</p>
                  </div>

                  <!-- Security Notice -->
                  <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 16px; margin: 32px 0; text-align: left;">
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                      <div style="color: #856404; font-weight: bold; margin-top: 1px;">⚠️</div>
                      <div>
                        <p style="color: #856404; margin: 0 0 4px; font-size: 14px; font-weight: 600;">Security Notice</p>
                        <p style="color: #856404; margin: 0; font-size: 13px; line-height: 1.4;">This reset link expires in <strong>1 hour</strong>. If you didn't request this reset, please ignore this email.</p>
                      </div>
                    </div>
                  </div>

                  <!-- Footer -->
                  <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #e9ecef;">
                    <p style="color: #6c757d; margin: 0 0 8px; font-size: 12px;">If you didn't request a password reset, your password will remain unchanged.</p>
                    <p style="color: #adb5bd; margin: 0; font-size: 11px;">© 2024 Gas Saver. Save money on TRON transactions.</p>
                  </div>

                </div>
              </div>
            </div>

          </body>
          </html>
        `,
      };

      await this.transporter.sendMail(mailOptions);
      logger.info('Password reset email sent successfully', { email });
      return true;
    } catch (error) {
      logger.error('Failed to send password reset email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        email,
      });
      return false;
    }
  }

  /**
   * Send general notification email
   * @param email - Recipient email address
   * @param subject - Email subject
   * @param content - HTML content
   */
  async sendNotificationEmail(email: string, subject: string, content: string): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject,
        html: `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${subject}</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">

            <div style="background-color: #f5f5f5; padding: 40px 20px;">
              <!-- Email Container -->
              <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">

                <!-- Content -->
                <div style="padding: 48px 40px;">

                  <!-- Logo -->
                  <div style="display: inline-block; width: 56px; height: 56px; background: #e53e3e; border-radius: 12px; margin-bottom: 32px; box-shadow: 0 4px 12px rgba(229, 62, 62, 0.2); margin-left: auto; margin-right: auto; display: block; position: relative;">
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; font-weight: bold;">📢</div>
                  </div>

                  <!-- Content -->
                  <div style="color: #333; font-size: 16px; line-height: 1.6;">
                    ${content}
                  </div>

                  <!-- Footer -->
                  <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #e9ecef; text-align: center;">
                    <p style="color: #6c757d; margin: 0 0 8px; font-size: 12px;">This notification was sent from your Gas Saver account.</p>
                    <p style="color: #adb5bd; margin: 0; font-size: 11px;">© 2024 Gas Saver. Save money on TRON transactions.</p>
                  </div>

                </div>
              </div>
            </div>

          </body>
          </html>
        `,
      };

      await this.transporter.sendMail(mailOptions);
      logger.info('Notification email sent successfully', { email, subject });
      return true;
    } catch (error) {
      logger.error('Failed to send notification email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        email,
        subject,
      });
      return false;
    }
  }

  /**
   * Verify transporter connection
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
}

export const emailService = new EmailService();
