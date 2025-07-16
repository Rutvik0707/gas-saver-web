import nodemailer from 'nodemailer';
import { config, logger } from '../config';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'email-smtp.us-east-1.amazonaws.com',
      port: 587, // STARTTLS
      secure: false, // true for 465, false for other ports
      auth: {
        user: 'AKIAVVNLIQAZP6O4DAEO', // SMTP username
        pass: 'BOJRdo3aRrR8/RoCvBzuiAbxfBhIXbtxYnVMNTlExZVc', // SMTP password
      },
    });

    // Verify connection configuration
    this.transporter.verify((error) => {
      if (error) {
        logger.error('SMTP connection error', { error: error.message });
      } else {
        logger.info('SMTP server is ready to send emails');
      }
    });
  }

/**
   * Send OTP email to user
   */
  async sendOTPEmail(
    email: string,
    otp: string,
    username?: string
  ): Promise<boolean> {
    try {
      const name = username || email.split('@')[0];

      const mailOptions = {
        from: '"GasSaver" <admin@gassaver.in>',
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
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; background-color: #f3f3f3; padding: 15px; border-radius: 5px;">${otp}</div>
              </div>
              <p>This code will expire in 10 minutes.</p>
              <p>If you did not request this code, please ignore this email.</p>
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777;">
                <p>© ${new Date().getFullYear()} GasSaver. All rights reserved.</p>
                <p>This is an automated email, please do not reply.</p>
              </div>
            </div>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info('OTP email sent', { 
        email, 
        messageId: info.messageId,
      });
      
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
   * Send verification email to user
   */
  async sendVerificationEmail(
    email: string,
    token: string,
    username?: string
  ): Promise<boolean> {
    try {
      const verificationUrl = `${config.app.url}/api/v1/users/verify-email?token=${token}`;
      const name = username || email.split('@')[0];

      const mailOptions = {
        from: '"GasSaver" <admin@gassaver.in>',
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
                <a href="${verificationUrl}" style="background-color: #4a86e8; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">Verify Email Address</a>
              </div>
              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #4a86e8;"><a href="${verificationUrl}">${verificationUrl}</a></p>
              <p>This verification link will expire in 24 hours.</p>
              <p>If you did not create an account, please ignore this email.</p>
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777;">
                <p>© ${new Date().getFullYear()} GasSaver. All rights reserved.</p>
                <p>This is an automated email, please do not reply.</p>
              </div>
            </div>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info('Verification email sent', { 
        email, 
        messageId: info.messageId,
      });
      
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
   * Send password reset email
   */
  async sendPasswordResetEmail(
    email: string,
    token: string,
    username?: string
  ): Promise<boolean> {
    try {
      const resetUrl = `${config.app.url}/reset-password?token=${token}`;
      const name = username || email.split('@')[0];

      const mailOptions = {
        from: '"GasSaver" <admin@gassaver.in>',
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
                <a href="${resetUrl}" style="background-color: #4a86e8; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset Password</a>
              </div>
              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #4a86e8;"><a href="${resetUrl}">${resetUrl}</a></p>
              <p>This reset link will expire in 1 hour.</p>
              <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777;">
                <p>© ${new Date().getFullYear()} GasSaver. All rights reserved.</p>
                <p>This is an automated email, please do not reply.</p>
              </div>
            </div>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info('Password reset email sent', { 
        email, 
        messageId: info.messageId,
      });
      
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
   * Send a generic email
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    from?: string;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: options.from || '"GasSaver" <admin@gassaver.in>',
        to: options.to,
        subject: options.subject,
        html: options.html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info('Email sent', { 
        to: options.to, 
        subject: options.subject,
        messageId: info.messageId,
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to send email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        to: options.to,
        subject: options.subject,
      });
      return false;
    }
  }
}

// Export a singleton instance
export const emailService = new EmailService();
