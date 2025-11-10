// Email action tracking types

export type EmailActionType =
  | 'none'
  | 'replied'
  | 'forwarded'
  | 'draft_created'
  | 'manually_handled';

export interface EmailActionTracking {
  id: string;
  userId: string;
  emailAccountId: string;
  messageId: string;
  actionTaken: EmailActionType;
  createdAt: Date;
  updatedAt: Date;  // This serves as the "action taken at" timestamp
}

// Extended email message with action tracking
export interface EmailMessageWithAction {
  uid: number;
  messageId?: string;
  from?: string;
  to?: string[];
  subject?: string;
  date?: Date;
  flags: string[];
  size?: number;
  preview?: string;
  fullMessage?: string;
  // Action tracking fields
  actionTaken?: EmailActionType;
  updatedAt?: Date;  // When the action was taken
}

