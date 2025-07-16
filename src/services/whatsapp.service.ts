import axios from 'axios';
import { logger } from '../config';

export class WhatsAppService {
  private readonly baseUrl = 'https://bot.easysenders.com/api';
  private readonly instanceId = '6873917CB70AC';
  private readonly accessToken = '686cf75b2e03c';

  /**
   * Send OTP via WhatsApp
   */
  async sendOTP(phoneNumber: string, otp: string): Promise<boolean> {
    try {
      // Format the message
      const message = `Your Gas Saver OTP is ${otp}`;
      
      // Make sure phone number is formatted correctly (should include country code, no spaces or special chars)
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // Prepare the URL
      const url = `${this.baseUrl}/send`;
      
      // Make the request
      const response = await axios.get(url, {
        params: {
          number: formattedPhone,
          type: 'text',
          message,
          instance_id: this.instanceId,
          access_token: this.accessToken
        }
      });
      
      // Check if the request was successful
      if (response.status === 200 && response.data && response.data.status === 'success') {
        logger.info('WhatsApp OTP sent successfully', { phoneNumber: formattedPhone });
        return true;
      } else {
        logger.warn('WhatsApp OTP sending failed', { 
          phoneNumber: formattedPhone,
          response: response.data
        });
        return false;
      }
    } catch (error) {
      logger.error('Error sending WhatsApp OTP', {
        phoneNumber,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Format phone number to ensure it includes country code and no special characters
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // If number doesn't start with country code, assume it's an Indian number and add +91
    if (!cleaned.startsWith('91') && cleaned.length === 10) {
      cleaned = `91${cleaned}`;
    }
    
    return cleaned;
  }

  /**
   * Validate phone number format
   */
  static validatePhoneNumber(phoneNumber: string): boolean {
    // Basic validation - check if it's a valid international format
    // This regex allows for optional + prefix, followed by country code and number
    // e.g., +919876543210 or 919876543210
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    
    // Remove any non-digit characters except leading +
    const cleaned = phoneNumber.replace(/[^\d+]/g, '');
    
    return phoneRegex.test(cleaned);
  }
}

// Export a singleton instance
export const whatsappService = new WhatsAppService();
