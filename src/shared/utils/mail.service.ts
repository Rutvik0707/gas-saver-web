import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sesClient, SES_FROM_EMAIL } from "../../config";
import { logger } from "../../config";

export const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) => {
  const params = {
    Source: SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
      },
      Body: {
        Html: {
          Data: html,
        },
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    await sesClient.send(command);
    logger.info(`Email sent via SES to ${to}`);
  } catch (err: any) {
    logger.error(`Failed to send email via SES: ${err.message}`);
    throw err;
  }
};
