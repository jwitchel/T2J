import _ from 'highland';
import { ParsedMail } from 'mailparser';
import { realTimeLogger } from './real-time-logger';
import { EmailProcessor, ProcessedEmail, ProcessingContext } from './email-processor';
import { pool } from './db';

// Pipeline configuration from environment
const PIPELINE_CONCURRENCY = parseInt(process.env.EMAIL_PIPELINE_CONCURRENCY || '1', 10);

export interface PipelineOptions {
  userId: string;
  emailAccountId: string;
  batchSize?: number;
  onBatchComplete?: (batch: ProcessedEmail[]) => void;
}

export interface PipelineMetrics {
  processedCount: number;
  errorCount: number;
  startTime: number;
  endTime?: number;
  memoryUsage?: NodeJS.MemoryUsage;
}

export class SentEmailPipeline {
  private metrics: PipelineMetrics;
  private context: ProcessingContext;
  private emailProcessor: EmailProcessor;

  constructor(private options: PipelineOptions) {
    this.emailProcessor = new EmailProcessor(pool);
    this.metrics = {
      processedCount: 0,
      errorCount: 0,
      startTime: Date.now()
    };
    this.context = {
      userId: options.userId,
      emailAccountId: options.emailAccountId
    };
  }

  /**
   * Create a Highland.js pipeline for processing sent emails
   */
  createPipeline(emailStream: Highland.Stream<ParsedMail>): Highland.Stream<ProcessedEmail[]> {
    // Log pipeline start
    realTimeLogger.log(this.options.userId, {
      userId: this.options.userId,
      emailAccountId: this.options.emailAccountId,
      level: 'info',
      command: 'PIPELINE_START',
      data: {
        parsed: {
          concurrency: PIPELINE_CONCURRENCY,
          batchSize: this.options.batchSize || 10
        }
      }
    });

    return _(emailStream)
      // Add logging for each email
      .tap((email: ParsedMail) => {
        realTimeLogger.log(this.options.userId, {
          userId: this.options.userId,
          emailAccountId: this.options.emailAccountId,
          level: 'debug',
          command: 'PIPELINE_EMAIL_IN',
          data: {
            parsed: {
              messageId: email.messageId,
              subject: email.subject,
              date: email.date?.toISOString()
            }
          }
        });
      })
      // Process emails with configurable concurrency (default: 1 for single-stream)
      .map((email: ParsedMail) => {
        return _(this.processEmail(email));
      })
      .parallel(PIPELINE_CONCURRENCY)
      // Handle errors gracefully
      .errors((err: Error, push: (err: Error | null, x?: ProcessedEmail) => void) => {
        this.metrics.errorCount++;
        
        realTimeLogger.log(this.options.userId, {
          userId: this.options.userId,
          emailAccountId: this.options.emailAccountId,
          level: 'error',
          command: 'PIPELINE_ERROR',
          data: {
            error: err.message,
            parsed: {
              errorCount: this.metrics.errorCount
            }
          }
        });
        
        // Continue processing by pushing null (skip failed email)
        push(null, null as any);
      })
      // Filter out nulls from errors
      .compact()
      // Batch results
      .batch(this.options.batchSize || 10)
      // Process batches
      .tap((batch: ProcessedEmail[]) => {
        this.metrics.processedCount += batch.length;
        
        // Log batch completion
        realTimeLogger.log(this.options.userId, {
          userId: this.options.userId,
          emailAccountId: this.options.emailAccountId,
          level: 'info',
          command: 'PIPELINE_BATCH_COMPLETE',
          data: {
            parsed: {
              batchSize: batch.length,
              totalProcessed: this.metrics.processedCount,
              totalErrors: this.metrics.errorCount,
              avgReduction: this.calculateAverageReduction(batch)
            }
          }
        });

        // Call batch completion callback if provided
        if (this.options.onBatchComplete) {
          this.options.onBatchComplete(batch);
        }
      })
      // Implement backpressure handling
      .ratelimit(1, 100); // Process at most 1 batch per 100ms to prevent overwhelming the system
  }

  /**
   * Process a single email
   */
  private async processEmail(email: ParsedMail): Promise<ProcessedEmail | null> {
    try {
      const result = await this.emailProcessor.processEmail(email, this.context);
      return result;
    } catch (error: unknown) {
      // Error is logged in the errors handler
      throw error;
    }
  }

  /**
   * Calculate average text reduction percentage for a batch
   */
  private calculateAverageReduction(batch: ProcessedEmail[]): number {
    if (batch.length === 0) return 0;
    
    // Since we no longer track originalPlainLength, return 0
    // This metric is no longer meaningful without the original length
    return 0;
  }

  /**
   * Complete the pipeline and log final metrics
   */
  complete(): PipelineMetrics {
    this.metrics.endTime = Date.now();
    this.metrics.memoryUsage = process.memoryUsage();
    
    const duration = this.metrics.endTime - this.metrics.startTime;
    const emailsPerSecond = this.metrics.processedCount / (duration / 1000);
    
    realTimeLogger.log(this.options.userId, {
      userId: this.options.userId,
      emailAccountId: this.options.emailAccountId,
      level: 'info',
      command: 'PIPELINE_COMPLETE',
      data: {
        duration,
        parsed: {
          totalProcessed: this.metrics.processedCount,
          totalErrors: this.metrics.errorCount,
          successRate: ((this.metrics.processedCount / (this.metrics.processedCount + this.metrics.errorCount)) * 100).toFixed(2) + '%',
          emailsPerSecond: emailsPerSecond.toFixed(2),
          memoryUsedMB: Math.round(this.metrics.memoryUsage.heapUsed / 1024 / 1024)
        }
      }
    });
    
    return this.metrics;
  }

  /**
   * Get current metrics
   */
  getMetrics(): PipelineMetrics {
    return { ...this.metrics };
  }
}

/**
 * Helper function to create a pipeline from an array of emails
 */
export function createPipelineFromEmails(
  emails: ParsedMail[], 
  options: PipelineOptions
): { stream: Highland.Stream<ProcessedEmail[]>, pipeline: SentEmailPipeline } {
  const pipeline = new SentEmailPipeline(options);
  const stream = pipeline.createPipeline(_(emails));
  
  return { stream, pipeline };
}

/**
 * Helper function to process emails and collect results
 */
export async function processEmailBatch(
  emails: ParsedMail[],
  options: PipelineOptions
): Promise<{ results: ProcessedEmail[], metrics: PipelineMetrics }> {
  const results: ProcessedEmail[] = [];
  const { stream, pipeline } = createPipelineFromEmails(emails, {
    ...options,
    onBatchComplete: (batch) => results.push(...batch)
  });
  
  return new Promise((resolve, reject) => {
    stream
      .collect()
      .toCallback((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          const metrics = pipeline.complete();
          resolve({ results, metrics });
        }
      });
  });
}