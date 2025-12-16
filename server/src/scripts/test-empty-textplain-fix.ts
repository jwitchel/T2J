/**
 * Test script to verify the empty text/plain fallback fix
 *
 * This tests the fix for emails like Venmo receipts that have:
 * - Empty text/plain part
 * - Full content in text/html part
 */

import { EmailContentParser } from '../lib/email-content-parser';

const parser = new EmailContentParser();

// Simulated Venmo-style email with empty text/plain
const testEmail = `From: Venmo <venmo@venmo.com>
To: test@example.com
Subject: Receipt from Test Merchant - $100.00
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="----boundary123"
Message-ID: <test-empty-textplain@example.com>

------boundary123
Content-Type: text/plain; charset=UTF-8


------boundary123
Content-Type: text/html; charset=UTF-8

<html>
<body>
<h1>Receipt from Test Merchant</h1>
<p>Purchase Amount: $100.00</p>
<p>Date: Monday, October 20 at 06:44PM PDT</p>
<p>From: Joe Doe</p>
<p>Total: $100.00</p>
</body>
</html>
------boundary123--
`;

async function testEmptyTextPlainFix() {
  console.log('Testing empty text/plain fallback fix...\n');

  try {
    const parsed = await parser.parseFromRaw(testEmail);

    console.log('✅ Email parsed successfully');
    console.log('\nParsed content:');
    console.log('- Message ID:', parsed.messageId);
    console.log('- From:', parsed.from);
    console.log('- To:', parsed.to);
    console.log('- Date:', parsed.sentDate);
    console.log('\n- Plain text length:', parsed.userTextPlain.length);
    console.log('- Plain text preview:', parsed.userTextPlain.substring(0, 200));
    console.log('\n- Has rich text:', !!parsed.userTextRich);

    if (parsed.userTextPlain.trim().length === 0) {
      console.log('\n❌ FAILED: userTextPlain is still empty!');
      console.log('The HTML-to-text fallback did not work.');
      process.exit(1);
    }

    if (parsed.userTextPlain.toLowerCase().includes('receipt from test merchant')) {
      console.log('\n✅ SUCCESS: HTML content was converted to text');
      console.log('The fix is working correctly!');
    } else {
      console.log('\n⚠️  WARNING: Text extracted but may not contain expected content');
      console.log('Extracted text:', parsed.userTextPlain);
    }

  } catch (error) {
    console.error('\n❌ ERROR parsing email:', error);
    process.exit(1);
  }
}

// Run the test
testEmptyTextPlainFix();
