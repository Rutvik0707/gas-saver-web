import { BaseException } from './base.exception';

export class InternalServerException extends BaseException {
  statusCode = 500;
  status = 'error';

  constructor(message: string, details?: any) {
    super(message, details);
  }
}