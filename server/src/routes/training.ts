import express from 'express';
import { requireAuth } from '../middleware/auth';
import { ImapOperations } from '../lib/imap-operations';
import { withImapContext } from '../lib/imap-context';
import { ToneLearningOrchestrator } from '../lib/pipeline/tone-learning-orchestrator';
import { realTimeLogger } from '../lib/real-time-logger';
import { WritingPatternAnalyzer } from '../lib/pipeline/writing-pattern-analyzer';
import { pool } from '../lib/db';
import { emailStorageService } from '../lib/email-storage-service';
import { vectorSearchService } from '../lib/vector';
import { EmailDirection } from '../types/email-action-tracking';
import { preferencesService } from '../lib/preferences-service';

const router = express.Router();

// Load sent emails into DB
router.post('/load-sent-emails', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const { emailAccountId, limit, startDate } = req.body;

    // Initialize services
    let imapOps: ImapOperations;
    await withImapContext(emailAccountId, userId, async () => {
      imapOps = await ImapOperations.fromAccountId(emailAccountId, userId);
      const orchestrator = new ToneLearningOrchestrator();

      // If startDate is provided, search before that date
      // Otherwise, search for most recent emails (no date filter)
      const beforeDate = startDate ? new Date(startDate) : undefined;
      if (beforeDate) {
        beforeDate.setDate(beforeDate.getDate() + 1); // Make it inclusive
      }

      // Search for sent emails
      realTimeLogger.log(userId, {
      userId,
      emailAccountId,
      level: 'info',
      command: 'TRAINING_START',
      data: { 
        parsed: { limit, startDate, folder: 'Sent' }
      }
      });

    // Get user's configured sent folder from preferences
      const sentFolder = await preferencesService.getSentFolder(userId);
      if (!sentFolder) {
        res.status(400).json({ error: 'Sent folder not configured. Please configure it in settings.' });
        return;
      }


      // Search in the configured sent folder
      let uids: number[] = [];
      try {
        const searchCriteria = beforeDate ? { before: beforeDate } : {};
        uids = await imapOps!.searchUidsOnly(sentFolder, searchCriteria, { limit });
        console.log(`[Training] Search found ${uids.length} UIDs${sentFolder} for sent emails ${beforeDate ? `before ${beforeDate.toISOString()}` : '(most recent)'}, limit ${limit}`);
      } catch (err) {
        console.error(`[Training] Error searching folder ${sentFolder}:`, err);
        res.status(500).json({ error: `Failed to search sent folder: ${sentFolder}` });
        return;
      }

      realTimeLogger.log(userId, {
      userId,
      emailAccountId,
      level: 'info',
      command: 'TRAINING_FOUND_EMAILS',
      data: {
        parsed: { found: uids.length, folder: sentFolder }
      }
      });

    // Batch fetch and process using EmailStorageService
      const startTime = Date.now();
      const totalMessages = uids.length;

      // Initialize email storage service
      await emailStorageService.initialize();

      // Batch fetch all messages with getMessagesRaw() (direct fetch, no intermediate step)
      console.log(`\n[Training] ========================================`);
      console.log(`[Training] Starting IMAP fetch for ${uids.length} messages`);
      console.log(`[Training] ========================================\n`);
      const imapFetchStart = Date.now();

      const fullMessages = await imapOps!.getMessagesRaw(sentFolder, uids);

      const imapFetchDuration = Date.now() - imapFetchStart;
      console.log(`\n[Training] ========================================`);
      console.log(`[Training] IMAP FETCH COMPLETE: ${imapFetchDuration}ms (${(imapFetchDuration/1000).toFixed(1)}s)`);
      console.log(`[Training] Fetched ${fullMessages.length}/${uids.length} messages`);
      console.log(`[Training] Average: ${(imapFetchDuration/fullMessages.length).toFixed(0)}ms per message`);
      console.log(`[Training] ========================================\n`);

      // Filter out messages missing raw content
      const validMessages = fullMessages.filter((msg, i) => {
        if (!msg.fullMessage) {
          console.error(`[Training] Email ${msg.uid} missing raw message`);
          realTimeLogger.log(userId, {
            userId,
            emailAccountId,
            level: 'error',
            command: 'TRAINING_EMAIL_ERROR',
            data: {
              error: 'Missing raw RFC 5322 message',
              parsed: { uid: msg.uid, index: i }
            }
          });
          return false;
        }
        return true;
      });

      console.log(`[Training] Processing ${validMessages.length} valid emails in batch`);

      // Batch process all emails with EmailStorageService
      const batchParams = validMessages.map(fullMessage => ({
        userId,
        emailAccountId,
        emailData: fullMessage,
        emailType: EmailDirection.SENT as const,
        folderName: sentFolder
      }));

      const storageStart = Date.now();
      const results = await emailStorageService.saveEmailBatch(batchParams);
      const storageDuration = Date.now() - storageStart;

      // Aggregate results
      let processed = 0;
      let saved = 0;
      let errors = 0;

      results.forEach((result, i) => {
        if (result.success) {
          if (result.skipped) {
            console.log(`[Training] Email ${validMessages[i].messageId} skipped (duplicate or no content)`);
          } else {
            processed++;
            saved += result.saved!;
          }
        } else {
          errors++;
          console.error(`[Training] Failed to save email ${validMessages[i].messageId}:`, result.error);
        }

        // Log progress every 100 emails
        if ((i + 1) % 100 === 0 || i === results.length - 1) {
          realTimeLogger.log(userId, {
            userId,
            emailAccountId,
            level: 'info',
            command: 'TRAINING_PROGRESS',
            data: {
              parsed: {
                processed: i + 1,
                total: totalMessages,
                saved,
                errors,
                percentage: Math.round(((i + 1) / totalMessages) * 100)
              }
            }
          });
        }
      });
    

    // Aggregate styles after all emails are processed
      const aggregationStart = Date.now();
      await orchestrator.aggregateStyles(userId);
      const aggregationDuration = Date.now() - aggregationStart;

      const duration = Date.now() - startTime;

      console.log(`\n[Training] ========================================`);
      console.log(`[Training] TRAINING COMPLETE - PERFORMANCE BREAKDOWN`);
      console.log(`[Training] ========================================`);
      console.log(`[Training] IMAP Fetch:      ${imapFetchDuration}ms (${(imapFetchDuration/1000).toFixed(1)}s) - ${((imapFetchDuration/duration)*100).toFixed(1)}%`);
      console.log(`[Training] Email Storage:   ${storageDuration}ms (${(storageDuration/1000).toFixed(1)}s) - ${((storageDuration/duration)*100).toFixed(1)}%`);
      console.log(`[Training] Style Aggregation: ${aggregationDuration}ms (${(aggregationDuration/1000).toFixed(1)}s) - ${((aggregationDuration/duration)*100).toFixed(1)}%`);
      console.log(`[Training] Other/Overhead:  ${(duration - imapFetchDuration - storageDuration - aggregationDuration)}ms`);
      console.log(`[Training] ----------------------------------------`);
      console.log(`[Training] TOTAL TIME:      ${duration}ms (${(duration/1000).toFixed(1)}s)`);
      console.log(`[Training] Results: ${saved} saved, ${errors} errors`);
      console.log(`[Training] ========================================\n`);

      realTimeLogger.log(userId, {
      userId,
      emailAccountId,
      level: 'info',
      command: 'TRAINING_COMPLETE',
      data: {
        parsed: { processed, saved, errors, duration }
      }
      });

    // Give WebSocket time to send the completion message before responding
    await new Promise(resolve => setTimeout(resolve, 100));


      res.json({
      success: true,
      processed,
      saved,  // Number of database entries created (can be > processed for sent emails with multiple recipients)
      errors,
      duration
      });
    });

  } catch (error) {
    console.error('Training error:', error);
    // Connection lifecycle handled by withImapContext
    res.status(500).json({ 
      error: 'Training failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Wipe user's email data
router.post('/wipe', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;

    // Delete all sent emails (CASCADE will handle related data)
    await pool.query(`
      DELETE FROM email_sent WHERE user_id = $1
    `, [userId]);

    // Delete all received emails (CASCADE will handle related data)
    await pool.query(`
      DELETE FROM email_received WHERE user_id = $1
    `, [userId]);

    // Delete style clusters
    await pool.query(`
      DELETE FROM style_clusters WHERE user_id = $1
    `, [userId]);

    // Delete tone preferences
    await pool.query(`
      DELETE FROM tone_preferences WHERE user_id = $1
    `, [userId]);

    // Delete draft tracking
    await pool.query(`
      DELETE FROM draft_tracking WHERE user_id = $1
    `, [userId]);

    // Delete all people (CASCADE will automatically delete person_emails)
    await pool.query(`
      DELETE FROM people WHERE user_id = $1
    `, [userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Wipe error:', error);
    res.status(500).json({
      error: 'Failed to wipe data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Analyze writing patterns
router.post('/analyze-patterns', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const startTime = Date.now();
  
  try {
    // Initialize services
    const patternAnalyzer = new WritingPatternAnalyzer();
    await patternAnalyzer.initialize();

    // Clear existing patterns to make the operation idempotent
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-training',
      level: 'info',
      command: 'patterns.training.clearing',
      data: {
        raw: 'Clearing existing writing patterns...'
      }
    });

    await patternAnalyzer.clearPatterns(userId);

    // Get ALL sent emails for the user across ALL accounts and relationships from PostgreSQL
    // (Pattern analysis uses sent emails to learn the user's writing style)
    // JOIN through person_emails to get recipient and relationship info (relationship is now on people table)
    const emailsResult = await pool.query(`
      SELECT
        es.id,
        es.user_id as "userId",
        es.email_account_id as "emailAccountId",
        es.user_reply as "userReply",
        es.sent_date as "sentDate",
        p.relationship_type as relationship,
        pe.email_address as "recipientEmail",
        es.subject,
        es.email_id as "emailId"
      FROM email_sent es
      INNER JOIN person_emails pe ON es.recipient_person_email_id = pe.id
      INNER JOIN people p ON pe.person_id = p.id
      WHERE es.user_id = $1
        AND es.semantic_vector IS NOT NULL
        AND es.user_reply != ''
        AND p.relationship_type IS NOT NULL
      ORDER BY es.sent_date DESC
      LIMIT 10000
    `, [userId]);

    const allEmails = emailsResult.rows.map(row => ({
      id: row.id,
      metadata: {
        userId: row.userId,
        emailAccountId: row.emailAccountId,
        userReply: row.userReply,
        sentDate: row.sentDate,
        relationship: { type: row.relationship },
        recipientEmail: row.recipientEmail,
        subject: row.subject,
        emailId: row.emailId
      }
    }));
    
    if (allEmails.length === 0) {
      res.status(404).json({ 
        error: 'No emails found',
        message: 'Please load emails before analyzing patterns'
      });
      return;
    }
    
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-training',
      level: 'info',
      command: 'patterns.training.corpus_size',
      data: {
        parsed: {
          totalEmails: allEmails.length,
          emailAccounts: new Set(allEmails.map((e: any) => e.metadata.emailAccountId)).size,
          relationships: new Set(allEmails.map((e: any) => e.metadata.relationship?.type)).size
        }
      }
    });

    // Generate style vectors for all emails via batchIndex()
    // This is vector generation (analysis, not ingestion)
    try {
      await vectorSearchService.initialize();

      // Prepare documents for batchIndex
      const documents = await Promise.all(allEmails.map(async (email: any) => {
        // Fetch the full email text from database
        const emailResult = await pool.query(
          'SELECT user_reply FROM email_sent WHERE id = $1',
          [email.id]
        );

        const text = emailResult.rows[0]!.user_reply;

        return {
          userId,
          emailId: email.id,
          emailType: 'sent' as const,
          text,
          metadata: {
            userId: email.metadata.userId,
            emailAccountId: email.metadata.emailAccountId,
            recipientEmail: email.metadata.recipientEmail,
            relationship: email.metadata.relationship?.type,
            subject: email.metadata.subject,
            sentDate: new Date(email.metadata.sentDate)
          }
        };
      }));

      const batchResult = await vectorSearchService.batchIndex({
        documents,
        batchSize: 50
      });

      // Log any errors that occurred during indexing
      if (batchResult.errors.length > 0) {
        console.error('[Pattern Analysis] Style vector indexing errors:');
        batchResult.errors.slice(0, 5).forEach((err, idx) => {
          console.error(`  ${idx + 1}. Document ${err.documentId}: ${err.error}`);
        });
        if (batchResult.errors.length > 5) {
          console.error(`  ... and ${batchResult.errors.length - 5} more errors`);
        }
      }

      realTimeLogger.log(userId, {
        userId,
        emailAccountId: 'pattern-training',
        level: batchResult.failed > 0 ? 'error' : 'info',
        command: 'patterns.training.vectors_complete',
        data: {
          parsed: {
            indexed: batchResult.indexed,
            failed: batchResult.failed,
            errors: batchResult.errors.length
          }
        }
      });
    } catch (error) {
      console.error('Vector generation error:', error);
      realTimeLogger.log(userId, {
        userId,
        emailAccountId: 'pattern-training',
        level: 'error',
        command: 'patterns.training.vector_error',
        data: {
          raw: `Style vector generation failed: ${error instanceof Error ? error.message : 'Unknown error'}. Continuing with pattern analysis...`
        }
      });
    }

    // Group emails by relationship type (ignoring email account)
    const emailsByRelationship: Record<string, any[]> = {};
    allEmails.forEach((email: any) => {
      const relationship = email.metadata.relationship?.type;
      if (!relationship) {
        throw new Error(`Email ${email.id} is missing relationship type - data integrity issue`);
      }
      if (!emailsByRelationship[relationship]) {
        emailsByRelationship[relationship] = [];
      }
      emailsByRelationship[relationship].push(email);
    });
    
    const relationships = Object.keys(emailsByRelationship);

    // Analyze patterns for each relationship AND aggregate
    const allPatterns: Record<string, any> = {};
    let totalEmailsAnalyzed = 0;

    // Initialize accumulator for aggregate patterns (cumulative tracking)
    const aggregateAccumulator = {
      sentenceLengths: [] as number[],
      paragraphCounts: new Map<string, number>(),
      openingCounts: new Map<string, number>(),
      valedictionCounts: new Map<string, number>(),
      totalEmails: 0
    };

    try {
      // First, analyze patterns for each relationship
      for (const relationship of relationships) {
        const emails = emailsByRelationship[relationship];
        
        // Convert to ProcessedEmail format - only process emails with userReply
        const emailsForAnalysis = await Promise.all(emails
          .filter((email: any) => {
            // Include all emails with userReply (including [ForwardedWithoutComment])
            if (!email.metadata.userReply) {
              console.warn(`[Pattern Analysis] Skipping email ${email.id} - no userReply field`);
              return false;
            }
            return true;
          })
          .map(async (email: any) => {
            // Use userReply which is the redacted user reply (already processed by pipeline)
            // This has quotes/signatures removed AND names redacted
            const textForAnalysis = email.metadata.userReply;
            
            return {
              uid: email.id,
              messageId: email.id,
              inReplyTo: null,
              date: new Date(email.metadata.sentDate || Date.now()),
              from: [{ address: userId, name: '' }],
              replyTo: [],
              to: [{ address: email.metadata.recipientEmail, name: '' }],
              cc: [],
              bcc: [],
              subject: email.metadata.subject,
              textContent: textForAnalysis,
              htmlContent: null,
              userReply: textForAnalysis,
              respondedTo: '',
              fullMessage: '' // Not needed for pattern analysis
            };
          }));
        
        // Skip this relationship if there are no emails to analyze
        if (emailsForAnalysis.length === 0) {
          realTimeLogger.log(userId, {
            userId,
            emailAccountId: 'pattern-training',
            level: 'info',
            command: 'patterns.training.skipped',
            data: {
              parsed: {
                relationship,
                reason: 'No emails with content to analyze'
              }
            }
          });
          continue; // Skip to next relationship
        }
        
        // Analyze patterns for this relationship
        const patterns = await patternAnalyzer.analyzeWritingPatterns(
          userId,
          emailsForAnalysis,
          relationship
        );
        
        // Save patterns for this relationship
        await patternAnalyzer.savePatterns(
          userId,
          patterns,
          relationship,
          emailsForAnalysis.length
        );

        allPatterns[relationship] = patterns;
        totalEmailsAnalyzed += emailsForAnalysis.length;

        // Accumulate data for aggregate calculation
        if (patterns.sentencePatterns.rawSentenceLengths) {
          aggregateAccumulator.sentenceLengths.push(...patterns.sentencePatterns.rawSentenceLengths);
        }

        patterns.paragraphPatterns.forEach((p: any) => {
          const currentCount = aggregateAccumulator.paragraphCounts.get(p.type) || 0;
          aggregateAccumulator.paragraphCounts.set(p.type, currentCount + (p.percentage / 100) * emailsForAnalysis.length);
        });

        patterns.openingPatterns.forEach((o: any) => {
          const currentCount = aggregateAccumulator.openingCounts.get(o.pattern) || 0;
          aggregateAccumulator.openingCounts.set(o.pattern, currentCount + o.percentage * emailsForAnalysis.length);
        });

        patterns.valediction.forEach((v: any) => {
          const currentCount = aggregateAccumulator.valedictionCounts.get(v.phrase) || 0;
          aggregateAccumulator.valedictionCounts.set(v.phrase, currentCount + (v.percentage / 100) * emailsForAnalysis.length);
        });

        aggregateAccumulator.totalEmails += emailsForAnalysis.length;
      }

      // Calculate aggregate patterns from accumulated data (no duplicate processing!)
      console.log(`[Pattern Analysis] Calculating aggregate from ${aggregateAccumulator.totalEmails} emails (cumulative)`);
      const aggregatePatterns = patternAnalyzer.calculateAggregateFromAccumulated(aggregateAccumulator);

      // Save aggregate patterns
      await patternAnalyzer.savePatterns(
        userId,
        aggregatePatterns,
        undefined, // undefined means aggregate
        aggregateAccumulator.totalEmails
      );

      allPatterns['aggregate'] = aggregatePatterns;
    } catch (error) {
      console.error('Error analyzing patterns:', error);
      realTimeLogger.log(userId, {
        userId,
        emailAccountId: 'pattern-training',
        level: 'error',
        command: 'patterns.training.error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
    
    const endTime = Date.now();
    const durationSeconds = Math.round((endTime - startTime) / 1000);
    
    // Get relationship breakdown for metadata
    const relationshipBreakdown: Record<string, number> = {};
    allEmails.forEach((email: any) => {
      const rel = email.metadata.relationship?.type;
      if (!rel) {
        throw new Error(`Email ${email.id} is missing relationship type - data integrity issue`);
      }
      relationshipBreakdown[rel] = (relationshipBreakdown[rel] || 0) + 1;
    });
    
    // Get the pattern analyzer's model name
    const modelUsed = 'gpt-4o-mini'; // Default model name
    
    // Create output with analysis results
    const output = {
      meta: {
        analysisDate: new Date().toISOString(),
        totalEmailsAnalyzed: totalEmailsAnalyzed,
        totalEmailsInCorpus: allEmails.length,
        emailAccounts: new Set(allEmails.map((e: any) => e.metadata.emailAccountId)).size,
        relationshipBreakdown,
        relationshipsAnalyzed: relationships.length + 1, // +1 for aggregate
        durationSeconds,
        modelUsed
      },
      patternsByRelationship: allPatterns
    };
    
    // Output consolidated patterns JSON to logs
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-training',
      level: 'info',
      command: 'patterns.training.consolidated',
      data: {
        raw: JSON.stringify(output, null, 2)
      }
    });
    
    res.json({
      success: true,
      emailsAnalyzed: totalEmailsAnalyzed,
      emailAccounts: new Set(allEmails.map((e: any) => e.metadata.emailAccountId)).size,
      relationshipsAnalyzed: relationships.length + 1, // +1 for aggregate
      relationships: [...relationships, 'aggregate'],
      patternsByRelationship: allPatterns,
      durationSeconds
    });
    
  } catch (error) {
    console.error('Pattern analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze patterns',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});


export default router;
