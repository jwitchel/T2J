/**
 * Test script to verify normal emails still parse correctly
 *
 * This ensures our fix doesn't break normal email parsing
 */

import { EmailContentParser } from '../lib/email-content-parser';

const parser = new EmailContentParser();

// Normal email with proper text/plain
const normalEmail = `From: sender@example.com
To: receiver@example.com
Subject: Normal Email
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="----boundary456"
Message-ID: <normal-email@example.com>

------boundary456
Content-Type: text/plain; charset=UTF-8

This is a normal email with proper text/plain content.

It has multiple paragraphs and should be used directly
without needing HTML conversion.

Best regards,
Joe
------boundary456
Content-Type: text/html; charset=UTF-8

<html>
<body>
<p>This is a normal email with proper text/plain content.</p>
<p>It has multiple paragraphs and should be used directly
without needing HTML conversion.</p>
<p>Best regards,<br>Joe</p>
</body>
</html>
------boundary456--
`;

async function testNormalEmail() {
  console.log('Testing normal email parsing (should use text/plain)...\n');

  try {
    const parsed = await parser.parseFromRaw(normalEmail);

    console.log('✅ Email parsed successfully');
    console.log('\nParsed content:');
    console.log('- Message ID:', parsed.messageId);
    console.log('- Plain text length:', parsed.userTextPlain.length);
    console.log('- Plain text:', parsed.userTextPlain);

    // Verify it used text/plain (not HTML converted)
    if (parsed.userTextPlain.includes('This is a normal email')) {
      console.log('\n✅ SUCCESS: Normal emails still use text/plain directly');
      console.log('The fix does not break normal email parsing!');
    } else {
      console.log('\n❌ FAILED: Normal email was not parsed correctly');
      process.exit(1);
    }

    // Verify it didn't convert from HTML (text/plain should not have <p> tags or HTML)
    if (parsed.userTextPlain.includes('<p>') || parsed.userTextPlain.includes('</p>')) {
      console.log('\n❌ FAILED: Text contains HTML tags, suggesting HTML conversion was used incorrectly');
      process.exit(1);
    }

    console.log('✅ Text/plain was used correctly (no HTML tags in text)');

  } catch (error) {
    console.error('\n❌ ERROR parsing email:', error);
    process.exit(1);
  }
}

// Run the test
testNormalEmail();
