import nodemailer from 'nodemailer';
import { config } from '../config';

class MailService {
  private transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure, // true for 465, false for 587
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });

  async sendVerificationEmail(email: string, token: string) {
    const verifyUrl = `${config.appUrl}/api/users/verify-email?token=${token}`;

    const mailOptions = {
      from: `"Your App Name" <${config.smtp.from}>`,
      to: email,
      subject: 'Verify Your Email',
      html: `
        <p>Hello,</p>
        <p>Thank you for registering! Please verify your email by clicking the link below:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>This link will expire in 24 hours.</p>
      `,
    };

    await this.transporter.sendMail(mailOptions);
  }
}

export const mailService = new MailService();
