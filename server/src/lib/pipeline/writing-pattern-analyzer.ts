import { LLMClient } from '../llm-client';
import { ProcessedEmail } from './types';
import { pool as db } from '../db';
import { realTimeLogger } from '../real-time-logger';
import { TemplateManager } from './template-manager';
import { decryptPassword } from '../crypto';
import { nameRedactor } from '../name-redactor';
import nlp from 'compromise';
import sentencesPlugin from 'compromise-sentences';
import * as ss from 'simple-statistics';

// Extend compromise with sentence plugin
nlp.plugin(sentencesPlugin);

// Pattern data structures that match what we'll store in JSONB
export interface SentencePatterns {
  avgLength: number;
  medianLength: number;  // More robust to outliers
  trimmedMean: number;   // Mean after removing top/bottom 5%
  minLength: number;
  maxLength: number;
  stdDeviation: number;
  percentile25: number;  // 25th percentile
  percentile75: number;  // 75th percentile
  distribution: {
    short: number;    // <10 words
    medium: number;   // 10-25 words
    long: number;     // >25 words
  };
  examples: string[];
}

export interface ParagraphPattern {
  type: string;
  percentage: number;
  description: string;
}

// All distribution patterns use 'percentage' stored as decimal 0.0-1.0
export interface OpeningPattern {
  pattern: string;
  percentage: number;  // Changed from frequency to percentage for consistency
  notes?: string;
}

export interface ValedictionPattern {
  phrase: string;
  percentage: number;  // Stored as decimal 0.0-1.0, displayed as percentage
}


export interface NegativePattern {
  description: string;
  confidence: number;
  examples?: string[];
  context?: string;
}

export interface ResponsePatterns {
  immediate: number;
  contemplative: number;
  questionHandling: string;
}

export interface UniqueExpression {
  phrase: string;
  context: string;
  occurrenceRate: number;  // Changed from frequency to occurrenceRate for clarity
}

export interface WritingPatterns {
  sentencePatterns: SentencePatterns;
  paragraphPatterns: ParagraphPattern[];
  openingPatterns: OpeningPattern[];
  valediction: ValedictionPattern[];
  negativePatterns: NegativePattern[];
  responsePatterns: ResponsePatterns;
  uniqueExpressions: UniqueExpression[];
}

export interface BatchAnalysisResult extends WritingPatterns {
  emailCount: number;
  dateRange: {
    start: Date;
    end: Date;
  };
}

export class WritingPatternAnalyzer {
  private llmClient: LLMClient | null = null;
  private templateManager: TemplateManager;
  private modelName: string = '';

  constructor() {
    this.templateManager = new TemplateManager();
  }

  /**
   * Load sentence statistics from the database if available
   */
  public async loadSentenceStats(
    userId: string,
    relationship: string
  ): Promise<SentencePatterns | null> {
    try {
      const query = `
        SELECT profile_data->'sentenceStats' as sentence_stats
        FROM tone_preferences
        WHERE user_id = $1 
          AND preference_type = 'category'
          AND target_identifier = $2
      `;
      
      const result = await db.query(query, [userId, relationship]);
      
      if (result.rows.length > 0 && result.rows[0].sentence_stats) {
        const stats = result.rows[0].sentence_stats;
        console.log(`[SentenceStats] Loaded from cache for ${relationship}:`, {
          hasMedian: !!stats.medianLength,
          hasTrimmedMean: !!stats.trimmedMean,
          hasPercentiles: !!(stats.percentile25 && stats.percentile75),
          avgLength: stats.avgLength,
          medianLength: stats.medianLength,
          trimmedMean: stats.trimmedMean
        });
        return {
          avgLength: stats.avgLength,
          medianLength: stats.medianLength || stats.avgLength, // Fallback for old data
          trimmedMean: stats.trimmedMean || stats.avgLength,   // Fallback for old data
          minLength: stats.minLength,
          maxLength: stats.maxLength,
          stdDeviation: stats.stdDeviation,
          percentile25: stats.percentile25 || stats.minLength, // Fallback for old data
          percentile75: stats.percentile75 || stats.maxLength, // Fallback for old data
          distribution: stats.distribution,
          examples: [] // Required by interface
        };
      }
    } catch (error: unknown) {
      console.error('Failed to load sentence stats:', error);
    }
    
    return null;
  }

