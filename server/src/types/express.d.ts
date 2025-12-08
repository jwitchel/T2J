declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
      };
      session?: unknown;
      isServiceToken?: boolean;
    }
  }
}

export {};
