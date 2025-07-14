import nodemailer from 'nodemailer';
import { config, logger } from '../config';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // Create a transporter using the configured email settings
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
    });

    // Verify connection configuration
    this.transporter.verify((error) => {
      if (error) {
        logger.error('Email service connection error', { error });
      } else {
        logger.info('Email service ready to send messages');
      }
    });
  }

  /**
   * Send a verification email to a user
   * @param to Recipient email address
   * @param token Verification token
   * @returns Promise resolving to the message ID
   */
  async sendVerificationEmail(to: string, token: string): Promise<string> {
    try {
      const verificationUrl = `${config.frontendUrl}/verify-email?token=${token}`;
      
      const mailOptions = {
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to,
        subject: 'Verify Your Email Address',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome to TRON Energy Broker!</h2>
            <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" style="background-color: #1da1f2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
                Verify Email Address
              </a>
            </div>
            <p>Or copy and paste this link in your browser:</p>
            <p>${verificationUrl}</p>
            <p>This link will expire in 24 hours.</p>
            <p>If you didn't create an account, you can safely ignore this email.</p>
            <p>Thank you,<br>The TRON Energy Broker Team</p>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info('Verification email sent', { to, messageId: info.messageId });
      
      return info.messageId;
    } catch (error) {
      logger.error('Failed to send verification email', { error, to });
      throw error;
    }
  }
}

// Export a singleton instance
export const emailService = new EmailService();
