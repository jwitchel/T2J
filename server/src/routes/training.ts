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

const router = express.Router();

// Load sent emails into vector DB
router.post('/load-sent-emails', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { emailAccountId, limit = 1000, startDate } = req.body;


    if (!emailAccountId) {
      res.status(400).json({ error: 'emailAccountId is required' });
      return;
    }

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

    // Search in Sent folder
      const sentFolders = ['Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail'];
      let messages: any[] = [];
      let folderUsed = '';

    console.log(`[Training] Searching for sent emails ${beforeDate ? `before ${beforeDate.toISOString()}` : '(most recent)'}, limit ${limit}`);

    for (const folder of sentFolders) {
      try {
        console.log(`[Training] Trying folder: ${folder}`);

        // Search with or without date criteria
        const searchCriteria = beforeDate ? { before: beforeDate } : {};
        const searchResults = await imapOps!.searchMessages(folder, searchCriteria, { limit });

        console.log(`[Training] Folder ${folder}: found ${searchResults.length} messages`);

        if (searchResults.length > 0) {
          messages = searchResults;
          folderUsed = folder;
          break;
        }
      } catch (err) {
        console.log(`[Training] Folder ${folder} error:`, err instanceof Error ? err.message : err);
        // This is expected when searching for the correct folder name
        // Different email providers use different folder names
        continue;
      }
    }

      if (messages.length === 0) {
      console.log(`[Training] No sent emails found in any folder. Tried: ${sentFolders.join(', ')}`);
      res.status(404).json({ error: 'No sent emails found' });
        return;
      }

      console.log(`[Training] Found ${messages.length} emails in folder ${folderUsed}`);

      realTimeLogger.log(userId, {
      userId,
      emailAccountId,
      level: 'info',
      command: 'TRAINING_FOUND_EMAILS',
      data: { 
        parsed: { found: messages.length, folder: folderUsed }
      }
      });

    // Batch fetch and process using EmailStorageService
      let processed = 0;
      let saved = 0;
      let errors = 0;
      const startTime = Date.now();
      const totalMessages = messages.length;

      // Initialize email storage service
      await emailStorageService.initialize();

      // Collect UIDs for batch fetching
      const uids = messages.map(msg => msg.uid);

      // Batch fetch all messages with getMessagesRaw() (includes bodystructure, flags, size)
      console.log(`[Training] Batch fetching ${uids.length} messages from ${folderUsed}`);
      const fullMessages = await imapOps!.getMessagesRaw(folderUsed, uids);
      console.log(`[Training] Fetched ${fullMessages.length} full messages`);

      // Process each message with EmailStorageService
      for (let i = 0; i < fullMessages.length; i++) {
        const fullMessage = fullMessages[i];

        try {
          // Validate message has required data
          if (!fullMessage.fullMessage) {
            errors++;
            console.error(`[Training] Email ${fullMessage.uid} missing raw message`);
            realTimeLogger.log(userId, {
              userId,
              emailAccountId,
              level: 'error',
              command: 'TRAINING_EMAIL_ERROR',
              data: {
                error: 'Missing raw RFC 5322 message',
                parsed: { uid: fullMessage.uid, index: i }
              }
            });
            continue;
          }

          // Save to database using EmailStorageService
          const result = await emailStorageService.saveEmail({
            userId,
            emailAccountId,
            emailData: fullMessage,  // Complete EmailMessageWithRaw data
            emailType: 'sent',
            folderName: folderUsed
          });

          if (result.success) {
            if (result.skipped) {
              console.log(`[Training] Email ${fullMessage.messageId} skipped (duplicate or no content)`);
            } else {
              processed++;
              saved += result.saved || 0;
            }
          } else {
            errors++;
            console.error(`[Training] Failed to save email ${fullMessage.messageId}:`, result.error);
          }

          // Log progress every 10 emails
          if ((i + 1) % 10 === 0 || i === fullMessages.length - 1) {
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

        } catch (err) {
          errors++;
          console.error(`[Training] Error processing email ${i + 1}:`, err);
          realTimeLogger.log(userId, {
            userId,
            emailAccountId,
            level: 'error',
            command: 'TRAINING_EMAIL_ERROR',
            data: {
              error: err instanceof Error ? err.message : 'Unknown error',
              parsed: { uid: fullMessage.uid, index: i }
            }
          });
        }
      }
    
    
    // Aggregate styles after all emails are processed
      try {
        await orchestrator.aggregateStyles(userId);
      } catch (err) {
        console.error('Style aggregation error:', err);
      }

      const duration = Date.now() - startTime;
    
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
    const userId = (req as any).user.id;

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

    // Delete all people (CASCADE will automatically delete person_emails and person_relationships)
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
  const userId = (req as any).user.id;
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

    // Log the start of pattern analysis
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-training',
      level: 'info',
      command: 'patterns.training.start',
      data: {
        raw: 'Starting comprehensive pattern analysis across all email accounts'
      }
    });

    // Get ALL sent emails for the user across ALL accounts and relationships from PostgreSQL
    // (Pattern analysis uses sent emails to learn the user's writing style)
    // JOIN through person_emails and person_relationships to get recipient and relationship info
    const emailsResult = await pool.query(`
      SELECT
        es.id,
        es.user_id as "userId",
        es.email_account_id as "emailAccountId",
        es.user_reply as "userReply",
        es.sent_date as "sentDate",
        ur.relationship_type as relationship,
        pe.email_address as "recipientEmail",
        es.subject,
        es.email_id as "emailId"
      FROM email_sent es
      INNER JOIN person_emails pe ON es.recipient_person_email_id = pe.id
      INNER JOIN people p ON pe.person_id = p.id
      LEFT JOIN person_relationships pr ON pr.person_id = p.id AND pr.user_id = es.user_id AND pr.is_primary = true
      LEFT JOIN user_relationships ur ON pr.user_relationship_id = ur.id
      WHERE es.user_id = $1
        AND es.semantic_vector IS NOT NULL
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
    // This is the correct phase for style vector generation (analysis, not ingestion)
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-training',
      level: 'info',
      command: 'patterns.training.generating_vectors',
      data: {
        raw: `Generating style vectors for ${allEmails.length} emails...`
      }
    });

    try {
      await vectorSearchService.initialize();

      // Prepare documents for batchIndex
      const documents = await Promise.all(allEmails.map(async (email: any) => {
        // Fetch the full email text from database
        const emailResult = await pool.query(
          'SELECT user_reply FROM email_sent WHERE id = $1',
          [email.id]
        );

        const text = emailResult.rows[0]?.user_reply || '';

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
      const relationship = email.metadata.relationship?.type || 'unknown';
      if (!emailsByRelationship[relationship]) {
        emailsByRelationship[relationship] = [];
      }
      emailsByRelationship[relationship].push(email);
    });
    
    const relationships = Object.keys(emailsByRelationship);
    
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-training',
      level: 'info',
      command: 'patterns.training.relationships_found',
      data: {
        parsed: {
          relationships,
          counts: Object.fromEntries(
            relationships.map(rel => [rel, emailsByRelationship[rel].length])
          )
        }
      }
    });
    
    // Analyze patterns for each relationship AND aggregate
    const allPatterns: Record<string, any> = {};
    let totalEmailsAnalyzed = 0;
    
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
              to: [{ address: email.metadata.recipientEmail || '', name: '' }],
              cc: [],
              bcc: [],
              subject: email.metadata.subject || '',
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
        
        realTimeLogger.log(userId, {
          userId,
          emailAccountId: 'pattern-training',
          level: 'info',
          command: 'patterns.training.analyzing',
          data: {
            parsed: {
              relationship,
              emailCount: emailsForAnalysis.length
            }
          }
        });
        
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
        
        realTimeLogger.log(userId, {
          userId,
          emailAccountId: 'pattern-training',
          level: 'info',
          command: 'patterns.training.saved',
          data: {
            parsed: {
              relationship,
              emailsAnalyzed: emailsForAnalysis.length,
              patternsFound: {
                openings: patterns.openingPatterns.length,
                valedictions: patterns.valediction.length,
                negative: patterns.negativePatterns.length,
                unique: patterns.uniqueExpressions.length
              }
            }
          }
        });
      }
      
      // Now analyze aggregate patterns (all emails combined) - only emails with userReply
      const allEmailsForAnalysis = await Promise.all(allEmails
        .filter((email: any) => {
          // Include all emails with userReply (including [ForwardedWithoutComment])
          if (!email.metadata.userReply) {
            console.warn(`[Pattern Analysis - Aggregate] Skipping email ${email.id} - no userReply field`);
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
            to: [{ address: email.metadata.recipientEmail || '', name: '' }],
            cc: [],
            bcc: [],
            subject: email.metadata.subject || '',
            textContent: textForAnalysis,
            htmlContent: null,
            userReply: textForAnalysis,
            respondedTo: '',
            fullMessage: '' // Not needed for pattern analysis
          };
        }));
      
      realTimeLogger.log(userId, {
        userId,
        emailAccountId: 'pattern-training',
        level: 'info',
        command: 'patterns.training.analyzing',
        data: {
          parsed: {
            relationship: 'aggregate',
            emailCount: allEmailsForAnalysis.length
          }
        }
      });
      
      // Analyze aggregate patterns
      const aggregatePatterns = await patternAnalyzer.analyzeWritingPatterns(
        userId,
        allEmailsForAnalysis,
        undefined // undefined means aggregate
      );
      
      // Save aggregate patterns
      await patternAnalyzer.savePatterns(
        userId,
        aggregatePatterns,
        undefined, // undefined means aggregate
        allEmailsForAnalysis.length
      );
      
      allPatterns['aggregate'] = aggregatePatterns;
      
      realTimeLogger.log(userId, {
        userId,
        emailAccountId: 'pattern-training',
        level: 'info',
        command: 'patterns.training.saved',
        data: {
          parsed: {
            relationship: 'aggregate',
            emailsAnalyzed: allEmailsForAnalysis.length,
            patternsFound: {
              openings: aggregatePatterns.openingPatterns.length,
              valedictions: aggregatePatterns.valediction.length,
              negative: aggregatePatterns.negativePatterns.length,
              unique: aggregatePatterns.uniqueExpressions.length
            }
          }
        }
      });
        
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
      const rel = email.metadata.relationship?.type || 'unknown';
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
    
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'pattern-training',
      level: 'info',
      command: 'patterns.training.complete',
      data: {
        parsed: {
          totalEmailsAnalyzed: totalEmailsAnalyzed,
          emailAccounts: new Set(allEmails.map((e: any) => e.metadata.emailAccountId)).size,
          relationshipBreakdown,
          relationshipsAnalyzed: relationships.length + 1 // +1 for aggregate
        }
      }
    });
    
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
