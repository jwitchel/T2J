/**
 * EmailMover Service
 * Handles moving emails and uploading drafts to IMAP folders
 * Extracted from imap-draft route to enable direct service-to-service calls
 */

import { pool } from '../db';
import { ImapOperations } from '../imap-operations';
import { withImapContext } from '../imap-context';
import { v4 as uuidv4 } from 'uuid';
import * as nodemailer from 'nodemailer';
import { EmailActionRouter } from '../email-action-router';
import { LLMMetadata } from '../llm-client';
import { EmailActionTracker } from '../email-action-tracker';
import { ActionHelpers } from '../email-actions';

// Helper function to create RFC2822 formatted email using nodemailer
async function createEmailMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  bodyHtml?: string,
  cc?: string,
  inReplyTo?: string,
  references?: string
): Promise<string> {
  // Create a transport that doesn't actually send but builds the message
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true
  });

  const messageId = `<${uuidv4()}@ai-email-assistant>`;

  const mailOptions: nodemailer.SendMailOptions = {
    from,
    to,
    subject,
    messageId,
    date: new Date(),
    text: body,
    // Use base64 encoding for better compatibility with email clients
    // Base64 is more universally supported than quoted-printable for Unicode
    textEncoding: 'base64' as const
  };

  // Add CC if provided
  if (cc) {
    mailOptions.cc = cc;
  }

  // Add HTML if provided
  if (bodyHtml) {
    mailOptions.html = bodyHtml;
  }

  // Add reply headers if provided
  if (inReplyTo) {
    mailOptions.inReplyTo = inReplyTo;
  }

  if (references) {
    mailOptions.references = references;
  }

  // Build the message
  // Note: nodemailer automatically adds proper MIME headers including
  // Content-Type: text/plain; charset=UTF-8
  // Content-Transfer-Encoding: quoted-printable
  const info = await transporter.sendMail(mailOptions);
  const message = info.message.toString();

  return message;
}

export interface UploadDraftParams {
  emailAccountId: string;
  userId: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  recommendedAction?: LLMMetadata['recommendedAction'];
}

export interface UploadDraftResult {
  success: boolean;
  message?: string;
  folder?: string;
  action?: string;
  error?: string;
}

export interface MoveEmailParams {
  emailAccountId: string;
  userId: string;
  messageUid: number;
  messageId?: string;
  sourceFolder: string;
  recommendedAction: LLMMetadata['recommendedAction'];
}

export interface MoveEmailResult {
  success: boolean;
  message?: string;
  folder?: string;
  action?: string;
  removedFromInbox?: boolean;
  error?: string;
}

export class EmailMover {
  /**
   * Upload a draft email to the user's drafts folder
   */
  async uploadDraft(params: UploadDraftParams): Promise<UploadDraftResult> {
    const {
      emailAccountId,
      userId,
      to,
      cc,
      subject,
      body,
      bodyHtml,
      inReplyTo,
      references,
      recommendedAction
    } = params;

    try {
      // Get email account details (trust caller validated inputs)
      const accountResult = await pool.query(
        'SELECT email_address FROM email_accounts WHERE id = $1 AND user_id = $2',
        [emailAccountId, userId]
      );

      if (accountResult.rows.length === 0) {
        return {
          success: false,
          error: 'Email account not found'
        };
      }

      const fromEmail = accountResult.rows[0].email_address;

      // Get user's folder preferences
      const userResult = await pool.query(
        'SELECT preferences FROM "user" WHERE id = $1',
        [userId]
      );
      const preferences = userResult.rows[0]?.preferences || {};
      const folderPrefs = preferences.folderPreferences;

      // Determine saved Drafts folder path from user preferences
      const draftsFolderPath = (folderPrefs as any).draftsFolderPath as string;

      await withImapContext(emailAccountId, userId, async () => {
        // Create IMAP operations instance (connection managed by context)
        const imapOps = await ImapOperations.fromAccountId(emailAccountId, userId);

        // Create email message
        const emailMessage = await createEmailMessage(
          fromEmail,
          to,
          subject,
          body,
          bodyHtml,
          cc,
          inReplyTo,
          references
        );

        // Upload to saved Drafts folder with Draft flag
        await imapOps.appendMessage(draftsFolderPath, emailMessage, ['\\Draft'], true);
      });

      // NOTE: Action tracking is now handled by caller (inbox-processor) BEFORE upload
      // This ensures atomicity and prevents duplicates on crash

      return {
        success: true,
        message: `Draft uploaded to ${draftsFolderPath}`,
        folder: draftsFolderPath,
        action: recommendedAction
      };

    } catch (error: unknown) {
      console.error('Error uploading draft:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload draft'
      };
    }
  }

  /**
   * Move an email to a folder based on the recommended action
   */
  async moveEmail(params: MoveEmailParams): Promise<MoveEmailResult> {
    const {
      emailAccountId,
      userId,
      messageUid,
      messageId,
      sourceFolder,
      recommendedAction
    } = params;

    try {
      // Get user's folder preferences (trust caller validated inputs)
      const userResult = await pool.query(
        'SELECT preferences FROM "user" WHERE id = $1',
        [userId]
      );
      const preferences = userResult.rows[0]?.preferences || {};
      const folderPrefs = preferences.folderPreferences;
      const draftsFolderPath = folderPrefs?.draftsFolderPath;

      // Resolve destination folder and flags
      const actionRouter = new EmailActionRouter(folderPrefs, draftsFolderPath);
      const routeResult = actionRouter.getActionRoute(recommendedAction as any);

      await withImapContext(emailAccountId, userId, async () => {
        const imapOps = await ImapOperations.fromAccountId(emailAccountId, userId);
        await imapOps.moveMessage(sourceFolder, routeResult.folder, messageUid, routeResult.flags, true);
      });

      // Record the action taken (map recommended action to action type)
      if (messageId) {
        let actionType: 'manually_handled' | 'draft_created' = 'manually_handled';
        if (ActionHelpers.isSilentAction(recommendedAction)) {
          actionType = 'manually_handled'; // Silent actions mean the email was handled without a draft
        }
        await EmailActionTracker.recordAction(userId, emailAccountId, messageId, actionType);
      }

      return {
        success: true,
        message: `Email moved to ${routeResult.displayName}`,
        folder: routeResult.folder,
        action: recommendedAction,
        removedFromInbox: !!(messageUid && sourceFolder)
      };

    } catch (error: unknown) {
      console.error('Error moving email:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to move email'
      };
    }
  }
}

// Export singleton instance
export const emailMover = new EmailMover();