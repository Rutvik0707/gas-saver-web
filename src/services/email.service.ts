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
      const name = userName || email.split('@')[0];

      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject: 'Verify Your GasSaver Account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #4a86e8; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">GasSaver</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd; border-top: none;">
              <h2>Welcome to GasSaver!</h2>
              <p>Hello ${name},</p>
              <p>Thank you for registering with GasSaver. Please verify your email address to activate your account.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" style="background-color: #4a86e8; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Verify Email
                </a>
              </div>
              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
              <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 12px;">
                If you didn't create an account with GasSaver, please ignore this email.
              </p>
            </div>
          </div>
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
  async sendOTPEmail(
    email: string,
    otp: string,
    username?: string
  ): Promise<boolean> {
    try {
      const name = username || email.split('@')[0];

      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject: 'Your GasSaver Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #4a86e8; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">GasSaver</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd; border-top: none;">
              <h2>Your Verification Code</h2>
              <p>Hello ${name},</p>
              <p>Your verification code for GasSaver is:</p>
              <div style="text-align: center; margin: 30px 0;">
                <h1 style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; letter-spacing: 5px; color: #333;">
                  ${otp}
                </h1>
              </div>
              <p style="color: #666;">This code will expire in 10 minutes.</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 12px;">
                If you didn't request this code, please ignore this email.
              </p>
            </div>
          </div>
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
      const name = userName || email.split('@')[0];

      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject: 'Reset Your GasSaver Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #4a86e8; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">GasSaver</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd; border-top: none;">
              <h2>Password Reset Request</h2>
              <p>Hello ${name},</p>
              <p>We received a request to reset your password. Click the button below to create a new password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #4a86e8; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Reset Password
                </a>
              </div>
              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #666;">${resetUrl}</p>
              <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 12px;">
                If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
              </p>
            </div>
          </div>
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
  async sendNotificationEmail(
    email: string,
    subject: string,
    content: string
  ): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to: email,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #4a86e8; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">GasSaver</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd; border-top: none;">
              ${content}
            </div>
          </div>
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