/**
 * Tests for authentication middleware including service token support
 */

import { Request, Response, NextFunction } from 'express';

// Mock the auth module before importing
jest.mock('../../lib/auth', () => ({
  auth: {
    api: {
      getSession: jest.fn()
    }
  }
}));

import { requireAuth } from '../auth';
import { makeServiceRequest } from '../service-auth';

describe('Authentication Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
      body: {}
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  describe('Service Token Authentication', () => {
    const originalEnv = process.env.SERVICE_TOKEN;

    beforeAll(() => {
      process.env.SERVICE_TOKEN = 'test-service-token-12345';
    });

    afterAll(() => {
      process.env.SERVICE_TOKEN = originalEnv;
    });

    it('should authenticate with valid service token', async () => {
      mockReq.headers = {
        authorization: 'Bearer test-service-token-12345'
      };
      mockReq.body = {
        userId: 'test-user-123'
      };

      await requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as Request).user).toEqual({ id: 'test-user-123' });
      expect((mockReq as Request).isServiceToken).toBe(true);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject invalid service token', async () => {
      mockReq.headers = {
        authorization: 'Bearer wrong-token'
      };
      mockReq.body = {
        userId: 'test-user-123'
      };

      await requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      // The middleware will fall through to regular auth which will fail
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should require userId when using service token', async () => {
      mockReq.headers = {
        authorization: 'Bearer test-service-token-12345'
      };
      mockReq.body = {}; // No userId

      await requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'userId required when using service token'
      });
    });

    it('should handle missing authorization header', async () => {
      mockReq.headers = {};
      mockReq.body = {};

      await requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Authentication required'
      });
    });
  });

  describe('makeServiceRequest Helper', () => {
    const originalEnv = process.env.SERVICE_TOKEN;
    const originalFetch = global.fetch;

    beforeAll(() => {
      process.env.SERVICE_TOKEN = 'test-service-token-12345';
    });

    afterAll(() => {
      process.env.SERVICE_TOKEN = originalEnv;
      global.fetch = originalFetch;
    });

    it('should make authenticated request with service token', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ success: true, data: 'test' })
      };

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const result = await makeServiceRequest(
        'http://localhost:3002/api/test',
        'POST',
        { someData: 'value' },
        'user-123'
      );

      expect(result).toEqual({ success: true, data: 'test' });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3002/api/test',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-service-token-12345'
          },
          body: JSON.stringify({
            someData: 'value',
            userId: 'user-123'
          })
        }
      );
    });

    it('should throw error on failed request', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      };

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      await expect(
        makeServiceRequest(
          'http://localhost:3002/api/test',
          'POST',
          {},
          'user-123'
        )
      ).rejects.toThrow('Not found');
    });

    it('should handle request without additional data', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ success: true })
      };

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const result = await makeServiceRequest(
        'http://localhost:3002/api/test',
        'GET',
        undefined,
        'user-123'
      );

      expect(result).toEqual({ success: true });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3002/api/test',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-service-token-12345'
          },
          body: undefined  // GET requests typically don't have a body
        }
      );
    });
  });
});