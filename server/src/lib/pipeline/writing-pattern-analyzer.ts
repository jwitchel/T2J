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
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
    const totalStart = Date.now();
    console.log(`[TIMING] calculateSentenceStats START for ${relationship}`);

    // Try to load from cache first (outside transaction)
    const cacheStart = Date.now();
    const cached = await this.loadSentenceStats(userId, relationship);
    const cacheEnd = Date.now();
    if (cached) {
      console.log(`[TIMING] calculateSentenceStats cache HIT: ${cacheEnd - cacheStart}ms`);
      return cached;
    }
    console.log(`[TIMING] Cache check: ${cacheEnd - cacheStart}ms (MISS)`);

    // Use advisory lock to prevent duplicate calculations across processes
    // Advisory locks are lightweight and don't require a row to exist
    const lockKey = this.getAdvisoryLockKey(userId, relationship);

    try {
      // Try to acquire advisory lock (non-blocking)
      const lockStart = Date.now();
      const lockResult = await db.query('SELECT pg_try_advisory_lock($1)', [lockKey]);
      const lockAcquired = lockResult.rows[0]?.pg_try_advisory_lock;
      const lockEnd = Date.now();
      console.log(`[TIMING] Lock acquisition: ${lockEnd - lockStart}ms (acquired: ${lockAcquired})`);

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
      const fetchStart = Date.now();
      const emails = await this._fetchEmailsFromPostgres(userId, relationship, styleClusterName);
      const fetchEnd = Date.now();
      console.log(`[TIMING] DB fetch: ${fetchEnd - fetchStart}ms, fetched ${emails.length} emails`);

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

    const nlpStart = Date.now();
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
    const nlpEnd = Date.now();
    console.log(`[TIMING] NLP processing (${emails.length} emails): ${nlpEnd - nlpStart}ms, extracted ${wordCountsPerSentence.length} sentences`);
    
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

    // Get sentence length breakpoints from env
    const shortMax = parseInt(process.env.PATTERN_SENTENCE_SHORT_MAX || '10');
    const longMin = parseInt(process.env.PATTERN_SENTENCE_LONG_MIN || '25');

    // Calculate distribution
    const shortCount = wordCountsPerSentence.filter(c => c < shortMax).length;
    const mediumCount = wordCountsPerSentence.filter(c => c >= shortMax && c <= longMin).length;
    const longCount = wordCountsPerSentence.filter(c => c > longMin).length;
    const totalSentenceCount = wordCountsPerSentence.length;

    const distribution = {
      short: shortCount / totalSentenceCount,
      medium: mediumCount / totalSentenceCount,
      long: longCount / totalSentenceCount
    };

    // Select 3-5 example sentences showing variety in length
    const examples: string[] = [];

    // Find indices of sentences at different length percentiles
    const shortSentences = allSentences.filter((_, i) => wordCountsPerSentence[i] < shortMax);
    const mediumSentences = allSentences.filter((_, i) => wordCountsPerSentence[i] >= shortMax && wordCountsPerSentence[i] <= longMin);
    const longSentences = allSentences.filter((_, i) => wordCountsPerSentence[i] > longMin);

    // Add one example from each category if available
    if (shortSentences.length > 0) {
      examples.push(shortSentences[Math.floor(Math.random() * shortSentences.length)]);
    }
    if (mediumSentences.length > 0) {
      examples.push(mediumSentences[Math.floor(Math.random() * mediumSentences.length)]);
    }
    if (longSentences.length > 0) {
      examples.push(longSentences[Math.floor(Math.random() * longSentences.length)]);
    }

    // If we have fewer than 3 examples, add more from the most common category
    while (examples.length < 3 && allSentences.length > examples.length) {
      const remaining = allSentences.filter(s => !examples.includes(s));
      if (remaining.length > 0) {
        examples.push(remaining[Math.floor(Math.random() * remaining.length)]);
      } else {
        break;
      }
    }

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
      examples
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

      const totalEnd = Date.now();
      console.log(`[TIMING] calculateSentenceStats TOTAL: ${totalEnd - totalStart}ms for ${relationship}`);

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
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      // Filter by relationship if not aggregate
      if (relationship && relationship !== 'aggregate') {
        // Join to relationship tables to filter by relationship type
        query += `
        INNER JOIN person_emails pe ON se.recipient_person_email_id = pe.id
        INNER JOIN person_relationships pr ON pr.person_id = pe.person_id AND pr.user_id = se.user_id
        INNER JOIN user_relationships ur ON pr.user_relationship_id = ur.id
        WHERE se.user_id = $1
          AND se.semantic_vector IS NOT NULL
          AND pr.is_primary = true
        `;
        paramCount++;
        query += ` AND ur.relationship_type = $${paramCount}`;
        params.push(relationship);
      } else {
        // For aggregate, no joins needed
        query += `
        WHERE se.user_id = $1
          AND se.semantic_vector IS NOT NULL
        `;
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
    const decryptedApiKey = decryptPassword(provider.api_key);

    this.modelName = provider.model_name;
    this.llmClient = new LLMClient({
      id: provider.id,
      type: provider.provider_type as any,
      apiKey: decryptedApiKey,
      apiEndpoint: provider.api_endpoint,
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
    console.log(`[TIMING] analyzeWritingPatterns START for ${relationship || 'aggregate'}: ${emails.length} emails`);

    // Process in batches of 50 emails
    const batchSize = 50;
    const batches = this.chunkEmails(emails, batchSize);

    console.log(`[TIMING] Created ${batches.length} batches of ${batchSize} emails each`);

    const batchAnalyses: BatchAnalysisResult[] = [];
    let successfulBatches = 0;
    let failedBatches = 0;

    const batchLoopStart = Date.now();
    for (let i = 0; i < batches.length; i++) {
      const batchStart = Date.now();
      console.log(`[TIMING] Batch ${i + 1}/${batches.length} START`);

      try {
        const analysis = await this.analyzeBatch(batches[i], relationship);
        batchAnalyses.push(analysis);
        successfulBatches++;
        const batchEnd = Date.now();
        console.log(`[TIMING] Batch ${i + 1}/${batches.length} COMPLETE: ${batchEnd - batchStart}ms`);
      } catch (error: unknown) {
        console.error(`Error analyzing batch ${i + 1}:`, error);
        failedBatches++;
        // Continue with other batches even if one fails
      }
    }
    const batchLoopEnd = Date.now();
    console.log(`[TIMING] All batches COMPLETE: ${batchLoopEnd - batchLoopStart}ms total for ${batches.length} batches`);

    if (batchAnalyses.length === 0) {
      throw new Error('Failed to analyze any email batches');
    }

    // Aggregate patterns across all batches
    const aggStart = Date.now();
    const aggregated = this.aggregatePatterns(batchAnalyses);
    const aggEnd = Date.now();
    console.log(`[TIMING] aggregatePatterns COMPLETE: ${aggEnd - aggStart}ms`);

    // Calculate sentence statistics directly from emails for accuracy
    // Always calculate, even for aggregate (when relationship is undefined)
    const relationshipLabel = relationship || 'aggregate';
    const statsStart = Date.now();
    console.log(`[TIMING] calculateSentenceStats START for ${relationshipLabel}`);
    const directSentenceStats = await this.calculateSentenceStats(userId, relationship || 'aggregate');
    const statsEnd = Date.now();
    console.log(`[TIMING] calculateSentenceStats COMPLETE: ${statsEnd - statsStart}ms`);

    // Calculate structural patterns using NLP
    const structureStart = Date.now();
    console.log(`[TIMING] NLP structural analysis START for ${relationshipLabel}`);

    const paragraphPatterns = await this.calculateParagraphPatterns(userId, emails);
    console.log(`[TIMING] Paragraph patterns: ${paragraphPatterns.length} types found`);

    const openingPatterns = await this.calculateOpeningPatterns(userId, emails);
    console.log(`[TIMING] Opening patterns: ${openingPatterns.length} variations found`);

    const valedictionPatterns = await this.calculateValedictionPatterns(userId, emails);
    console.log(`[TIMING] Valediction patterns: ${valedictionPatterns.length} types found`);

    const structureEnd = Date.now();
    console.log(`[TIMING] NLP structural analysis COMPLETE: ${structureEnd - structureStart}ms`);

    // Replace LLM-calculated patterns with NLP calculations
    aggregated.sentencePatterns = directSentenceStats;
    aggregated.paragraphPatterns = paragraphPatterns;
    aggregated.openingPatterns = openingPatterns;
    aggregated.valediction = valedictionPatterns;

    console.log(`Direct sentence stats for ${relationshipLabel}: avg=${directSentenceStats.avgLength}, median=${directSentenceStats.medianLength}, trimmed=${directSentenceStats.trimmedMean}, min=${directSentenceStats.minLength}, max=${directSentenceStats.maxLength}, std=${directSentenceStats.stdDeviation}`);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    // Log completion with metadata
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-analysis',
      level: 'info',
      command: 'pattern.analysis.complete',
      data: {
        raw: `For relationship ${relationship || 'aggregate'}, found ${aggregated.openingPatterns.length} opening patterns, ${aggregated.valediction.length} valedictions, ${aggregated.negativePatterns.length} negative patterns, ${aggregated.uniqueExpressions.length} unique expressions`,
        parsed: {
          totalEmails: emails.length,
          batchSize,
          totalBatches: batches.length,
          successfulBatches,
          failedBatches,
          durationSeconds: duration,
          relationship: relationship || 'aggregate',
          patterns: {
            openings: aggregated.openingPatterns.length,
            valedictions: aggregated.valediction.length,
            negative: aggregated.negativePatterns.length,
            unique: aggregated.uniqueExpressions.length
          }
        }
      }
    });

    return aggregated;
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

    // Generate prompt using template (includes all instructions)
    const promptStart = Date.now();
    const prompt = await this.templateManager.renderPrompt('pattern-analysis', templateData as any);
    const promptEnd = Date.now();
    console.log(`[TIMING] Prompt generation: ${promptEnd - promptStart}ms, prompt length: ${prompt.length} chars`);

    // Write prompt to disk for inspection
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const relationshipLabel = relationship || 'aggregate';
    const promptFile = join(tmpdir(), `llm-prompt-${relationshipLabel}-${timestamp}-${randomId}.txt`);
    writeFileSync(promptFile, prompt, 'utf8');
    console.log(`[LLM] Prompt written to: ${promptFile}`);

    // Call LLM with structured output expectation
    const llmStart = Date.now();
    const response = await this.llmClient.generate(prompt, {
      temperature: 0.3 // Lower temperature for more consistent analysis
    });
    const llmEnd = Date.now();
    console.log(`[TIMING] LLM API call: ${llmEnd - llmStart}ms, response length: ${response.length} chars`);

    // Write response to disk for inspection
    const responseFile = join(tmpdir(), `llm-response-${relationshipLabel}-${timestamp}-${randomId}.txt`);
    writeFileSync(responseFile, response, 'utf8');
    console.log(`[LLM] Response written to: ${responseFile}`);

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
    } catch (error) {
      console.error('Failed to parse LLM response:', response);
      throw error;
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
    
    // Sentence patterns, paragraph patterns, openings, and valedictions are NO LONGER calculated by LLM
    // They're calculated by NLP in analyzeWritingPatterns()
    // These placeholders are immediately overwritten
    const sentencePatterns: SentencePatterns = {
      avgLength: 0,
      medianLength: 0,
      trimmedMean: 0,
      minLength: 0,
      maxLength: 0,
      stdDeviation: 0,
      percentile25: 0,
      percentile75: 0,
      distribution: {
        short: 0,
        medium: 0,
        long: 0
      },
      examples: []
    };

    const paragraphPatterns: ParagraphPattern[] = [];
    const openingPatterns: OpeningPattern[] = [];
    const valediction: ValedictionPattern[] = [];

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


  private mergeNegativePatterns(patternArrays: NegativePattern[][]): NegativePattern[] {
    const merged = new Map<string, NegativePattern>();

    patternArrays.forEach(patterns => {
      patterns.forEach(pattern => {
        const key = pattern.description.toLowerCase().trim();
        const existing = merged.get(key);

        if (!existing || pattern.confidence > existing.confidence) {
          merged.set(key, pattern);
        }
      });
    });

    return Array.from(merged.values())
      .filter(pattern => pattern.confidence > 0.7)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
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
          occurrenceRate: Math.round((data.totalFreq / data.totalWeight) * 10000) / 10000
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

  /**
   * Calculate paragraph structure patterns using NLP
   * Categorizes emails into: single-line, brief-multi-line, multi-paragraph, mixed
   */
  private async calculateParagraphPatterns(
    _userId: string,
    emails: ProcessedEmail[]
  ): Promise<ParagraphPattern[]> {
    if (emails.length === 0) {
      return [];
    }

    // Classify each email's structure
    const classifications = emails.map(email => this.classifyEmailStructure(email));

    // Count occurrences of each type
    const counts = new Map<string, number>();
    classifications.forEach(type => {
      counts.set(type, (counts.get(type) || 0) + 1);
    });

    // Convert to percentages and create pattern objects
    const total = emails.length;
    const patterns: ParagraphPattern[] = Array.from(counts.entries()).map(([type, count]) => ({
      type,
      percentage: (count / total) * 100,
      description: this.getParagraphTypeDescription(type)
    }));

    // Sort by percentage (most common first)
    patterns.sort((a, b) => b.percentage - a.percentage);

    return patterns;
  }

  /**
   * Classify a single email's paragraph structure
   */
  private classifyEmailStructure(email: ProcessedEmail): string {
    const text = email.userReply;
    if (!text || text.trim() === '') {
      return "single-line response";
    }

    const doc = nlp(text);
    const sentences = doc.sentences().length;
    const lineBreaks = this.countLineBreaks(text);
    const hasGreeting = this.hasGreeting(text);
    const hasClosing = this.hasClosing(text);

    // Single-line: Very brief, 1-2 sentences, minimal line breaks
    if (sentences <= 2 && lineBreaks <= 1) {
      return "single-line response";
    }

    // Brief multi-line: Short, 2-4 lines
    if (sentences <= 4 && lineBreaks >= 2 && lineBreaks <= 4) {
      return "brief-multi-line";
    }

    // Multi-paragraph: Structured with greeting, multiple paragraphs, and closing
    if (hasGreeting && hasClosing && lineBreaks > 4) {
      return "multi-paragraph";
    }

    // Default to mixed if doesn't fit clear pattern
    return "mixed";
  }

  /**
   * Count meaningful line breaks in text
   */
  private countLineBreaks(text: string): number {
    return text.split('\n').filter(line => line.trim().length > 0).length - 1;
  }

  /**
   * Detect if text has a greeting
   */
  private hasGreeting(text: string): boolean {
    const firstLine = text.split('\n')[0]?.toLowerCase() || '';
    const doc = nlp(firstLine);

    // Check for common greeting patterns
    return doc.match('(hi|hello|hey|dear|greetings|good morning|good afternoon|good evening)').found;
  }

  /**
   * Detect if text has a closing/valediction
   */
  private hasClosing(text: string): boolean {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return false;

    // Check last 3 lines for common closings
    const lastLines = lines.slice(-3).join('\n').toLowerCase();
    const doc = nlp(lastLines);

    return doc.match('(thanks|thank you|best|regards|sincerely|cheers|warmly|talk soon|speak soon)').found;
  }

  /**
   * Get description for paragraph type
   */
  private getParagraphTypeDescription(type: string): string {
    const descriptions: Record<string, string> = {
      "single-line response": "Very brief emails, 1-2 sentences total, no line breaks",
      "brief-multi-line": "Short emails with 2-4 lines, each line is a distinct point",
      "multi-paragraph": "Structured emails with greeting, multiple paragraphs, and closing",
      "mixed": "Varies between different paragraph patterns"
    };
    return descriptions[type] || type;
  }

  /**
   * Calculate opening patterns using NLP
   * Extracts exact opening text with frequencies
   */
  private async calculateOpeningPatterns(
    _userId: string,
    emails: ProcessedEmail[]
  ): Promise<OpeningPattern[]> {
    if (emails.length === 0) {
      return [];
    }

    // Extract opening from each email
    const openings = emails.map(email => this.extractOpening(email));

    // Count occurrences
    const counts = new Map<string, number>();
    openings.forEach(opening => {
      counts.set(opening, (counts.get(opening) || 0) + 1);
    });

    // Convert to percentages
    const total = emails.length;
    const patterns: OpeningPattern[] = Array.from(counts.entries()).map(([pattern, count]) => ({
      pattern,
      percentage: count / total,
      notes: pattern === "[right to the point]" ? "No greeting, starts directly with content" : undefined
    }));

    // Sort by percentage (most common first)
    patterns.sort((a, b) => b.percentage - a.percentage);

    return patterns;
  }

  /**
   * Extract opening text from email
   */
  private extractOpening(email: ProcessedEmail): string {
    const lines = email.userReply.split('\n').filter(l => l.trim());
    if (lines.length === 0) {
      return "[right to the point]";
    }

    const firstLine = lines[0].trim();

    // Check for greeting patterns using NLP
    const doc = nlp(firstLine);
    const hasGreeting = doc.match('(hi|hello|hey|dear|greetings|good morning|good afternoon|good evening)').found;

    if (!hasGreeting || firstLine.length < 3) {
      return "[right to the point]";
    }

    // Extract up to first comma, period, or exclamation (preserve punctuation)
    const match = firstLine.match(/^[^.,!?]+[.,!?]?/);
    return match ? match[0].trim() : firstLine;
  }

  /**
   * Calculate valediction patterns using NLP
   * Analyzes closing phrases before name
   */
  private async calculateValedictionPatterns(
    _userId: string,
    emails: ProcessedEmail[]
  ): Promise<ValedictionPattern[]> {
    if (emails.length === 0) {
      return [];
    }

    // Extract valediction from each email
    const valedictions = emails.map(email => this.extractValediction(email));

    // Count occurrences
    const counts = new Map<string, number>();
    valedictions.forEach(valediction => {
      counts.set(valediction, (counts.get(valediction) || 0) + 1);
    });

    // Convert to percentages (must sum to 100%)
    const total = emails.length;
    const patterns: ValedictionPattern[] = Array.from(counts.entries()).map(([phrase, count]) => ({
      phrase,
      percentage: (count / total) * 100
    }));

    // Sort by percentage (most common first)
    patterns.sort((a, b) => b.percentage - a.percentage);

    // Ensure percentages sum to exactly 100% (handle floating point rounding)
    const sum = patterns.reduce((acc, p) => acc + p.percentage, 0);
    if (sum !== 100 && patterns.length > 0) {
      // Add difference to the most common pattern
      patterns[0].percentage += (100 - sum);
    }

    return patterns;
  }

  /**
   * Extract valediction from email
   */
  private extractValediction(email: ProcessedEmail): string {
    const lines = email.userReply.split('\n').filter(l => l.trim());
    if (lines.length === 0) {
      return "[None]";
    }

    // Check last 3 lines for valedictions
    const lastLines = lines.slice(-3).join('\n').toLowerCase();

    const detected = this.detectCommonValedictions(lastLines);
    return detected || "[None]";
  }

  /**
   * Detect common valediction phrases using NLP
   */
  private detectCommonValedictions(text: string): string | null {
    const doc = nlp(text);

    // Use NLP to find common valediction patterns
    // Look for: thanks/gratitude phrases, farewells, regards patterns
    const gratitude = doc.match('(thanks|thank you)').text();
    if (gratitude) return gratitude.charAt(0).toUpperCase() + gratitude.slice(1);

    const farewell = doc.match('(best|sincerely|cheers|warmly|regards)').text();
    if (farewell) return farewell.charAt(0).toUpperCase() + farewell.slice(1);

    const compound = doc.match('(best|kind|warm) regards').text();
    if (compound) {
      return compound.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    const talkSoon = doc.match('(talk|speak) soon').text();
    if (talkSoon) {
      return talkSoon.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    return null;
  }
}