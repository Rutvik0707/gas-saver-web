import nodemailer from 'nodemailer';
import { config, logger } from '../config';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  /**
   * Send password reset email
   * @param email - Recipient email address
   * @param resetToken - Password reset token
   * @param userName - User's name (optional)
   */
  async sendPasswordResetEmail(email: string, resetToken: string, userName?: string): Promise<void> {
    try {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
      
      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'TRON Energy Broker'}" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Reset Request - TRON Energy Broker',
        html: this.getPasswordResetEmailTemplate(resetUrl, userName || email, resetToken),
        text: this.getPasswordResetEmailText(resetUrl, userName || email),
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      logger.info('Password reset email sent successfully', {
        messageId: info.messageId,
        email: email,
        resetToken: resetToken.substring(0, 8) + '...' // Log only partial token for security
      });

    } catch (error) {
      logger.error('Failed to send password reset email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        email: email,
      });
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Verify email service connection
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified successfully');
      return true;
    } catch (error) {
      logger.error('Email service connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * HTML template for password reset email
   */
  private getPasswordResetEmailTemplate(resetUrl: string, userName: string, token: string): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset - TRON Energy Broker</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .button:hover { background: #5a6fd8; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
            .token-box { background: #e9ecef; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 16px; letter-spacing: 2px; margin: 15px 0; word-break: break-all; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🔐 Password Reset Request</h1>
            <p>TRON Energy Broker</p>
        </div>
        
        <div class="content">
            <p>Hello <strong>${userName}</strong>,</p>
            
            <p>We received a request to reset your password for your TRON Energy Broker account. If you didn't make this request, you can ignore this email.</p>
            
            <p>To reset your password, click the button below:</p>
            
            <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset My Password</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #667eea;">${resetUrl}</p>
            
            <div class="warning">
                <strong>⚠️ Security Notice:</strong>
                <ul>
                    <li>This link will expire in <strong>1 hour</strong></li>
                    <li>The token can only be used once</li>
                    <li>If you didn't request this reset, please ignore this email</li>
                </ul>
            </div>
            
            <p>For your security, here's your reset token:</p>
            <div class="token-box">${token}</div>
            
            <p>If you're having trouble with the link above, you can manually enter this token on the password reset page.</p>
        </div>
        
        <div class="footer">
            <p>This email was sent from TRON Energy Broker</p>
            <p>If you didn't request this email, please contact our support team.</p>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Plain text version for password reset email
   */
  private getPasswordResetEmailText(resetUrl: string, userName: string): string {
    return `
Password Reset Request - TRON Energy Broker

Hello ${userName},

We received a request to reset your password for your TRON Energy Broker account.

To reset your password, visit this link:
${resetUrl}

This link will expire in 1 hour and can only be used once.

If you didn't request this password reset, you can ignore this email.

---
TRON Energy Broker
    `;
  }
}

// Export singleton instance
export const emailService = new EmailService();
