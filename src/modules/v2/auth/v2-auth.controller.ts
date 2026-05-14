import { Request, Response } from 'express';
import { v2AuthService } from './v2-auth.service';
import { v2RegisterSchema, v2VerifyOtpSchema, v2LoginSchema, v2RequestAccessSchema } from './v2-auth.types';
import { ValidationException } from '../../../shared/exceptions';

export class V2AuthController {
  async register(req: Request, res: Response): Promise<void> {
    const parsed = v2RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.errors[0].message);
    }

    const result = await v2AuthService.register(parsed.data);

    res.status(201).json({
      success: true,
      data: result,
    });
  }

  async verifyOtp(req: Request, res: Response): Promise<void> {
    const parsed = v2VerifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.errors[0].message);
    }

    const result = await v2AuthService.verifyOtp(parsed.data);

    res.status(200).json({
      success: true,
      message: 'Account verified successfully',
      data: result,
    });
  }

  async login(req: Request, res: Response): Promise<void> {
    const parsed = v2LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.errors[0].message);
    }

    const result = await v2AuthService.login(parsed.data);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  }

  async requestAccess(req: Request, res: Response): Promise<void> {
    const parsed = v2RequestAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.errors[0].message);
    }

    const result = await v2AuthService.requestAccess(parsed.data);

    res.status(200).json({ success: true, data: result });
  }

  async me(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const profile = await v2AuthService.getProfile(userId);

    res.status(200).json({
      success: true,
      data: profile,
    });
  }
}

export const v2AuthController = new V2AuthController();
