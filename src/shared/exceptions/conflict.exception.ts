import { BaseException } from './base.exception';

export class ConflictException extends BaseException {
  statusCode = 409;
  status = 'fail';

  constructor(message: string) {
    super(message);
  }
}