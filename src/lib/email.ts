import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // Create a transporter using SMTP
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: true, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendEmail(
    to: string,
    subject: string,
    message: string,
    cc?: string
  ): Promise<void> {
    try {
      console.log('Sending email to:', to , 'with subject:', subject, 'and message:', message, 'and cc:', cc);  
      const mailOptions = {
        from: `Lynk Support <${cc}>`,
        to,
        replyTo: cc,
        cc,
        subject: `${subject}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #5C6AC4;">Message from JCS Fashions</h2>
              <a href="https://jcsfashions.com" style="text-decoration: none; color: inherit;">
                <div style="padding: 20px; background-color: #f9f9f9; border-radius: 5px; cursor: pointer; transition: background-color 0.2s ease;">
                  ${message}
                </div>
              </a>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">
              This is an automated message from JCSFashions 
              Powered by <a href="https://jediteck.com" style="color: #5C6AC4; text-decoration: none;">JediTeck</a> / Shop Lynk AI. Please do not reply to this email.
            </p>
          </div>
        `,
      };

      await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully to:', to);
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error('Failed to send email');
    }
  }
}

// Create a singleton instance
export const emailService = new EmailService();
