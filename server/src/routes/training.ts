import express from 'express';
import { requireAuth } from '../middleware/auth';
import { ImapOperations } from '../lib/imap-operations';
import { withImapContext } from '../lib/imap-context';
import { ToneLearningOrchestrator } from '../lib/pipeline/tone-learning-orchestrator';
import { VectorStore, SENT_COLLECTION } from '../lib/vector/qdrant-client';
import { realTimeLogger } from '../lib/real-time-logger';
import { WritingPatternAnalyzer } from '../lib/pipeline/writing-pattern-analyzer';
import { RegexSignatureDetector } from '../lib/regex-signature-detector';
import { pool } from '../server';
import { EmbeddingService } from '../lib/vector/embedding-service';
import { emailStorageService } from '../lib/email-storage-service';

const router = express.Router();
const regexSignatureDetector = new RegexSignatureDetector(pool);

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

    // First, collect a sample of emails to detect signature
      realTimeLogger.log(userId, {
      userId,
      emailAccountId,
      level: 'info',
      command: 'SIGNATURE_DETECTION_START',
      data: { 
        raw: 'Analyzing emails to detect signature pattern...'
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
          if (!fullMessage.rawMessage) {
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

          // Save to Qdrant using EmailStorageService
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

          // Small delay to prevent overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 10));

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
      saved,  // Number of Qdrant entries created (can be > processed for sent emails with multiple recipients)
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

// Wipe user's vector DB data
router.post('/wipe', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    
    const vectorStore = new VectorStore();
    await vectorStore.initialize();
    await vectorStore.deleteUserData(userId);
    
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
    
    const vectorStore = new VectorStore();
    await vectorStore.initialize();
    
    
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
    
    // Get ALL sent emails for the user across ALL accounts and relationships
    // (Pattern analysis uses sent emails to learn the user's writing style)
    // IMPORTANT: Only fetch fields we need to avoid hitting string length limits
    const scrollResult = await vectorStore['client'].scroll(SENT_COLLECTION, {
      filter: {
        must: [
          { key: 'userId', match: { value: userId } }
        ]
      },
      limit: 10000,
      with_payload: [
        'userId',
        'emailAccountId',
        'userReply',
        'sentDate',
        'relationship',
        'recipientEmail',
        'subject',
        'emailId'
      ],
      with_vector: false
    });
    
    const allEmails = scrollResult.points.map(point => ({
      id: point.id,
      metadata: point.payload as any
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
              to: [{ address: email.metadata.recipientEmail || '', name: '' }],
              cc: [],
              bcc: [],
              subject: email.metadata.subject || '',
              textContent: textForAnalysis,
              htmlContent: null,
              userReply: textForAnalysis,
              respondedTo: '',
              rawMessage: '' // Not needed for pattern analysis
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
            to: [{ address: email.metadata.recipientEmail || '', name: '' }],
            cc: [],
            bcc: [],
            subject: email.metadata.subject || '',
            textContent: textForAnalysis,
            htmlContent: null,
            userReply: textForAnalysis,
            respondedTo: '',
            rawMessage: '' // Not needed for pattern analysis
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

// Clean signatures from existing emails
router.post('/clean-emails', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    
    // Log the start of cleaning
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'info',
      command: 'CLEAN_EMAILS_START',
      data: { 
        parsed: { action: 'Starting email signature cleaning' }
      }
    });

    // Initialize services
    const vectorStore = new VectorStore();
    await vectorStore.initialize();
    
    const embeddingService = new EmbeddingService();
    await embeddingService.initialize();
    
    // Get all relationships for the user
    const relationshipStats = await vectorStore.getRelationshipStats(userId);
    const relationships = Object.keys(relationshipStats);
    
    let totalProcessed = 0;
    let totalCleaned = 0;
    const results: any[] = [];
    
    for (const relationship of relationships) {
      const emails = await vectorStore.getByRelationship(userId, relationship, 1000);
      
      for (const email of emails) {
        // Use rawText if available, otherwise use extractedText
        const originalText = email.metadata.rawText || email.metadata.userReply || '';
        
        // Remove signature
        const result = await regexSignatureDetector.removeSignature(originalText, userId);
        
        if (result.signature && result.cleanedText.trim()) {
          // Log the email that was cleaned
          realTimeLogger.log(userId, {
            userId,
            emailAccountId: 'all',
            level: 'info',
            command: 'CLEAN_EMAIL',
            data: { 
              parsed: {
                emailId: email.id,
                relationship,
                status: 'cleaned',
                before: originalText,
                after: result.cleanedText,
                signatureRemoved: result.signature,
                matchedPattern: result.matchedPattern
              }
            }
          });
          
          // Update the email in vector store
          const updatedMetadata = {
            ...email.metadata,
            userReply: result.cleanedText,
            rawText: originalText
          };
          
          // Re-embed with cleaned text
          const { vector } = await embeddingService.embedText(result.cleanedText);
          
          // Update in vector store
          await vectorStore.upsertEmail({
            id: email.id,
            userId,
            vector,
            metadata: updatedMetadata
          });
          
          totalCleaned++;
          results.push({
            emailId: email.id,
            relationship,
            signatureLength: result.signature.split('\n').length
          });
        } else {
          // Log emails that didn't need cleaning
          realTimeLogger.log(userId, {
            userId,
            emailAccountId: 'all',
            level: 'info',
            command: 'CLEAN_EMAIL',
            data: { 
              parsed: {
                emailId: email.id,
                relationship,
                status: 'no_signature_found',
                text: originalText
              }
            }
          });
        }
        
        totalProcessed++;
      }
    }
    
    // Log completion
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'info',
      command: 'CLEAN_EMAILS_COMPLETE',
      data: { 
        parsed: {
          totalProcessed,
          totalCleaned,
          percentageCleaned: totalProcessed > 0 ? (totalCleaned / totalProcessed * 100).toFixed(1) : 0
        }
      }
    });
    
    res.json({
      success: true,
      totalProcessed,
      totalCleaned,
      percentageCleaned: totalProcessed > 0 ? (totalCleaned / totalProcessed * 100).toFixed(1) : 0,
      results: results.slice(0, 10) // Return first 10 for UI feedback
    });
    
  } catch (error) {
    console.error('Error cleaning emails:', error);
    
    const userId = (req as any).user.id;
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'error',
      command: 'CLEAN_EMAILS_ERROR',
      data: { 
        parsed: { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }
      }
    });
    
    res.status(500).json({ 
      error: 'Failed to clean emails',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process emails: clean signatures and redact names
router.post('/process-emails', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    
    // Import nameRedactor
    const { nameRedactor } = await import('../lib/name-redactor');
    
    // Log the start
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'info',
      command: 'PROCESS_EMAILS_START',
      data: { 
        parsed: { action: 'Starting email processing (signature removal + name redaction)' }
      }
    });

    // Initialize services
    const vectorStore = new VectorStore();
    await vectorStore.initialize();
    
    const embeddingService = new EmbeddingService();
    await embeddingService.initialize();
    
    // Get all relationships for the user
    const relationshipStats = await vectorStore.getRelationshipStats(userId);
    const relationships = Object.keys(relationshipStats);
    
    let totalProcessed = 0;
    let totalCleaned = 0;
    let totalRedacted = 0;
    let totalNamesFound = 0;
    let totalEmailsFound = 0;
    const results: any[] = [];
    
    for (const relationship of relationships) {
      const emails = await vectorStore.getByRelationship(userId, relationship, 1000);
      
      for (const email of emails) {
        // Get the original text (prefer rawText if available)
        const originalText = email.metadata.rawText || email.metadata.userReply || '';
        
        // Step 1: Remove signature
        const signatureResult = await regexSignatureDetector.removeSignature(originalText, userId);
        const textAfterSignatureRemoval = signatureResult.cleanedText || originalText;
        
        // Step 2: Redact names and emails from the signature-cleaned text
        const redactionResult = nameRedactor.redactNames(textAfterSignatureRemoval);
        const finalText = redactionResult.text;
        
        // Only update if something changed
        if (signatureResult.signature || redactionResult.namesFound.length > 0 || redactionResult.emailsFound.length > 0) {
          // Log the processing
          realTimeLogger.log(userId, {
            userId,
            emailAccountId: 'all',
            level: 'info',
            command: 'PROCESS_EMAIL',
            data: { 
              parsed: {
                emailId: email.id,
                relationship,
                signatureRemoved: !!signatureResult.signature,
                namesRedacted: redactionResult.namesFound,
                namesCount: redactionResult.namesFound.length,
                emailsRedacted: redactionResult.emailsFound,
                emailsCount: redactionResult.emailsFound.length
              }
            }
          });
          
          // Update the email in vector store
          const updatedMetadata = {
            ...email.metadata,
            userReply: finalText,  // Store fully processed text
            rawText: originalText,     // Keep original text
            redactedNames: redactionResult.namesFound,  // Store list of redacted names
            redactedEmails: redactionResult.emailsFound  // Store list of redacted emails
          };
          
          // Re-embed with fully processed text
          const { vector } = await embeddingService.embedText(finalText);
          
          // Update in vector store
          await vectorStore.upsertEmail({
            id: email.id,
            userId,
            vector,
            metadata: updatedMetadata
          });
          
          if (signatureResult.signature) totalCleaned++;
          if (redactionResult.namesFound.length > 0 || redactionResult.emailsFound.length > 0) totalRedacted++;
          totalNamesFound += redactionResult.namesFound.length;
          totalEmailsFound += redactionResult.emailsFound.length;
          
          results.push({
            emailId: email.id,
            relationship,
            signatureRemoved: !!signatureResult.signature,
            namesRedacted: redactionResult.namesFound,
            emailsRedacted: redactionResult.emailsFound
          });
        }
        
        totalProcessed++;
        
        // Log progress every 50 emails
        if (totalProcessed % 50 === 0) {
          realTimeLogger.log(userId, {
            userId,
            emailAccountId: 'all',
            level: 'info',
            command: 'PROCESS_PROGRESS',
            data: { 
              parsed: {
                processed: totalProcessed,
                cleaned: totalCleaned,
                redacted: totalRedacted,
                totalNames: totalNamesFound,
                totalEmails: totalEmailsFound
              }
            }
          });
        }
      }
    }
    
    // Log completion
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'info',
      command: 'PROCESS_EMAILS_COMPLETE',
      data: { 
        parsed: {
          totalProcessed,
          totalCleaned,
          totalRedacted,
          totalNamesFound,
          totalEmailsFound,
          percentageCleaned: totalProcessed > 0 ? (totalCleaned / totalProcessed * 100).toFixed(1) : 0,
          percentageWithNames: totalProcessed > 0 ? (totalRedacted / totalProcessed * 100).toFixed(1) : 0
        }
      }
    });
    
    res.json({
      success: true,
      totalProcessed,
      totalCleaned,
      totalRedacted,
      totalNamesFound,
      totalEmailsFound,
      percentageCleaned: totalProcessed > 0 ? (totalCleaned / totalProcessed * 100).toFixed(1) : 0,
      percentageWithNames: totalProcessed > 0 ? (totalRedacted / totalProcessed * 100).toFixed(1) : 0,
      results: results.slice(0, 10) // Return first 10 for UI feedback
    });
    
  } catch (error) {
    console.error('Error processing emails:', error);
    
    const userId = (req as any).user.id;
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'error',
      command: 'PROCESS_EMAILS_ERROR',
      data: { 
        parsed: { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }
      }
    });
    
    res.status(500).json({ 
      error: 'Failed to process emails',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Redact names from existing emails
router.post('/redact-names', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    
    // Import nameRedactor
    const { nameRedactor } = await import('../lib/name-redactor');
    
    // Log the start of redaction
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'info',
      command: 'REDACT_NAMES_START',
      data: { 
        parsed: { action: 'Starting name redaction for existing emails' }
      }
    });

    // Initialize services
    const vectorStore = new VectorStore();
    await vectorStore.initialize();
    
    const embeddingService = new EmbeddingService();
    await embeddingService.initialize();
    
    // Get all relationships for the user
    const relationshipStats = await vectorStore.getRelationshipStats(userId);
    const relationships = Object.keys(relationshipStats);
    
    let totalProcessed = 0;
    let totalRedacted = 0;
    let totalNamesFound = 0;
    const results: any[] = [];
    
    for (const relationship of relationships) {
      const emails = await vectorStore.getByRelationship(userId, relationship, 1000);
      
      for (const email of emails) {
        // Skip if already has redacted names stored
        if (email.metadata.redactedNames && email.metadata.redactedNames.length > 0) {
          totalProcessed++;
          continue;
        }
        
        // Use extractedText (which should already have signatures removed) for redaction
        // Fall back to rawText if extractedText is not available
        const textToRedact = email.metadata.userReply || email.metadata.rawText || '';
        
        // Store the original text (before any processing) if not already stored
        const originalText = email.metadata.rawText || email.metadata.userReply || '';
        
        // Redact names from the signature-cleaned text
        const redactionResult = nameRedactor.redactNames(textToRedact);
        
        if (redactionResult.namesFound.length > 0) {
          // Log the email that was redacted
          realTimeLogger.log(userId, {
            userId,
            emailAccountId: 'all',
            level: 'info',
            command: 'REDACT_EMAIL',
            data: { 
              parsed: {
                emailId: email.id,
                relationship,
                status: 'redacted',
                namesFound: redactionResult.namesFound,
                count: redactionResult.namesFound.length
              }
            }
          });
          
          // Update the email in vector store
          const updatedMetadata = {
            ...email.metadata,
            userReply: redactionResult.text,  // Store redacted text
            rawText: originalText,               // Keep original text
            redactedNames: redactionResult.namesFound  // Store list of redacted names
          };
          
          // Re-embed with redacted text
          const { vector } = await embeddingService.embedText(redactionResult.text);
          
          // Update in vector store
          await vectorStore.upsertEmail({
            id: email.id,
            userId,
            vector,
            metadata: updatedMetadata
          });
          
          totalRedacted++;
          totalNamesFound += redactionResult.namesFound.length;
          results.push({
            emailId: email.id,
            relationship,
            namesRedacted: redactionResult.namesFound
          });
        } else {
          // Update metadata to indicate no names were found
          const updatedMetadata = {
            ...email.metadata,
            redactedNames: []  // Empty array indicates processing was done but no names found
          };
          
          // Update in vector store (no need to re-embed if text didn't change)
          await vectorStore.upsertEmail({
            id: email.id,
            userId,
            vector: email.vector,  // Keep existing vector
            metadata: updatedMetadata
          });
        }
        
        totalProcessed++;
        
        // Log progress every 50 emails
        if (totalProcessed % 50 === 0) {
          realTimeLogger.log(userId, {
            userId,
            emailAccountId: 'all',
            level: 'info',
            command: 'REDACT_PROGRESS',
            data: { 
              parsed: {
                processed: totalProcessed,
                redacted: totalRedacted,
                totalNames: totalNamesFound
              }
            }
          });
        }
      }
    }
    
    // Log completion
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'info',
      command: 'REDACT_NAMES_COMPLETE',
      data: { 
        parsed: {
          totalProcessed,
          totalRedacted,
          totalNamesFound,
          percentageWithNames: totalProcessed > 0 ? (totalRedacted / totalProcessed * 100).toFixed(1) : 0
        }
      }
    });
    
    res.json({
      success: true,
      totalProcessed,
      totalRedacted,
      totalNamesFound,
      percentageWithNames: totalProcessed > 0 ? (totalRedacted / totalProcessed * 100).toFixed(1) : 0,
      results: results.slice(0, 10) // Return first 10 for UI feedback
    });
    
  } catch (error) {
    console.error('Error redacting names:', error);
    
    const userId = (req as any).user.id;
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'all',
      level: 'error',
      command: 'REDACT_NAMES_ERROR',
      data: { 
        parsed: { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }
      }
    });
    
    res.status(500).json({ 
      error: 'Failed to redact names',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
