/**
 * Test script to verify Message-ID extraction from IMAP
 * Tests the fix for getMessagesRaw() parsing headers from Buffer
 */

import { ImapOperations } from '../lib/imap-operations';
import { emailStorageService } from '../lib/email-storage-service';
import { EmailDirection } from '../types/email-action-tracking';

async function testMessageIdExtraction() {
  console.log('🧪 Testing Message-ID Extraction from IMAP...\n');

  const emailAccountId = '687d0c14-0075-4426-bd10-8fbeab947235'; // test-account@example.com (test1 user)
  const userId = 'febcebaa-a3a3-4127-8911-65a1653d13ba'; // test1@example.com

  try {
    // Initialize EmailStorageService
    await emailStorageService.initialize();
    console.log('✅ Initialized EmailStorageService\n');

    // Connect to IMAP
    const imapOps = await ImapOperations.fromAccountId(emailAccountId, userId);
    console.log('✅ Connected to IMAP\n');

    // Try different sent folder names
    const sentFolders = ['Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail'];
    let folderUsed = '';
    let messages: any[] = [];

    for (const folder of sentFolders) {
      try {
        console.log(`📂 Trying folder: ${folder}...`);
        const searchResults = await imapOps.searchMessages(folder, {
          before: new Date() // All emails before now
        }, { limit: 5 });

        if (searchResults.length > 0) {
          messages = searchResults;
          folderUsed = folder;
          console.log(`✅ Found ${searchResults.length} messages in ${folder}\n`);
          break;
        }
      } catch (err) {
        console.log(`❌ Folder ${folder} not found or error: ${err}`);
      }
    }

    if (messages.length === 0) {
      console.log('❌ No sent emails found in any folder');
      process.exit(1);
    }

    console.log(`\n📧 Fetching ${messages.length} messages with getMessagesRaw()...`);
    const uids = messages.map((m: any) => m.uid);
    const fullMessages = await imapOps.getMessagesRaw(folderUsed, uids);

    console.log(`\n🔍 Message-ID Extraction Results:\n`);
    console.log('='.repeat(80));

    for (let i = 0; i < fullMessages.length; i++) {
      const msg = fullMessages[i] as any; // Cast to any to access additional properties
      console.log(`\nMessage ${i + 1}:`);
      console.log(`  UID: ${msg.uid}`);
      console.log(`  Message-ID: ${msg.messageId || 'UNDEFINED ❌'}`);
      console.log(`  From: ${msg.from || 'UNDEFINED'}`);
      console.log(`  To: ${msg.to ? msg.to.join(', ') : 'UNDEFINED'}`);
      console.log(`  Subject: ${msg.subject || 'UNDEFINED'}`);
      console.log(`  Date: ${msg.date ? msg.date.toISOString() : 'UNDEFINED'}`);
      console.log(`  Flags: ${msg.flags ? msg.flags.join(', ') : 'UNDEFINED'}`);
      console.log(`  Size: ${msg.size || 'UNDEFINED'}`);
      console.log(`  Has fullMessage: ${!!msg.fullMessage ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  Has bodystructure: ${!!msg.bodystructure ? 'YES ✅' : 'NO ❌'}`);
    }

    console.log('\n' + '='.repeat(80));

    // Test saving to database
    console.log(`\n💾 Testing save to database...`);
    const firstMessage = fullMessages[0];

    if (firstMessage.messageId) {
      const saveResult = await emailStorageService.saveEmail({
        userId,
        emailAccountId,
        emailData: firstMessage,
        emailType: EmailDirection.SENT,
        folderName: folderUsed
      });

      if (saveResult.success) {
        console.log(`✅ Successfully saved email to database!`);
        console.log(`   Skipped: ${saveResult.skipped}`);
        console.log(`   Saved count: ${saveResult.saved}`);
      } else {
        console.log(`❌ Failed to save email: ${saveResult.error}`);
      }
    } else {
      console.log(`❌ Cannot test save - Message-ID is undefined`);
    }

    console.log('\n✅ Test complete!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testMessageIdExtraction();