  /**
   * Store sentence statistics in the database
   */
  async storeSentenceStats(
    userId: string,
    relationship: string,
    stats: SentencePatterns & { totalSentences?: number }
  ): Promise<void> {
    try {
      // Update the profile_data JSONB field with sentence stats
      const query = `
        UPDATE tone_preferences
        SET 
          profile_data = jsonb_set(
            COALESCE(profile_data, '{}'),
            '{sentenceStats}',
            $1::jsonb,
            true
          ),
          updated_at = NOW()
        WHERE user_id = $2 
          AND preference_type = 'category'
          AND target_identifier = $3
      `;
      
      const statsWithMetadata = {
        avgLength: stats.avgLength,
        medianLength: stats.medianLength,
        trimmedMean: stats.trimmedMean,
        minLength: stats.minLength,
        maxLength: stats.maxLength,
        stdDeviation: stats.stdDeviation,
        percentile25: stats.percentile25,
        percentile75: stats.percentile75,
        distribution: stats.distribution,
        totalSentences: stats.totalSentences || 0,
        lastCalculated: new Date().toISOString()
      };
      
      await db.query(query, [
        JSON.stringify(statsWithMetadata),
        userId,
        relationship
      ]);
      
      console.log(`Stored sentence stats for ${userId}/${relationship} in database`);
    } catch (error: unknown) {
      console.error('Failed to store sentence stats:', error);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Calculate sentence statistics directly from email texts
   * This replaces the LLM-based calculation for accuracy
   *
   * @param userId User ID
   * @param relationship Relationship type (or 'aggregate' for all)
   * @param styleClusterName Optional: Filter by style cluster (e.g., 'formal', 'casual')
   */
  async calculateSentenceStats(
    userId: string,
    relationship: string,
    styleClusterName?: string
  ): Promise<SentencePatterns> {
    // Try to load from cache first (outside transaction)
    const cached = await this.loadSentenceStats(userId, relationship);
    if (cached) {
      return cached;
    }

    // Use advisory lock to prevent duplicate calculations across processes
    // Advisory locks are lightweight and don't require a row to exist
    const lockKey = this.getAdvisoryLockKey(userId, relationship);

    try {
      // Try to acquire advisory lock (non-blocking)
      const lockResult = await db.query('SELECT pg_try_advisory_lock($1)', [lockKey]);
      const lockAcquired = lockResult.rows[0]?.pg_try_advisory_lock;

      if (!lockAcquired) {
        // Someone else is calculating, wait and retry cache
        console.log(`[SentenceStats] Another process is calculating for ${relationship}, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        const cachedAfterWait = await this.loadSentenceStats(userId, relationship);
        if (cachedAfterWait) {
          console.log(`[SentenceStats] Cache hit after wait for ${relationship}`);
          return cachedAfterWait;
        }
        // If still no cache after wait, try to acquire lock ourselves
        const retryLock = await db.query('SELECT pg_try_advisory_lock($1)', [lockKey]);
        if (!retryLock.rows[0]?.pg_try_advisory_lock) {
          console.log(`[SentenceStats] Still locked, calculating anyway for ${relationship}`);
        }
      }

      // Double-check cache after acquiring lock
      const cachedAfterLock = await this.loadSentenceStats(userId, relationship);
      if (cachedAfterLock) {
        console.log(`[SentenceStats] Cache hit after lock for ${relationship}`);
        return cachedAfterLock;
      }

      // Fetch emails for this relationship from PostgreSQL
      const emails = await this._fetchEmailsFromPostgres(userId, relationship, styleClusterName);

    console.log(`[SentenceStats] Fetched ${emails.length} emails for ${relationship === 'aggregate' ? 'ALL relationships (aggregate)' : relationship}${styleClusterName ? ` (style: ${styleClusterName})` : ''}`);

    if (emails.length === 0) {
      return {
        avgLength: 0,
        medianLength: 0,
        trimmedMean: 0,
        minLength: 0,
        maxLength: 0,
        stdDeviation: 0,
        percentile25: 0,
        percentile75: 0,
        distribution: { short: 0, medium: 0, long: 0 },
        examples: [] // Required by interface
      };
    }
    
    // Collect all sentences from userReply texts
    const allSentences: string[] = [];
    // Array where each element is the word count of a sentence
    // e.g., [5, 10, 7] means 3 sentences with 5, 10, and 7 words respectively
    const wordCountsPerSentence: number[] = [];
    
    emails.forEach(email => {
      const userReply = email.metadata.userReply || '';
      if (!userReply || userReply === '[ForwardedWithoutComment]') return;
      
      // Use compromise to split into sentences
      const doc = nlp(userReply);
      const sentences = doc.sentences();
      
      sentences.forEach((sentence: any) => {
        const text = sentence.text().trim();
        if (text.length > 0) {
          allSentences.push(text);
          // Use compromise's wordCount method
          const wordCount = sentence.wordCount();
          wordCountsPerSentence.push(wordCount);
        }
      });
    });
    
    if (wordCountsPerSentence.length === 0) {
      return {
        avgLength: 0,
        medianLength: 0,
        trimmedMean: 0,
        minLength: 0,
        maxLength: 0,
        stdDeviation: 0,
        percentile25: 0,
        percentile75: 0,
        distribution: { short: 0, medium: 0, long: 0 },
        examples: [] // Required by interface
      };
    }
    
    // Sort for median and percentile calculations
    const sortedCounts = [...wordCountsPerSentence].sort((a, b) => a - b);
    
    // Calculate statistics using simple-statistics
    const avgLength = ss.mean(wordCountsPerSentence);
    const medianLength = ss.median(sortedCounts);
    const minLength = ss.min(wordCountsPerSentence);
    const maxLength = ss.max(wordCountsPerSentence);
    const stdDeviation = ss.standardDeviation(wordCountsPerSentence);
    const percentile25 = ss.quantile(sortedCounts, 0.25);
    const percentile75 = ss.quantile(sortedCounts, 0.75);
    
    // Calculate trimmed mean (remove top and bottom 5%)
    const trimAmount = Math.floor(sortedCounts.length * 0.05);
    const trimmedData = trimAmount > 0 
      ? sortedCounts.slice(trimAmount, sortedCounts.length - trimAmount)
      : sortedCounts;
    const trimmedMean = trimmedData.length > 0 ? ss.mean(trimmedData) : avgLength;
    
    // Calculate distribution
    const shortCount = wordCountsPerSentence.filter(c => c < 10).length;
    const mediumCount = wordCountsPerSentence.filter(c => c >= 10 && c <= 25).length;
    const longCount = wordCountsPerSentence.filter(c => c > 25).length;
    const totalSentenceCount = wordCountsPerSentence.length;
    
    const distribution = {
      short: shortCount / totalSentenceCount,
      medium: mediumCount / totalSentenceCount,
      long: longCount / totalSentenceCount
    };
    
    const result: SentencePatterns = {
      avgLength: Math.round(avgLength * 100) / 100,
      medianLength: Math.round(medianLength * 100) / 100,
      trimmedMean: Math.round(trimmedMean * 100) / 100,
      minLength,
      maxLength,
      stdDeviation: Math.round(stdDeviation * 100) / 100,
      percentile25: Math.round(percentile25 * 100) / 100,
      percentile75: Math.round(percentile75 * 100) / 100,
      distribution,
      examples: [] // Required by interface but not used
    };
    
    // Debug logging
    console.log(`[SentenceStats] Calculated for ${relationship}:`, {
      totalSentences: wordCountsPerSentence.length,
      avgLength: result.avgLength,
      medianLength: result.medianLength,
      trimmedMean: result.trimmedMean,
      percentiles: `${result.percentile25} - ${result.percentile75}`,
      range: `${result.minLength} - ${result.maxLength}`,
      stdDev: result.stdDeviation
    });
    
      // Store the stats in the database
      await this.storeSentenceStats(userId, relationship, {
        ...result,
        totalSentences: totalSentenceCount  // Now it's clear this is the count of sentences
      } as any);

      return result;
    } finally {
      // Always release the advisory lock
      try {
        await db.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      } catch (error) {
        console.error(`[SentenceStats] Failed to release lock for ${relationship}:`, error);
      }
    }
  }

  /**
   * Generate advisory lock key from userId and relationship
   * PostgreSQL advisory locks use bigint, so we hash the strings to a 64-bit integer
   * @private
   */
  private getAdvisoryLockKey(userId: string, relationship: string): number {
    // Simple hash function to convert string to integer
    // We use a combination of userId and relationship to ensure uniqueness
    const str = `${userId}:${relationship}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Ensure positive integer for PostgreSQL advisory lock
    return Math.abs(hash);
  }

  /**
   * Fetch emails from PostgreSQL with optional style cluster filtering
   *
   * Purpose: Replace VectorStore.getByRelationship with direct PostgreSQL query
   * @private
   */
  private async _fetchEmailsFromPostgres(
    userId: string,
    relationship: string,
    styleClusterName?: string
  ): Promise<Array<{ metadata: { userReply: string; sentDate: Date } }>> {
    try {
      let query = `
        SELECT se.user_reply, se.sent_date
        FROM email_sent se
        WHERE se.user_id = $1
          AND se.semantic_vector IS NOT NULL
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      // Filter by relationship if not aggregate
      if (relationship && relationship !== 'aggregate') {
        paramCount++;
        query += ` AND se.relationship_type = $${paramCount}`;
        params.push(relationship);
      }

      // Filter by style cluster if specified
      if (styleClusterName) {
        query += `
          AND se.id IN (
            SELECT esm.email_id
            FROM email_style_mapping esm
            JOIN style_clusters sc ON esm.style_cluster_id = sc.id
            WHERE sc.cluster_name = $${paramCount + 1}
          )
        `;
        paramCount++;
        params.push(styleClusterName);
      }

      query += ' ORDER BY se.sent_date DESC LIMIT 1000';

      const result = await db.query(query, params);

      return result.rows.map(row => ({
        metadata: {
          userReply: row.user_reply,
          sentDate: row.sent_date
        }
      }));

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch emails from PostgreSQL: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Recursively round all numeric values in an object to specified decimal places
   */
  private roundNumericValues(obj: any, decimals: number = 2): any {
    if (typeof obj === 'number') {
      return Math.round(obj * Math.pow(10, decimals)) / Math.pow(10, decimals);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.roundNumericValues(item, decimals));
    }
    
    if (obj !== null && typeof obj === 'object') {
      const rounded: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          rounded[key] = this.roundNumericValues(obj[key], decimals);
        }
      }
      return rounded;
    }
    
    return obj;
  }

  /**
   * Get the model name being used
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Initialize with LLM configuration
   */
  public async initialize(llmProviderId?: string): Promise<void> {
    // Initialize template manager
    await this.templateManager.initialize();
    // Get LLM provider configuration using raw SQL
    let query = `
      SELECT id, provider_name, provider_type, api_key_encrypted as api_key, api_endpoint, 
             model_name, is_active, is_default, created_at
      FROM llm_providers 
      WHERE is_active = true
    `;
    const params: any[] = [];
    
    if (llmProviderId) {
      query += ' AND id = $1';
      params.push(llmProviderId);
    } else {
      // First try to get default, then fall back to any active provider
      query += ' ORDER BY is_default DESC, created_at DESC';
    }
    
    query += ' LIMIT 1';
    
    const result = await db.query(query, params);
    const provider = result.rows[0];

    if (!provider) {
      throw new Error('No active LLM provider found');
    }

    // Check if API key exists
    if (!provider.api_key) {
      console.error('LLM provider has no API key:', provider.provider_name);
      throw new Error(`LLM provider "${provider.provider_name}" has no API key configured`);
    }

    // Decrypt the API key
    let decryptedApiKey = '';
    try {
      decryptedApiKey = decryptPassword(provider.api_key);
    } catch (error: unknown) {
      console.error('Failed to decrypt API key:', error);
      throw new Error('Failed to decrypt LLM provider API key');
    }

    this.modelName = provider.model_name || '';
    this.llmClient = new LLMClient({
      id: provider.id,
      type: provider.provider_type as any,
      apiKey: decryptedApiKey,
      apiEndpoint: provider.api_endpoint || undefined,
      modelName: provider.model_name
    });
  }

  /**
   * Main entry point - analyze writing patterns from email corpus
   */
  public async analyzeWritingPatterns(
    userId: string,
    emails: ProcessedEmail[],
    relationship?: string
  ): Promise<WritingPatterns> {
    if (!this.llmClient) {
      throw new Error('WritingPatternAnalyzer not initialized');
    }

    const startTime = Date.now();

    // Log the analysis start
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-analysis',
      level: 'info',
      command: 'pattern.analysis.start',
      data: {
        raw: `Analyzing ${emails.length} emails for ${relationship || 'all relationships'}`
      }
    });

    // Process in batches of 50 emails
    const batchSize = 50;
    const batches = this.chunkEmails(emails, batchSize);
    
    console.log(`Analyzing ${emails.length} emails in ${batches.length} batches...`);

    const batchAnalyses: BatchAnalysisResult[] = [];
    let successfulBatches = 0;
    let failedBatches = 0;
    
    for (let i = 0; i < batches.length; i++) {
      console.log(`Processing batch ${i + 1}/${batches.length}...`);
      
      try {
        const analysis = await this.analyzeBatch(batches[i], relationship);
        batchAnalyses.push(analysis);
        successfulBatches++;
      } catch (error: unknown) {
        console.error(`Error analyzing batch ${i + 1}:`, error);
        failedBatches++;
        // Continue with other batches even if one fails
      }
    }

    if (batchAnalyses.length === 0) {
      throw new Error('Failed to analyze any email batches');
    }

    // Aggregate patterns across all batches
    const aggregated = this.aggregatePatterns(batchAnalyses);
    
    // Calculate sentence statistics directly from emails for accuracy
    // Always calculate, even for aggregate (when relationship is undefined)
    const relationshipLabel = relationship || 'aggregate';
    console.log(`Calculating sentence statistics directly for ${relationshipLabel}...`);
    const directSentenceStats = await this.calculateSentenceStats(userId, relationship || 'aggregate');
    
    // Replace LLM-calculated sentence stats with direct calculation
    aggregated.sentencePatterns = directSentenceStats;
    
    console.log(`Direct sentence stats for ${relationshipLabel}: avg=${directSentenceStats.avgLength}, median=${directSentenceStats.medianLength}, trimmed=${directSentenceStats.trimmedMean}, min=${directSentenceStats.minLength}, max=${directSentenceStats.maxLength}, std=${directSentenceStats.stdDeviation}`);

    // Round all numeric values to 2 decimal places
    const roundedPatterns = this.roundNumericValues(aggregated) as WritingPatterns;

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    // Log completion with metadata
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-analysis',
      level: 'info',
      command: 'pattern.analysis.complete',
      data: {
        raw: `Found ${roundedPatterns.openingPatterns.length} opening patterns, ${roundedPatterns.valediction.length} valedictions, ${roundedPatterns.negativePatterns.length} negative patterns, ${roundedPatterns.uniqueExpressions.length} unique expressions`,
        parsed: {
          totalEmails: emails.length,
          batchSize,
          totalBatches: batches.length,
          successfulBatches,
          failedBatches,
          durationSeconds: duration,
          relationship: relationship || 'aggregate',
          patterns: {
            openings: roundedPatterns.openingPatterns.length,
            valedictions: roundedPatterns.valediction.length,
            negative: roundedPatterns.negativePatterns.length,
            unique: roundedPatterns.uniqueExpressions.length
          }
        }
      }
    });

    return roundedPatterns;
  }

  /**
   * Analyze a single batch of emails
   */
  private async analyzeBatch(
    emails: ProcessedEmail[],
    relationship?: string
  ): Promise<BatchAnalysisResult> {
    if (!this.llmClient) {
      throw new Error('LLM client not initialized');
    }

    // Prepare email content for analysis with name redaction
    let totalNamesRedacted = 0;
    const emailTexts = emails.map(email => {
      // Redact names from the email content
      const redactionResult = nameRedactor.redactNames(email.userReply);
      totalNamesRedacted += redactionResult.namesFound.length;
      
      return {
        date: email.date.toISOString(),
        to: email.to.map(t => t.address).join(', '),
        subject: email.subject,
        content: redactionResult.text,
        // Store original names for reference (not sent to LLM)
        _originalNames: redactionResult.namesFound
      };
    });
    
    // Log redaction statistics
    if (totalNamesRedacted > 0) {
      console.log(`[Pattern Analysis] Redacted ${totalNamesRedacted} names from ${emails.length} emails`);
    }

    // Prepare template data
    const templateData = {
      emailCount: emails.length,
      relationship: relationship,
      emails: emailTexts
    };

    // Generate prompts using templates
    const [systemPrompt, userPrompt] = await Promise.all([
      this.templateManager.renderSystemPrompt('pattern-analysis'),
      this.templateManager.renderPrompt('pattern-analysis', templateData as any)
    ]);
    
    // Call LLM with structured output expectation
    // Adjust max tokens based on model limits
    const requestedMaxTokens = parseInt(process.env.PATTERN_ANALYSIS_MAX_TOKENS || '20000');
    const modelNameLower = this.modelName.toLowerCase();
    
    // Known model limits for completion tokens
    let maxTokens = requestedMaxTokens;
    if (modelNameLower.includes('gpt-4-turbo-preview') || modelNameLower.includes('gpt-4-0125-preview')) {
      maxTokens = Math.min(requestedMaxTokens, 4096);
    } else if (modelNameLower.includes('gpt-3.5')) {
      maxTokens = Math.min(requestedMaxTokens, 4096);
    } else if (modelNameLower.includes('claude-3')) {
      maxTokens = Math.min(requestedMaxTokens, 4096);
    } else if (modelNameLower.includes('gpt-4o')) {
      maxTokens = Math.min(requestedMaxTokens, 16384);
    }
    // For other models, use the requested amount
    
    console.log(`Pattern analysis using ${maxTokens} max tokens for model: ${this.modelName}`);
    
    const response = await this.llmClient.generate(userPrompt, {
      temperature: 0.3, // Lower temperature for more consistent analysis
      maxTokens,
      systemPrompt
    });

    // Parse the response
    try {
      // Extract JSON from response, handling various formats
      let cleanResponse = response.trim();
      
      // Try to find JSON content within the response
      // First, check if entire response is wrapped in markdown
      const markdownJsonMatch = cleanResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (markdownJsonMatch) {
        cleanResponse = markdownJsonMatch[1].trim();
      }
      
      // If still not valid JSON, try to extract JSON object
      if (!cleanResponse.startsWith('{')) {
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanResponse = jsonMatch[0];
        }
      }
      
      const parsed = JSON.parse(cleanResponse);
      
      // Add metadata
      return {
        ...parsed,
        emailCount: emails.length,
        dateRange: {
          start: emails[0].date,
          end: emails[emails.length - 1].date
        }
      };
    } catch (error: unknown) {
      console.error('Failed to parse LLM response:', response);
      throw new Error('Invalid response format from LLM');
    }
  }

  // Remove buildAnalysisPrompt method - no longer needed since we use templates

  /**
   * Chunk emails into batches
   */
  private chunkEmails(emails: ProcessedEmail[], batchSize: number): ProcessedEmail[][] {
    const chunks: ProcessedEmail[][] = [];
    for (let i = 0; i < emails.length; i += batchSize) {
      chunks.push(emails.slice(i, i + batchSize));
    }
    return chunks;
  }

  /**
   * Aggregate patterns from multiple batches
   * - Weights patterns by email count only
   * - Handles relationship-specific variations
   * - Identifies context-dependent patterns
   */
  private aggregatePatterns(batchResults: BatchAnalysisResult[]): WritingPatterns {
    if (batchResults.length === 1) {
      // If only one batch, return it directly
      const { emailCount, dateRange, ...patterns } = batchResults[0];
      return patterns;
    }

    // Calculate weights based on email count only
    const batchWeights = batchResults.map(batch => {
      return {
        batch,
        weight: batch.emailCount
      };
    });
    
    // Aggregate sentence patterns with email count weighting
    // NOTE: Median, percentiles, and trimmed mean CANNOT be calculated by averaging!
    // These are overwritten later by calculateSentenceStats() which recalculates from raw data
    const sentencePatterns: SentencePatterns = {
      avgLength: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.sentencePatterns.avgLength, 
          weight 
        }))
      ),
      medianLength: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.sentencePatterns.medianLength || batch.sentencePatterns.avgLength, 
          weight 
        }))
      ),
      trimmedMean: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.sentencePatterns.trimmedMean || batch.sentencePatterns.avgLength, 
          weight 
        }))
      ),
      minLength: Math.min(...batchResults.map(b => b.sentencePatterns.minLength)),
      maxLength: Math.max(...batchResults.map(b => b.sentencePatterns.maxLength)),
      stdDeviation: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.sentencePatterns.stdDeviation, 
          weight 
        }))
      ),
      percentile25: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.sentencePatterns.percentile25 || batch.sentencePatterns.minLength, 
          weight 
        }))
      ),
      percentile75: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.sentencePatterns.percentile75 || batch.sentencePatterns.maxLength, 
          weight 
        }))
      ),
      distribution: {
        short: this.weightedAverage(
          batchWeights.map(({ batch, weight }) => ({ 
            value: batch.sentencePatterns.distribution.short, 
            weight 
          }))
        ),
        medium: this.weightedAverage(
          batchWeights.map(({ batch, weight }) => ({ 
            value: batch.sentencePatterns.distribution.medium, 
            weight 
          }))
        ),
        long: this.weightedAverage(
          batchWeights.map(({ batch, weight }) => ({ 
            value: batch.sentencePatterns.distribution.long, 
            weight 
          }))
        )
      },
      examples: this.mergeExamples(batchWeights)
    };

    // Aggregate paragraph patterns with email count weighting
    const paragraphPatterns = this.mergePatternsByType(
      batchWeights.map(({ batch, weight }) => ({ 
        patterns: batch.paragraphPatterns, 
        weight 
      }))
    );

    // Aggregate opening patterns with context awareness
    const openingPatterns = this.mergePatternsByFrequency(
      batchWeights.map(({ batch, weight }) => ({ 
        patterns: batch.openingPatterns, 
        weight 
      }))
    );

    // Aggregate negative patterns (union of all, keep highest confidence)
    const negativePatterns = this.mergeNegativePatterns(
      batchResults.map(b => b.negativePatterns)
    );

    // Aggregate response patterns with email count weighting
    const responsePatterns: ResponsePatterns = {
      immediate: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.responsePatterns.immediate, 
          weight 
        }))
      ),
      contemplative: this.weightedAverage(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.responsePatterns.contemplative, 
          weight 
        }))
      ),
      questionHandling: this.mostCommonStringWeighted(
        batchWeights.map(({ batch, weight }) => ({ 
          value: batch.responsePatterns.questionHandling, 
          weight 
        }))
      )
    };

    // Aggregate unique expressions with context awareness
    const uniqueExpressions = this.mergeUniqueExpressions(
      batchWeights.map(({ batch, weight }) => ({ 
        expressions: batch.uniqueExpressions, 
        weight 
      }))
    );

    // Aggregate valediction patterns
    const valediction = this.mergePercentagePatterns(
      batchWeights.map(({ batch, weight }) => ({ 
        patterns: batch.valediction || [], 
        weight 
      }))
    );


    return {
      sentencePatterns,
      paragraphPatterns,
      openingPatterns,
      valediction,
      negativePatterns,
      responsePatterns,
      uniqueExpressions
    };
  }

  // Helper methods for aggregation
  private weightedAverage(items: { value: number; weight: number }[]): number {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    const weightedSum = items.reduce((sum, item) => sum + item.value * item.weight, 0);
    return weightedSum / totalWeight;
  }


  private mergeExamples(
    batchWeights: { batch: BatchAnalysisResult; weight: number }[]
  ): string[] {
    // Collect examples with their weights
    const examplesWithWeights: { example: string; weight: number }[] = [];
    
    batchWeights.forEach(({ batch, weight }) => {
      batch.sentencePatterns.examples.forEach(example => {
        examplesWithWeights.push({ example, weight });
      });
    });
    
    // Sort by weight (prioritize examples from larger batches) and deduplicate
    const uniqueExamples = new Map<string, number>();
    examplesWithWeights
      .sort((a, b) => b.weight - a.weight)
      .forEach(({ example, weight }) => {
        if (!uniqueExamples.has(example)) {
          uniqueExamples.set(example, weight);
        }
      });
    
    // Return top N examples
    const exampleCount = parseInt(process.env.PATTERN_EXAMPLE_COUNT || '10');
    return Array.from(uniqueExamples.keys()).slice(0, exampleCount);
  }

  private mergePatternsByType(
    batchData: { patterns: ParagraphPattern[]; weight: number }[]
  ): ParagraphPattern[] {
    const merged = new Map<string, { totalPercentage: number; totalWeight: number; description: string }>();
    
    batchData.forEach(({ patterns, weight }) => {
      patterns.forEach(pattern => {
        const existing = merged.get(pattern.type) || { totalPercentage: 0, totalWeight: 0, description: pattern.description };
        existing.totalPercentage += pattern.percentage * weight;
        existing.totalWeight += weight;
        merged.set(pattern.type, existing);
      });
    });

    const patterns = Array.from(merged.entries())
      .map(([type, data]) => ({
        type,
        percentage: Math.round(data.totalPercentage / data.totalWeight),
        description: data.description
      }))
      .sort((a, b) => b.percentage - a.percentage);
    
    // Ensure we always have at least one pattern
    if (patterns.length === 0) {
      patterns.push({
        type: 'mixed',
        percentage: 100,
        description: 'Varies between different response formats'
      });
    }
    
    return patterns;
  }

  private mergePatternsByFrequency<T extends { pattern: string; frequency?: number; percentage?: number }>(
    batchData: { patterns: T[]; weight: number }[]
  ): T[] {
    const merged = new Map<string, { 
      totalFreq: number; 
      totalWeight: number; 
      original: T;
      contexts: Set<string>;
    }>();
    
    batchData.forEach(({ patterns, weight }) => {
      patterns.forEach(pattern => {
        // Support both frequency and percentage fields during transition
        const freq = pattern.frequency ?? pattern.percentage ?? 0;
        const existing = merged.get(pattern.pattern);
        if (existing) {
          existing.totalFreq += freq * weight;
          existing.totalWeight += weight;
          // Track context variations if pattern has notes
          if ('notes' in pattern && (pattern as any).notes) {
            existing.contexts.add((pattern as any).notes);
          }
        } else {
          merged.set(pattern.pattern, {
            totalFreq: freq * weight,
            totalWeight: weight,
            original: pattern,
            contexts: new Set('notes' in pattern && (pattern as any).notes ? [(pattern as any).notes] : [])
          });
        }
      });
    });

    // Calculate raw percentages first
    const rawPatterns = Array.from(merged.values())
      .map(data => {
        const result: any = {
          ...data.original,
          percentage: data.totalFreq / data.totalWeight  // Use percentage for consistency
        };
        delete result.frequency;  // Remove old frequency field
        // Add context information if multiple contexts found
        if (data.contexts.size > 1 && 'notes' in result) {
          result.notes = `Used in ${data.contexts.size} different contexts`;
        }
        return result;
      })
      .sort((a, b) => b.percentage - a.percentage);
    
    // Normalize to ensure sum equals 1.0
    const sum = rawPatterns.reduce((acc, p) => acc + p.percentage, 0);
    if (sum > 0) {
      return rawPatterns.map(p => ({
        ...p,
        percentage: this.roundNumericValues(p.percentage / sum, 4) as number
      }));
    }
    
    return rawPatterns;
  }

  private mergePercentagePatterns<T extends { phrase: string; percentage: number }>(
    batchData: { patterns: T[]; weight: number }[]
  ): T[] {
    const merged = new Map<string, { 
      totalPercentage: number; 
      totalWeight: number; 
      original: T;
    }>();
    
    batchData.forEach(({ patterns, weight }) => {
      patterns.forEach(pattern => {
        const existing = merged.get(pattern.phrase);
        if (existing) {
          existing.totalPercentage += pattern.percentage * weight;
          existing.totalWeight += weight;
        } else {
          merged.set(pattern.phrase, {
            totalPercentage: pattern.percentage * weight,
            totalWeight: weight,
            original: pattern
          });
        }
      });
    });

    // Calculate raw percentages first
    const rawPatterns = Array.from(merged.values())
      .map(data => ({
        ...data.original,
        percentage: data.totalPercentage / data.totalWeight
      }))
      .sort((a, b) => b.percentage - a.percentage);
    
    // Normalize to ensure sum equals 1.0
    const sum = rawPatterns.reduce((acc, p) => acc + p.percentage, 0);
    if (sum > 0) {
      return rawPatterns.map(p => ({
        ...p,
        percentage: this.roundNumericValues(p.percentage / sum, 4) as number
      }));
    }
    
    return rawPatterns;
  }

  private mergeNegativePatterns(patternArrays: NegativePattern[][]): NegativePattern[] {
    const merged = new Map<string, {
      pattern: NegativePattern;
      occurrences: number;
      contexts: Set<string>;
    }>();
    
    patternArrays.forEach(patterns => {
      patterns.forEach(pattern => {
        // Skip generic template-like patterns
        const genericPatterns = [
          'punctuation patterns like',
          'using all caps',
          'all caps',
          'corporate speak',
          'synergy',
          'circle back',
          'dear',
          'sincerely',
          'best regards',
          'formal greeting',
          'formal sign-off',
          'exclamation marks',
          'multiple exclamation',
          'bullet points',
          'numbered lists',
          'hello',
          'good morning',
          'good afternoon',
          'good evening',
          'regards',
          'kind regards',
          'warm regards',
          'yours truly',
          'respectfully',
          'cordially'
        ];
        
        const isGeneric = genericPatterns.some(generic => 
          pattern.description.toLowerCase().includes(generic.toLowerCase())
        );
        
        if (isGeneric) {
          return; // Skip this pattern
        }
        
        // Create a normalized key to detect duplicates better
        const normalizedKey = pattern.description
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        const existing = merged.get(normalizedKey);
        if (!existing) {
          merged.set(normalizedKey, {
            pattern: { ...pattern },
            occurrences: 1,
            contexts: new Set(pattern.context ? [pattern.context] : [])
          });
        } else {
          existing.occurrences++;
          // Increase confidence with multiple confirmations
          existing.pattern.confidence = Math.min(
            0.99,
            existing.pattern.confidence + (1 - existing.pattern.confidence) * 0.1
          );
          if (pattern.context) {
            existing.contexts.add(pattern.context);
          }
          // Merge examples if available, avoiding duplicates
          if (pattern.examples && existing.pattern.examples) {
            const allExamples = new Set([...existing.pattern.examples, ...pattern.examples]);
            existing.pattern.examples = Array.from(allExamples).slice(0, 3);
          } else if (pattern.examples) {
            existing.pattern.examples = pattern.examples;
          }
        }
      });
    });

    // Include patterns that appear in multiple batches or have high confidence
    return Array.from(merged.values())
      .filter(({ occurrences, pattern }) => 
        occurrences > 1 || pattern.confidence > 0.8
      )
      .map(({ pattern, contexts }) => {
        // Add context variation note if applicable
        if (contexts.size > 1) {
          pattern.context = `Applies across ${contexts.size} different contexts`;
        }
        return pattern;
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10); // Limit to top 10 most confident patterns
  }

  private mergeUniqueExpressions(
    batchData: { expressions: UniqueExpression[]; weight: number }[]
  ): UniqueExpression[] {
    const merged = new Map<string, { 
      totalFreq: number; 
      totalWeight: number; 
      contexts: Map<string, number>; // Context -> weighted frequency
      relationshipTypes: Set<string>;
      originalPhrase: string; // Preserve original casing
    }>();
    
    batchData.forEach(({ expressions, weight }) => {
      expressions.forEach(expr => {
        const key = expr.phrase.toLowerCase();
        const existing = merged.get(key);
        // Support both frequency and occurrenceRate fields during transition
        const rate = (expr as any).frequency ?? expr.occurrenceRate ?? 0;
        if (existing) {
          existing.totalFreq += rate * weight;
          existing.totalWeight += weight;
          // Track context frequency
          const contextWeight = existing.contexts.get(expr.context) || 0;
          existing.contexts.set(expr.context, contextWeight + weight);
          // Track that this expression is used in multiple contexts
          // No hardcoded relationship keywords - relationships are dynamic
        } else {
          merged.set(key, {
            totalFreq: rate * weight,
            totalWeight: weight,
            contexts: new Map([[expr.context, weight]]),
            relationshipTypes: new Set(),  // Relationships come from actual data, not keywords
            originalPhrase: expr.phrase
          });
        }
      });
    });

    return Array.from(merged.entries())
      .map(([_, data]) => {
        // Find primary context (most weighted)
        let primaryContext = '';
        let maxWeight = 0;
        data.contexts.forEach((weight, context) => {
          if (weight > maxWeight) {
            maxWeight = weight;
            primaryContext = context;
          }
        });
        
        // Add context variation note
        if (data.contexts.size > 2) {
          primaryContext += ` (used in ${data.contexts.size} contexts)`;
        }
        
        return {
          phrase: data.originalPhrase,
          context: primaryContext,
          occurrenceRate: this.roundNumericValues(data.totalFreq / data.totalWeight, 4) as number
        };
      })
      .sort((a, b) => b.occurrenceRate - a.occurrenceRate)
      .slice(0, parseInt(process.env.PATTERN_UNIQUE_EXPRESSIONS_COUNT || '15'));
  }


  private mostCommonStringWeighted(
    items: { value: string; weight: number }[]
  ): string {
    const weightedCounts = new Map<string, number>();
    
    items.forEach(({ value, weight }) => {
      weightedCounts.set(value, (weightedCounts.get(value) || 0) + weight);
    });
    
    let maxWeight = 0;
    let mostCommon = items[0]?.value || '';
    weightedCounts.forEach((weight, value) => {
      if (weight > maxWeight) {
        maxWeight = weight;
        mostCommon = value;
      }
    });
    
    return mostCommon;
  }

  /**
   * Clear existing patterns for a user
   */
  async clearPatterns(userId: string): Promise<void> {
    const query = `
      DELETE FROM tone_preferences 
      WHERE user_id = $1 
        AND (profile_data->>'writingPatterns' IS NOT NULL 
             OR profile_data->>'sentenceStats' IS NOT NULL)
    `;
    
    await db.query(query, [userId]);
  }

  /**
   * Load patterns from database
   */
  async loadPatterns(
    userId: string,
    relationship?: string
  ): Promise<WritingPatterns | null> {
    const query = `
      SELECT profile_data 
      FROM tone_preferences 
      WHERE user_id = $1 
        AND preference_type = $2 
        AND target_identifier = $3
    `;
    
    const preferenceType = relationship ? 'category' : 'aggregate';
    const targetIdentifier = relationship || 'aggregate';
    
    const result = await db.query(query, [userId, preferenceType, targetIdentifier]);
    if (result.rows.length === 0) {
      return null;
    }

    const data = result.rows[0].profile_data;
    
    if (data?.writingPatterns) {
      return data.writingPatterns as WritingPatterns;
    }
    
    return null;
  }

  /**
   * Save patterns to database
   */
  async savePatterns(
    userId: string,
    patterns: WritingPatterns,
    relationship?: string,
    emailsAnalyzed: number = 1000
  ): Promise<void> {
    const preferenceType = relationship ? 'category' : 'aggregate';
    let targetIdentifier = relationship || 'aggregate';
    let userRelationshipId: string | null = null;
    
    // Create profile data with consistent structure
    const profileData = {
      meta: {
        type: preferenceType,
        lastAnalyzed: new Date().toISOString(),
        emailCount: emailsAnalyzed,
        confidence: emailsAnalyzed > 50 ? 0.95 : 0.8 // Higher confidence with more emails
      },
      writingPatterns: patterns
    };

    if (relationship) {
      // Ensure the relationship exists in user_relationships
      const displayName = relationship.charAt(0).toUpperCase() + relationship.slice(1);
      
      const relationshipResult = await db.query(`
        INSERT INTO user_relationships (user_id, relationship_type, display_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, relationship_type) 
        DO UPDATE SET display_name = $3
        RETURNING id
      `, [userId, relationship, displayName]);
      
      userRelationshipId = relationshipResult.rows[0].id;
    }
    
    // Save to unified tone_preferences table
    const query = `
      INSERT INTO tone_preferences (
        user_id, 
        preference_type, 
        target_identifier,
        user_relationship_id,
        profile_data, 
        emails_analyzed, 
        last_updated
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id, preference_type, target_identifier)
      DO UPDATE SET 
        user_relationship_id = $4,
        profile_data = $5,
        emails_analyzed = $6,
        last_updated = NOW()
    `;
    
    await db.query(query, [
      userId, 
      preferenceType, 
      targetIdentifier,
      userRelationshipId,
      JSON.stringify(profileData), 
      emailsAnalyzed
    ]);
  }
}