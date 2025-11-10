export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffFactor?: number;
  onRetry?: (error: Error, attempt: number) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = parseInt(process.env.PIPELINE_RETRY_ATTEMPTS || '3'),
    delayMs = 1000,
    backoffFactor = 2,
    onRetry
  } = options;

  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        throw error;
      }
      
      if (onRetry) {
        onRetry(lastError, attempt);
      }
      
      const delay = delayMs * Math.pow(backoffFactor, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

export function isRetryableError(error: Error): boolean {
  // Network errors, timeouts, and temporary failures
  const retryableMessages = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNRESET',
    'socket hang up',
    'getaddrinfo',
    'connect EHOSTUNREACH'
  ];
  
  return retryableMessages.some(msg => 
    error.message.includes(msg) || error.toString().includes(msg)
  );
}