import { BaseException } from './base.exception';

export class NotFoundException extends BaseException {
  statusCode = 404;
  status = 'fail';

  constructor(resource: string, identifier?: string) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message);
  }
}