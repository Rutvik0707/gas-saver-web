import { ApiResponse } from '../interfaces';

export const apiUtils = {
  /**
   * Create a successful API response
   */
  success<T>(message: string, data?: T): ApiResponse<T> {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Create an error API response
   */
  error(message: string, error?: string): ApiResponse {
    return {
      success: false,
      message,
      error,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Extract pagination parameters from query
   */
  extractPagination(query: any) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
    const offset = (page - 1) * limit;

    return { page, limit, offset };
  },

  /**
   * Create pagination metadata
   */
  createPaginationMeta(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  },
};