import { BaseException } from './base.exception';

export class BadRequestException extends BaseException {
  statusCode = 400;
  status = 'fail';

  constructor(message: string, details?: any) {
    super(message, details);
  }
}