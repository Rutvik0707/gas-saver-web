import { BaseException } from './base.exception';

export class UnauthorizedException extends BaseException {
  statusCode = 401;
  status = 'fail';

  constructor(message: string = 'Unauthorized access') {
    super(message);
  }
}