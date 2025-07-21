import { BaseException } from './base.exception';

export class ForbiddenException extends BaseException {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}