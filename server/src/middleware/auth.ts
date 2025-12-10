/// <reference path="../types/express.d.ts" />
import express from 'express';
import { auth } from '../lib/auth';

// Protected route middleware
export const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
  // Check for service token first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    if (token === process.env.SERVICE_TOKEN) {
      // For service token auth, userId must be in the body
      if (!(req.body as any).userId) {
        res.status(400).json({ error: 'userId required when using service token' });
        return;
      }
      req.user = { id: (req.body as any).userId };
      req.isServiceToken = true;
      next();
      return;
    }
  }
  
  try {
    // Regular session-based auth
    
    // Create a headers object that better-auth expects
    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value) {
        headers.set(key, Array.isArray(value) ? value[0] : value);
      }
    });

    const session = await auth.api.getSession({
      headers: headers,
    });

    if (!session) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Add user info to request
    req.user = session.user;
    req.session = session;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Invalid session' });
  }
};