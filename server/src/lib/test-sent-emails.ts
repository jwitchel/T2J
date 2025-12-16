import { ParsedMail } from 'mailparser';

export interface TestEmail {
  id: string;
  name: string;
  category: string;
  from: string;
  to: string[];
  subject: string;
  date: Date;
  textContent: string;
  htmlContent?: string;
  expectedExtraction: string;
  description: string;
}

/**
 * Generate comprehensive test emails covering 50+ variations
 */
export class TestEmailGenerator {
  private testAccounts = {
    user1: 'user1@testmail.local',
    user2: 'user2@testmail.local',
    user3: 'user3@testmail.local'
  };

  /**
   * Generate all test emails
   */
  generateTestEmails(): TestEmail[] {
    const emails: TestEmail[] = [];
    
    // Simple responses
    emails.push(...this._generateSimpleResponses());
    
    // Multi-paragraph emails
    emails.push(...this._generateMultiParagraphEmails());
    
    // Various reply depths
    emails.push(...this._generateReplyDepthVariations());
    
    // Different quote formats
    emails.push(...this._generateQuoteFormatVariations());
    
    // Forwarded emails
    emails.push(...this._generateForwardedEmails());
    
    // Signatures
    emails.push(...this._generateSignatureVariations());
    
    // Auto-replies
    emails.push(...this._generateAutoReplies());
    
    // Meeting/Calendar responses
    emails.push(...this._generateMeetingResponses());
    
    // Emoji-rich emails
    emails.push(...this._generateEmojiEmails());
    
    // Rich HTML emails
    emails.push(...this._generateRichHtmlEmails());
    
    // Different languages
    emails.push(...this._generateMultilingualEmails());
    
    // Mobile signatures
    emails.push(...this._generateMobileEmails());
    
    // Edge cases
    emails.push(...this._generateEdgeCases());
    
    // Corporate emails
    emails.push(...this._generateCorporateEmails());
    
    return emails;
  }

  private _generateSimpleResponses(): TestEmail[] {
    return [
      {
        id: 'simple-1',
        name: 'One-line response',
        category: 'simple',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Quick question',
        date: new Date('2024-01-15T10:00:00Z'),
        textContent: 'Sure, that works for me!',
        expectedExtraction: 'Sure, that works for me!',
        description: 'Simple one-line response with no quotes'
      },
      {
        id: 'simple-2',
        name: 'Short response with quote',
        category: 'simple',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Lunch?',
        date: new Date('2024-01-15T11:00:00Z'),
        textContent: `Sounds good!

> Want to grab lunch at noon?`,
        expectedExtraction: 'Sounds good!',
        description: 'Short response with single-level quote'
      },
      {
        id: 'simple-3',
        name: 'Yes/No response',
        category: 'simple',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Can you review?',
        date: new Date('2024-01-15T12:00:00Z'),
        textContent: `Yes

> Can you review the PR by EOD?`,
        expectedExtraction: 'Yes',
        description: 'Single word response'
      }
    ];
  }

  private _generateMultiParagraphEmails(): TestEmail[] {
    return [
      {
        id: 'multi-1',
        name: 'Multi-paragraph response',
        category: 'multi-paragraph',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Project proposal',
        date: new Date('2024-01-15T13:00:00Z'),
        textContent: `Thanks for sharing the proposal. I've had a chance to review it in detail.

Overall, I think the approach is solid. The timeline seems realistic and the budget allocation makes sense.

I do have a few suggestions:
- We might want to add a buffer for the testing phase
- Consider bringing in a UX designer earlier in the process
- The risk mitigation section could use more detail

Let me know if you'd like to discuss these points further.

> Please review the attached project proposal and let me know your thoughts.`,
        expectedExtraction: `Thanks for sharing the proposal. I've had a chance to review it in detail.

Overall, I think the approach is solid. The timeline seems realistic and the budget allocation makes sense.

I do have a few suggestions:
- We might want to add a buffer for the testing phase
- Consider bringing in a UX designer earlier in the process
- The risk mitigation section could use more detail

Let me know if you'd like to discuss these points further.`,
        description: 'Multi-paragraph response with bullet points'
      }
    ];
  }

