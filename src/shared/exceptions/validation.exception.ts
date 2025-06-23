import { BaseException } from './base.exception';

export class ValidationException extends BaseException {
  statusCode = 400;
  status = 'fail';

  constructor(message: string, details?: any) {
    super(message, details);
  }
}