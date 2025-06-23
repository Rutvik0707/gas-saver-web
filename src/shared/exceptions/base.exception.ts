export abstract class BaseException extends Error {
  abstract statusCode: number;
  abstract status: string;
  public isOperational: boolean = true;

  constructor(message: string, public details?: any) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}