  private _generateReplyDepthVariations(): TestEmail[] {
    return [
      {
        id: 'depth-1',
        name: 'Single level quote',
        category: 'reply-depth',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Meeting time',
        date: new Date('2024-01-15T14:00:00Z'),
        textContent: `3pm works better for me

> How about 2pm for the meeting?`,
        expectedExtraction: '3pm works better for me',
        description: 'Single level of quoting'
      },
      {
        id: 'depth-2',
        name: 'Two level quotes',
        category: 'reply-depth',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Meeting time',
        date: new Date('2024-01-15T14:30:00Z'),
        textContent: `Let's go with 3pm then

> 3pm works better for me
>> How about 2pm for the meeting?`,
        expectedExtraction: "Let's go with 3pm then",
        description: 'Two levels of quoting'
      },
      {
        id: 'depth-5',
        name: 'Five level quotes',
        category: 'reply-depth',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Long thread',
        date: new Date('2024-01-15T15:00:00Z'),
        textContent: `Finally resolved!

> I think we found the issue
>> Still investigating
>>> Looking into it now
>>>> I'll check the logs
>>>>> We're seeing errors in production`,
        expectedExtraction: 'Finally resolved!',
        description: 'Five levels of nested quotes'
      }
    ];
  }

  private _generateQuoteFormatVariations(): TestEmail[] {
    return [
      {
        id: 'quote-gmail',
        name: 'Gmail style quote',
        category: 'quote-format',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Budget approval',
        date: new Date('2024-01-15T16:00:00Z'),
        textContent: `Approved! Please proceed with the purchase.

On Mon, Jan 15, 2024 at 9:00 AM Joe Doe <joe@company.com> wrote:
> Hi Sarah,
> 
> We need approval for the new software licenses.
> Total cost: $5,000
> 
> Thanks,
> Joe`,
        expectedExtraction: 'Approved! Please proceed with the purchase.',
        description: 'Gmail-style attribution line'
      },
      {
        id: 'quote-outlook',
        name: 'Outlook style quote',
        category: 'quote-format',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'RE: Conference registration',
        date: new Date('2024-01-15T16:30:00Z'),
        textContent: `I'll register today.

Thanks for the reminder!

-----Original Message-----
From: Alice Smith <alice@company.com>
Sent: Monday, January 15, 2024 8:30 AM
To: Bob Jones <bob@company.com>
Subject: Conference registration

Don't forget to register for the conference by Friday.

-Alice`,
        expectedExtraction: `I'll register today.

Thanks for the reminder!`,
        description: 'Outlook-style quote headers'
      },
      {
        id: 'quote-mixed',
        name: 'Mixed quote styles',
        category: 'quote-format',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Status update',
        date: new Date('2024-01-15T17:00:00Z'),
        textContent: `Here's my update:
- Feature A: Complete
- Feature B: In progress
- Feature C: Not started

> Thanks for the update on Feature A
On Fri, Jan 12, 2024 at 4:00 PM Team Lead <lead@company.com> wrote:
>> Can everyone send their status updates?
>>> We need these for the client meeting`,
        expectedExtraction: `Here's my update:
- Feature A: Complete
- Feature B: In progress
- Feature C: Not started`,
        description: 'Multiple quote styles in same email'
      }
    ];
  }

