import { logger } from '../config';
import { emailService } from './email.service';
import { whatsappService } from './whatsapp.service';

export class OtpService {
  /**
   * Generate a random OTP code
   */
  generateOTP(length = 6): string {
    // Generate a random 6-digit number
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  }

  /**
   * Calculate OTP expiry time
   * @param minutes - Number of minutes until expiry (default: 10)
   */
  calculateOTPExpiry(minutes: number = 10): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  /**
   * Send OTP via email and WhatsApp
   */
  async sendOTP(email: string, phoneNumber: string, otp: string): Promise<boolean> {
    try {
      // Send OTP via email
      const emailSent = await emailService.sendOTPEmail(email, otp);
      
      // Send OTP via WhatsApp
      const whatsappSent = await whatsappService.sendOTP(phoneNumber, otp);
      
      logger.info('OTP sent to user', { 
        email, 
        phoneNumber, 
        emailSent, 
        whatsappSent 
      });
      
      // Return true if at least one method succeeded
      return emailSent || whatsappSent;
    } catch (error) {
      logger.error('Failed to send OTP', {
        error: error instanceof Error ? error.message : 'Unknown error',
        email,
        phoneNumber
      });
      return false;
    }
  }

  /**
   * Verify if the OTP is valid and not expired
   */
  isValidOTP(userOtp: string, storedOtp: string | null, otpExpiry: Date | null): boolean {
    // Check if stored OTP exists
    if (!storedOtp) {
      return false;
    }
    
    // Check if OTP matches
    if (userOtp !== storedOtp) {
      return false;
    }
    
    // Check if OTP is expired
    if (!otpExpiry || otpExpiry < new Date()) {
      return false;
    }
    
    return true;
  }
}

// Export a singleton instance
export const otpService = new OtpService();
