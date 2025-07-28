import { BaseException } from './base.exception';

export class ForbiddenException extends BaseException {
  statusCode = 403;
  status = 'forbidden';
  
  constructor(message: string = 'Forbidden') {
    super(message);
  }
}