  private _generateForwardedEmails(): TestEmail[] {
    return [
      {
        id: 'fwd-1',
        name: 'Simple forward',
        category: 'forward',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user3],
        subject: 'Fwd: Important announcement',
        date: new Date('2024-01-15T18:00:00Z'),
        textContent: `FYI - This might interest you.

---------- Forwarded message ---------
From: HR Department <hr@company.com>
Date: Mon, Jan 15, 2024 at 9:00 AM
Subject: Important announcement
To: All Staff <all@company.com>

We're pleased to announce the new benefits package...`,
        expectedExtraction: 'FYI - This might interest you.',
        description: 'Forwarded email with user comment'
      },
      {
        id: 'fwd-2',
        name: 'Forward without comment',
        category: 'forward',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user3],
        subject: 'Fwd: Meeting notes',
        date: new Date('2024-01-15T18:30:00Z'),
        textContent: `---------- Forwarded message ---------
From: Meeting Organizer <organizer@company.com>
Date: Mon, Jan 15, 2024 at 2:00 PM
Subject: Meeting notes
To: Attendees <attendees@company.com>

Here are the notes from today's meeting...`,
        expectedExtraction: '',
        description: 'Forwarded email with no added content'
      }
    ];
  }

  private _generateSignatureVariations(): TestEmail[] {
    return [
      {
        id: 'sig-1',
        name: 'Professional signature',
        category: 'signature',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Contract review',
        date: new Date('2024-01-16T09:00:00Z'),
        textContent: `I've reviewed the contract and everything looks good to me.

Best regards,
Joe Smith

--
Joe Smith
Senior Legal Counsel
Acme Corporation
Direct: +1 (555) 123-4567
Mobile: +1 (555) 987-6543
Email: joe.smith@acme.com
LinkedIn: linkedin.com/in/joesmith

This email is confidential and may be legally privileged.

> Please review the attached contract`,
        expectedExtraction: `I've reviewed the contract and everything looks good to me.

Best regards,
Joe Smith

--
Joe Smith
Senior Legal Counsel
Acme Corporation
Direct: +1 (555) 123-4567
Mobile: +1 (555) 987-6543
Email: joe.smith@acme.com
LinkedIn: linkedin.com/in/joesmith

This email is confidential and may be legally privileged.`,
        description: 'Email with professional signature block'
      },
      {
        id: 'sig-2',
        name: 'Casual signature',
        category: 'signature',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Weekend plans',
        date: new Date('2024-01-16T10:00:00Z'),
        textContent: `Count me in!

-J

> Anyone up for hiking this weekend?`,
        expectedExtraction: `Count me in!

-J`,
        description: 'Email with casual signature'
      }
    ];
  }

  private _generateAutoReplies(): TestEmail[] {
    return [
      {
        id: 'auto-1',
        name: 'Out of office',
        category: 'auto-reply',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Out of Office: Re: Project update',
        date: new Date('2024-01-16T11:00:00Z'),
        textContent: `Hi,

I'm currently out of the office and will return on Monday, January 22nd.

I'll have limited access to email during this time. For urgent matters, please contact my colleague Jane Doe at jane.doe@company.com.

I'll respond to your message when I return.

Best regards,
Joe Smith

> Hi Joe, could you send me the latest project update?`,
        expectedExtraction: `Hi,

I'm currently out of the office and will return on Monday, January 22nd.

I'll have limited access to email during this time. For urgent matters, please contact my colleague Jane Doe at jane.doe@company.com.

I'll respond to your message when I return.

Best regards,
Joe Smith`,
        description: 'Automatic out-of-office reply'
      }
    ];
  }

  private _generateMeetingResponses(): TestEmail[] {
    return [
      {
        id: 'meeting-1',
        name: 'Meeting acceptance',
        category: 'meeting',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Accepted: Team Standup @ Mon Jan 15, 2024 10am - 10:30am',
        date: new Date('2024-01-14T15:00:00Z'),
        textContent: `I'll be there!

Looking forward to discussing the new features.`,
        expectedExtraction: `I'll be there!

Looking forward to discussing the new features.`,
        description: 'Calendar meeting acceptance with comment'
      },
      {
        id: 'meeting-2',
        name: 'Meeting decline',
        category: 'meeting',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Declined: Budget Review @ Tue Jan 16, 2024 2pm - 3pm',
        date: new Date('2024-01-14T16:00:00Z'),
        textContent: `Sorry, I have a conflict at that time. Can we reschedule for Wednesday?`,
        expectedExtraction: 'Sorry, I have a conflict at that time. Can we reschedule for Wednesday?',
        description: 'Calendar meeting decline with reason'
      }
    ];
  }

  private _generateEmojiEmails(): TestEmail[] {
    return [
      {
        id: 'emoji-1',
        name: 'Emoji-rich casual email',
        category: 'emoji',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Team celebration 🎉',
        date: new Date('2024-01-16T14:00:00Z'),
        textContent: `Awesome news! 🎊 So proud of what we've accomplished! 💪

I'll bring:
• Pizza 🍕
• Drinks 🥤
• Cake 🎂

Can't wait to celebrate with everyone! 🥳

> We hit our Q4 targets! Time to celebrate! 🎯`,
        expectedExtraction: `Awesome news! 🎊 So proud of what we've accomplished! 💪

I'll bring:
• Pizza 🍕
• Drinks 🥤
• Cake 🎂

Can't wait to celebrate with everyone! 🥳`,
        description: 'Email with multiple emojis throughout'
      },
      {
        id: 'emoji-2',
        name: 'Professional email with subtle emojis',
        category: 'emoji',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Q1 Planning',
        date: new Date('2024-01-16T15:00:00Z'),
        textContent: `Great presentation today! The roadmap looks solid 👍

A few thoughts:
• The timeline for Feature A seems aggressive
• Love the focus on user experience ✨
• We should sync with the design team early

Looking forward to getting started!

> Please review the Q1 roadmap presentation`,
        expectedExtraction: `Great presentation today! The roadmap looks solid 👍

A few thoughts:
• The timeline for Feature A seems aggressive
• Love the focus on user experience ✨
• We should sync with the design team early

Looking forward to getting started!`,
        description: 'Professional tone with selective emoji use'
      }
    ];
  }

  private _generateRichHtmlEmails(): TestEmail[] {
    return [
      {
        id: 'html-1',
        name: 'Formatted HTML email',
        category: 'html',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Marketing campaign',
        date: new Date('2024-01-16T16:00:00Z'),
        textContent: `I love the direction! Here are my thoughts:

• The color scheme is perfect
• The headline needs to be bolder
• Consider A/B testing the CTA button

Let's ship it!`,
        htmlContent: `<html>
<body style="font-family: Arial, sans-serif;">
<p>I <strong>love</strong> the direction! Here are my thoughts:</p>
<ul>
<li>The <span style="color: #ff6b6b;">color scheme</span> is perfect</li>
<li>The headline needs to be <strong>bolder</strong></li>
<li>Consider A/B testing the <span style="background-color: #4ecdc4; color: white; padding: 2px 4px;">CTA button</span></li>
</ul>
<p><em>Let's ship it!</em></p>
<blockquote style="border-left: 3px solid #ccc; margin-left: 0; padding-left: 10px;">
<p>Take a look at the new marketing campaign mockups...</p>
</blockquote>
</body>
</html>`,
        expectedExtraction: `I love the direction! Here are my thoughts:

• The color scheme is perfect
• The headline needs to be bolder
• Consider A/B testing the CTA button

Let's ship it!`,
        description: 'HTML email with formatting, colors, and styles'
      },
      {
        id: 'html-2',
        name: 'HTML email with tables',
        category: 'html',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Quarterly metrics',
        date: new Date('2024-01-16T17:00:00Z'),
        textContent: `The numbers look great! Especially impressed with the user growth.

See you at the board meeting.`,
        htmlContent: `<html>
<body>
<p>The numbers look <strong>great</strong>! Especially impressed with the user growth.</p>
<p>See you at the board meeting.</p>
<blockquote>
<p>Here are the Q4 metrics:</p>
<table border="1">
<tr><th>Metric</th><th>Q3</th><th>Q4</th><th>Growth</th></tr>
<tr><td>Users</td><td>10,000</td><td>15,000</td><td>+50%</td></tr>
<tr><td>Revenue</td><td>$1M</td><td>$1.5M</td><td>+50%</td></tr>
</table>
</blockquote>
</body>
</html>`,
        expectedExtraction: `The numbers look great! Especially impressed with the user growth.

See you at the board meeting.`,
        description: 'HTML email with table in quoted content'
      }
    ];
  }

  private _generateMultilingualEmails(): TestEmail[] {
    return [
      {
        id: 'lang-1',
        name: 'Spanish response',
        category: 'multilingual',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Reunión del equipo',
        date: new Date('2024-01-17T09:00:00Z'),
        textContent: `¡Perfecto! Nos vemos mañana a las 3pm.

Saludos,
Carlos

> ¿Podemos reunirnos mañana para discutir el proyecto?`,
        expectedExtraction: `¡Perfecto! Nos vemos mañana a las 3pm.

Saludos,
Carlos`,
        description: 'Spanish language email'
      },
      {
        id: 'lang-2',
        name: 'Japanese response',
        category: 'multilingual',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: 会議の件',
        date: new Date('2024-01-17T10:00:00Z'),
        textContent: `承知いたしました。明日の会議でお会いしましょう。

よろしくお願いします。
田中

> 明日の会議の件ですが、3時からで大丈夫でしょうか？`,
        expectedExtraction: `承知いたしました。明日の会議でお会いしましょう。

よろしくお願いします。
田中`,
        description: 'Japanese language email'
      },
      {
        id: 'lang-3',
        name: 'Mixed language response',
        category: 'multilingual',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: International team sync',
        date: new Date('2024-01-17T11:00:00Z'),
        textContent: `Sounds good! I'll prepare the slides.

BTW, I'll present in English, but feel free to ask questions in español or 日本語.

À bientôt!

> Let's have our international team sync tomorrow`,
        expectedExtraction: `Sounds good! I'll prepare the slides.

BTW, I'll present in English, but feel free to ask questions in español or 日本語.

À bientôt!`,
        description: 'Email mixing multiple languages'
      }
    ];
  }

  private _generateMobileEmails(): TestEmail[] {
    return [
      {
        id: 'mobile-1',
        name: 'iPhone signature',
        category: 'mobile',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Quick update',
        date: new Date('2024-01-17T12:00:00Z'),
        textContent: `On it!

Sent from my iPhone

> Can you handle the client presentation?`,
        expectedExtraction: `On it!

Sent from my iPhone`,
        description: 'Email with iPhone signature'
      },
      {
        id: 'mobile-2',
        name: 'Android signature with typo',
        category: 'mobile',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Budget approvl',
        date: new Date('2024-01-17T13:00:00Z'),
        textContent: `Approved. Pls proceed with purchse

Sent from my Android device
Please excuse any typos

> Need approval for $5k software license`,
        expectedExtraction: `Approved. Pls proceed with purchse

Sent from my Android device
Please excuse any typos`,
        description: 'Mobile email with typical typos'
      }
    ];
  }

  private _generateEdgeCases(): TestEmail[] {
    return [
      {
        id: 'edge-1',
        name: 'Empty reply',
        category: 'edge-case',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: FYI',
        date: new Date('2024-01-17T14:00:00Z'),
        textContent: `> Just wanted to let you know about the update
>> The system will be down for maintenance tonight`,
        expectedExtraction: '',
        description: 'Email with only quoted content'
      },
      {
        id: 'edge-2',
        name: 'Broken quote markers',
        category: 'edge-case',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Code review',
        date: new Date('2024-01-17T15:00:00Z'),
        textContent: `The code looks good, but line 42 has an issue:

if (x > 5) {
  console.log("x is greater than 5");
}

Should be >= instead of >

> Please review my code
> if (x > 5) {
  console.log("x is greater than 5");
}`,
        expectedExtraction: `The code looks good, but line 42 has an issue:

if (x > 5) {
  console.log("x is greater than 5");
}

Should be >= instead of >`,
        description: 'Email with code that looks like quotes'
      },
      {
        id: 'edge-3',
        name: 'Malformed HTML',
        category: 'edge-case',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: HTML test',
        date: new Date('2024-01-17T16:00:00Z'),
        textContent: 'Got it, will fix the HTML.',
        htmlContent: `<html>
<body>
<p>Got it, will fix the HTML.
<blockquote>
<p>The HTML on the page is broken</blockquote>
</body>`,
        expectedExtraction: 'Got it, will fix the HTML.',
        description: 'Email with unclosed HTML tags'
      },
      {
        id: 'edge-4',
        name: 'Only whitespace',
        category: 'edge-case',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Blank',
        date: new Date('2024-01-17T17:00:00Z'),
        textContent: `   

  

> Test message`,
        expectedExtraction: '',
        description: 'Email with only whitespace as response'
      }
    ];
  }

  private _generateCorporateEmails(): TestEmail[] {
    return [
      {
        id: 'corp-1',
        name: 'Legal disclaimer',
        category: 'corporate',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Contract terms',
        date: new Date('2024-01-18T09:00:00Z'),
        textContent: `I agree with the proposed terms. Let's move forward with signing.

Best regards,
Sarah Johnson
Legal Department

CONFIDENTIALITY NOTICE: This email message and any attachments are for the sole use of the intended recipient(s) and may contain confidential and privileged information. Any unauthorized review, use, disclosure or distribution is prohibited. If you are not the intended recipient, please contact the sender by reply email and destroy all copies of the original message.

> Please review the updated contract terms`,
        expectedExtraction: `I agree with the proposed terms. Let's move forward with signing.

Best regards,
Sarah Johnson
Legal Department

CONFIDENTIALITY NOTICE: This email message and any attachments are for the sole use of the intended recipient(s) and may contain confidential and privileged information. Any unauthorized review, use, disclosure or distribution is prohibited. If you are not the intended recipient, please contact the sender by reply email and destroy all copies of the original message.`,
        description: 'Corporate email with legal disclaimer'
      },
      {
        id: 'corp-2',
        name: 'Marketing footer',
        category: 'corporate',
        from: this.testAccounts.user1,
        to: [this.testAccounts.user2],
        subject: 'Re: Newsletter design',
        date: new Date('2024-01-18T10:00:00Z'),
        textContent: `Love the new design! Ship it! 🚀

--
Mike Chen
Senior Designer
ACME Corp

🌟 Check out our latest work at acme.com
📱 Download our app: iOS | Android
🏆 Voted Best Design Agency 2023

> What do you think of the newsletter redesign?`,
        expectedExtraction: `Love the new design! Ship it! 🚀

--
Mike Chen
Senior Designer
ACME Corp

🌟 Check out our latest work at acme.com
📱 Download our app: iOS | Android
🏆 Voted Best Design Agency 2023`,
        description: 'Email with marketing footer'
      }
    ];
  }

  /**
   * Convert test email to ParsedMail format for testing
   */
  convertToParsedMail(testEmail: TestEmail): Partial<ParsedMail> {
    return {
      messageId: `<${testEmail.id}@testmail.local>`,
      from: { 
        text: testEmail.from,
        html: testEmail.from,
        value: [{ address: testEmail.from, name: '' }]
      },
      to: { 
        text: testEmail.to.join(', '),
        html: testEmail.to.join(', '),
        value: testEmail.to.map(addr => ({ address: addr, name: '' }))
      },
      subject: testEmail.subject,
      date: testEmail.date,
      text: testEmail.textContent,
      html: testEmail.htmlContent || false,
      textAsHtml: testEmail.htmlContent
    };
  }

  /**
   * Generate a raw email string from test email
   */
  generateRawEmail(testEmail: TestEmail): string {
    const boundary = `boundary_${testEmail.id}`;
    const headers = [
      `From: ${testEmail.from}`,
      `To: ${testEmail.to.join(', ')}`,
      `Subject: ${testEmail.subject}`,
      `Date: ${testEmail.date.toUTCString()}`,
      `Message-ID: <${testEmail.id}@testmail.local>`
    ];

    if (testEmail.htmlContent) {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      
      return `${headers.join('\n')}

--${boundary}
Content-Type: text/plain; charset="UTF-8"

${testEmail.textContent}

--${boundary}
Content-Type: text/html; charset="UTF-8"

${testEmail.htmlContent}

--${boundary}--`;
    } else {
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      return `${headers.join('\n')}

${testEmail.textContent}`;
    }
  }
}

// Export singleton instance
export const testEmailGenerator = new TestEmailGenerator();