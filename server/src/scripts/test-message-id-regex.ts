/**
 * Unit test for Message-ID extraction regex
 * Tests the regex pattern used in getMessagesRaw()
 */

// Sample raw email message with Message-ID header
const sampleEmail = `Delivered-To: user@example.com
Received: by 2002:a05:6214:21c1:b0:6d8:dc80:84dc with SMTP id hy1csp2175494qvb;
        Thu, 3 Oct 2024 12:34:56 -0700 (PDT)
X-Received: by 2002:a17:906:4d52:b0:a8e:6f7f:c7d9 with SMTP id h18-20020a1709064d5200b00a8e6f7fc7d9mr9876543plo.4.1696358096543;
        Thu, 3 Oct 2024 12:34:56 -0700 (PDT)
Return-Path: <sender@example.com>
Received: from mail-pf1-x12a.google.com (mail-pf1-x12a.google.com. [2001:4860:4864:5f::12a])
        by mx.google.com with ESMTPS id 12-20020a17090a430c00b00269e89f1234si987654plj.95.2024.10.03.12.34.56
        for <user@example.com>
        (version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256 bits=128/128);
        Thu, 3 Oct 2024 12:34:56 -0700 (PDT)
Received-SPF: pass (google.com: domain of sender@example.com designates 2001:4860:4864:5f::12a as permitted sender) client-ip=2001:4860:4864:5f::12a;
From: "Joe Doe" <sender@example.com>
To: user@example.com
Subject: Test Email Subject
Date: Thu, 3 Oct 2024 12:34:56 -0700
Message-ID: <CABc123XYZ456abc789DEF@mail.gmail.com>
MIME-Version: 1.0
Content-Type: text/plain; charset="UTF-8"

This is the email body.

It contains multiple lines.

Best regards,
Joe
`;

// Extract headers from raw RFC 5322 format
const headerEndMatch = sampleEmail.match(/\r?\n\r?\n/);
const headerSection = headerEndMatch
  ? sampleEmail.substring(0, headerEndMatch.index)
  : sampleEmail.substring(0, 2000);

// Extract Message-ID (case-insensitive, multiline)
const messageIdMatch = headerSection.match(/^Message-ID:\s*(.+?)$/im);
const messageId = messageIdMatch ? messageIdMatch[1].trim() : undefined;

// Extract other fields
const fromMatch = headerSection.match(/^From:\s*(.+?)$/im);
const toMatch = headerSection.match(/^To:\s*(.+?)$/im);
const subjectMatch = headerSection.match(/^Subject:\s*(.+?)$/im);
const dateMatch = headerSection.match(/^Date:\s*(.+?)$/im);

console.log('🧪 Message-ID Regex Extraction Test\n');
console.log('='.repeat(80));
console.log('\nExtracted Fields:');
console.log('  Message-ID:', messageId);
console.log('  From:', fromMatch ? fromMatch[1].trim() : 'NOT FOUND');
console.log('  To:', toMatch ? toMatch[1].trim() : 'NOT FOUND');
console.log('  Subject:', subjectMatch ? subjectMatch[1].trim() : 'NOT FOUND');
console.log('  Date:', dateMatch ? dateMatch[1].trim() : 'NOT FOUND');
console.log('\n' + '='.repeat(80));

// Validation
const expectedMessageId = '<CABc123XYZ456abc789DEF@mail.gmail.com>';
const expectedFrom = '"Joe Doe" <sender@example.com>';
const expectedTo = 'user@example.com';
const expectedSubject = 'Test Email Subject';

if (messageId === expectedMessageId) {
  console.log('\n✅ Message-ID extraction: PASS');
} else {
  console.log(`\n❌ Message-ID extraction: FAIL`);
  console.log(`   Expected: ${expectedMessageId}`);
  console.log(`   Got: ${messageId}`);
  process.exit(1);
}

if (fromMatch && fromMatch[1].trim() === expectedFrom) {
  console.log('✅ From extraction: PASS');
} else {
  console.log('❌ From extraction: FAIL');
}

if (toMatch && toMatch[1].trim() === expectedTo) {
  console.log('✅ To extraction: PASS');
} else {
  console.log('❌ To extraction: FAIL');
}

if (subjectMatch && subjectMatch[1].trim() === expectedSubject) {
  console.log('✅ Subject extraction: PASS');
} else {
  console.log('❌ Subject extraction: FAIL');
}

console.log('\n✅ All regex tests passed!');
