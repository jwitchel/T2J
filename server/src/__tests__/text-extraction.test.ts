import { EmailProcessor } from '../lib/email-processor';
import { Pool } from 'pg';

// Create a mock pool for testing
const mockPool = {} as Pool;
const emailProcessor = new EmailProcessor(mockPool);
import { testEmailGenerator } from '../lib/test-sent-emails';
import { createPipelineFromEmails, processEmailBatch } from '../lib/sent-email-pipeline';
import { ParsedMail } from 'mailparser';
import { replyExtractor } from '../lib/reply-extractor';
import _ from 'highland';

describe('Email Text Extraction', () => {
  describe('Reply Extraction', () => {
    it('should extract only user text from simple reply', () => {
      const emailBody = `Thanks for the invite!

> The birthday is Saturday
>> When is the birthday?`;
      
      const result = replyExtractor.extractUserText(emailBody);
      expect(result).toBe('Thanks for the invite!');
    });

    it('should handle Gmail-style quotes', () => {
      const emailBody = `I'll be there!

On Mon, Jan 15, 2024 at 9:00 AM Joe Doe <joe@example.com> wrote:
> Let's meet at 2pm
> 
> Thanks,
> Joe`;
      
      const result = replyExtractor.extractUserText(emailBody);
      expect(result).toBe("I'll be there!");
    });

    it('should handle Outlook-style quotes', () => {
      const emailBody = `Sounds good to me.

Thanks!

-----Original Message-----
From: Alice Smith <alice@company.com>
Sent: Monday, January 15, 2024 8:30 AM
To: Bob Jones <bob@company.com>
Subject: Meeting

Can we meet tomorrow?`;
      
      const result = replyExtractor.extractUserText(emailBody);
      expect(result).toBe('Sounds good to me.\n\nThanks!');
    });

    it('should handle multiple quote levels', () => {
      const emailBody = `Final answer: yes

> Maybe we should reconsider
>> I don't think so
>>> What do you think?`;
      
      const result = replyExtractor.extractUserText(emailBody);
      expect(result).toBe('Final answer: yes');
    });

    it('should preserve signatures', () => {
      const emailBody = `I agree with your proposal.

Best regards,
John Smith
CEO, Acme Corp

> Please review the attached proposal`;
      
      const result = replyExtractor.extractUserText(emailBody);
      expect(result).toBe('I agree with your proposal.\n\nBest regards,\nJohn Smith\nCEO, Acme Corp');
    });

    it('should handle empty replies', () => {
      const emailBody = `> Just wanted to let you know`;
      
      const result = replyExtractor.extractUserText(emailBody);
      expect(result).toBe('');
    });

    it('should extract from HTML content', () => {
      const htmlContent = `<html>
<body>
<p>I <strong>love</strong> this idea!</p>
<blockquote>What do you think?</blockquote>
</body>
</html>`;
      
      const result = replyExtractor.extractFromHtml(htmlContent);
      expect(result).toBe('I love this idea!');
    });
  });

  describe('Comprehensive Test Dataset', () => {
    const testEmails = testEmailGenerator.generateTestEmails();
    
    it('should generate at least 32 test emails', () => {
      expect(testEmails.length).toBeGreaterThanOrEqual(32);
    });

    it('should accurately extract text from all test emails', () => {
      let passCount = 0;
      let failCount = 0;
      
      for (const testEmail of testEmails) {
        const extracted = replyExtractor.extractUserText(testEmail.textContent);
        if (extracted === testEmail.expectedExtraction) {
          passCount++;
        } else {
          failCount++;
          console.error(`Failed: ${testEmail.id} (${testEmail.category})`);
          console.error(`Expected: "${testEmail.expectedExtraction}"`);
          console.error(`Got: "${extracted}"`);
        }
      }
      
      const accuracy = (passCount / testEmails.length) * 100;
      expect(accuracy).toBe(100);
      expect(failCount).toBe(0);
    });

    it('should handle all email categories', () => {
      const categories = new Set(testEmails.map(e => e.category));
      const expectedCategories = [
        'simple', 'multi-paragraph', 'reply-depth', 'quote-format',
        'forward', 'signature', 'auto-reply', 'meeting', 'emoji',
        'html', 'multilingual', 'mobile', 'edge-case', 'corporate'
      ];
      
      for (const category of expectedCategories) {
        expect(categories.has(category)).toBe(true);
      }
    });
  });

  describe('Email Processor', () => {
    it('should process ParsedMail and extract user text', async () => {
      const testEmail = testEmailGenerator.generateTestEmails()[1]; // Get a reply email
      const parsedMail = testEmailGenerator.convertToParsedMail(testEmail) as unknown as ParsedMail;
      
      const result = await emailProcessor.processEmail(parsedMail);
      
      expect(result.messageId).toBe(parsedMail.messageId);
      expect(result.userTextPlain).toBe(testEmail.expectedExtraction);
    });

    it('should preserve both plain and rich text', async () => {
      const htmlEmails = testEmailGenerator.generateTestEmails().filter(e => e.htmlContent);
      expect(htmlEmails.length).toBeGreaterThan(0);
      
      // Test with the first HTML email
      const htmlEmail = htmlEmails[0];
      const parsedMail = testEmailGenerator.convertToParsedMail(htmlEmail) as unknown as ParsedMail;
      const result = await emailProcessor.processEmail(parsedMail);
      
      expect(result.userTextPlain).toBeDefined();
      expect(result.userTextRich).toBeDefined();
      expect(result.userTextPlain.length).toBeGreaterThan(0);
    });
  });

  describe('Highland.js Pipeline', () => {
    it('should process emails in batches', async () => {
      const testEmails = testEmailGenerator.generateTestEmails().slice(0, 10);
      const parsedEmails = testEmails.map(e => 
        testEmailGenerator.convertToParsedMail(e) as unknown as ParsedMail
      );
      
      const { results, metrics } = await processEmailBatch(parsedEmails, {
        userId: 'test-user',
        emailAccountId: 'test-account',
        batchSize: 3
      });
      
      expect(results.length).toBe(10);
      expect(metrics.processedCount).toBe(10);
      expect(metrics.errorCount).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      const testEmails = testEmailGenerator.generateTestEmails().slice(0, 5);
      const parsedEmails = testEmails.map((e, i) => {
        const parsed = testEmailGenerator.convertToParsedMail(e) as unknown as ParsedMail;
        // Make some emails invalid
        if (i % 2 === 0) {
          parsed.text = '';
          parsed.html = false;
        }
        return parsed;
      });
      
      const { results, metrics } = await processEmailBatch(parsedEmails, {
        userId: 'test-user',
        emailAccountId: 'test-account',
        batchSize: 2
      });
      
      // Should still process valid emails
      expect(results.length).toBeGreaterThan(0);
      expect(metrics.processedCount + metrics.errorCount).toBeLessThanOrEqual(parsedEmails.length);
    });

    it('should respect concurrency settings', async () => {
      const originalConcurrency = process.env.EMAIL_PIPELINE_CONCURRENCY;
      process.env.EMAIL_PIPELINE_CONCURRENCY = '1';
      
      const testEmails = testEmailGenerator.generateTestEmails().slice(0, 5);
      const parsedEmails = testEmails.map(e => 
        testEmailGenerator.convertToParsedMail(e) as unknown as ParsedMail
      );
      
      const startTime = Date.now();
      await processEmailBatch(parsedEmails, {
        userId: 'test-user',
        emailAccountId: 'test-account',
        batchSize: 1
      });
      const duration = Date.now() - startTime;
      
      // With concurrency=1 and rate limiting, should take some time
      expect(duration).toBeGreaterThan(100);
      
      // Restore original setting
      if (originalConcurrency) {
        process.env.EMAIL_PIPELINE_CONCURRENCY = originalConcurrency;
      } else {
        delete process.env.EMAIL_PIPELINE_CONCURRENCY;
      }
    });
  });

  describe('Performance Tests', () => {
    it('should handle 1000+ emails without memory issues', async () => {
      const testEmails = testEmailGenerator.generateTestEmails();
      const largeEmailSet: ParsedMail[] = [];
      
      // Generate 1000 emails by repeating the test set
      for (let i = 0; i < 1000; i++) {
        const email = testEmails[i % testEmails.length];
        largeEmailSet.push(
          testEmailGenerator.convertToParsedMail(email) as unknown as ParsedMail
        );
      }
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      const { results, metrics } = await processEmailBatch(largeEmailSet, {
        userId: 'test-user',
        emailAccountId: 'test-account',
        batchSize: 50
      });
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncreaseMB = (finalMemory - initialMemory) / 1024 / 1024;
      
      // Should process most emails successfully (allowing for some HTML parsing issues)
      expect(results.length).toBeGreaterThan(900);
      expect(metrics.processedCount).toBeGreaterThan(900);
      expect(metrics.errorCount).toBeLessThan(100);
      
      // Memory increase should be reasonable (less than 100MB for 1000 emails)
      expect(memoryIncreaseMB).toBeLessThan(100);
      
      // Should process efficiently (at least 100 emails/second)
      const duration = (metrics.endTime! - metrics.startTime) / 1000;
      const emailsPerSecond = metrics.processedCount / duration;
      expect(emailsPerSecond).toBeGreaterThan(100);
    }, 10000); // 10 second timeout for performance test

    it('should maintain consistent processing speed', async () => {
      const testEmails = testEmailGenerator.generateTestEmails();
      const emailBatches = [];
      
      // Create 5 batches of 100 emails each
      for (let batch = 0; batch < 5; batch++) {
        const batchEmails: ParsedMail[] = [];
        for (let i = 0; i < 100; i++) {
          const email = testEmails[i % testEmails.length];
          batchEmails.push(
            testEmailGenerator.convertToParsedMail(email) as unknown as ParsedMail
          );
        }
        emailBatches.push(batchEmails);
      }
      
      const processingTimes: number[] = [];
      
      // Process each batch and measure time
      for (const batch of emailBatches) {
        const startTime = Date.now();
        await processEmailBatch(batch, {
          userId: 'test-user',
          emailAccountId: 'test-account',
          batchSize: 20
        });
        processingTimes.push(Date.now() - startTime);
      }
      
      // Calculate variance in processing times
      const avgTime = processingTimes.reduce((a, b) => a + b) / processingTimes.length;
      const variance = processingTimes.reduce((sum, time) => 
        sum + Math.pow(time - avgTime, 2), 0
      ) / processingTimes.length;
      const stdDev = Math.sqrt(variance);
      
      // Standard deviation should be less than 20% of average
      // This ensures consistent performance
      expect(stdDev / avgTime).toBeLessThan(0.2);
    });
  });

  describe('Quote Format Coverage', () => {
    const quoteFormats = [
      { name: 'Gmail', pattern: /On .+ wrote:/ },
      { name: 'Outlook', pattern: /-----Original Message-----/ },
      { name: 'Simple quotes', pattern: /^>/m },
      { name: 'Forward', pattern: /---------- Forwarded message ---------/ }
    ];

    quoteFormats.forEach(({ name, pattern }) => {
      it(`should handle ${name} quote format`, () => {
        const emails = testEmailGenerator.generateTestEmails()
          .filter(e => pattern.test(e.textContent));
        
        expect(emails.length).toBeGreaterThan(0);
        
        emails.forEach(email => {
          const result = replyExtractor.extractUserText(email.textContent);
          expect(result).toBe(email.expectedExtraction);
        });
      });
    });
  });
});