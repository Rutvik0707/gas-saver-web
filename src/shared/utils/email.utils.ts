import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.AWS_REGION, // e.g., "us-east-1"
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function sendVerificationEmail(email: string, token: string) {
  const verificationUrl = `http://localhost:3000/api/user/verify?token=${token}`;
  const params = {
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: `<p>Click <a href="${verificationUrl}">here</a> to verify your account.</p>`,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: "Verify your account",
      },
    },
    Source: process.env.SES_FROM_EMAIL!, // Must be a verified SES sender
  };

  const command = new SendEmailCommand(params);
  await ses.send(command);
}