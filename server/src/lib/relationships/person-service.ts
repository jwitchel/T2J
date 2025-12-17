import { Pool, PoolClient } from 'pg';
import { pool as serverPool } from '../db';
import { withTransaction } from '../db/transaction-utils';
import { RelationshipType } from './types';

// Custom error classes
export class PersonServiceError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'PersonServiceError';
  }
}

export class PersonNotFoundError extends PersonServiceError {
  constructor(message: string = 'Person not found') {
    super(message, 'PERSON_NOT_FOUND');
    this.name = 'PersonNotFoundError';
  }
}

export class DuplicateEmailError extends PersonServiceError {
  constructor(email: string) {
    super(`Email address ${email} already exists`, 'DUPLICATE_EMAIL');
    this.name = 'DuplicateEmailError';
  }
}

export class UnauthorizedError extends PersonServiceError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class InvalidRelationshipError extends PersonServiceError {
  constructor(relationshipType: string) {
    super(`Invalid relationship type: ${relationshipType}`, 'INVALID_RELATIONSHIP');
    this.name = 'InvalidRelationshipError';
  }
}

export class ValidationError extends PersonServiceError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

// TypeScript interfaces for the PersonService

export interface Person {
  id: string;
  user_id: string;
  name: string;
  relationship_type: RelationshipType | null;
  relationship_user_set: boolean;
  relationship_confidence: number;
  created_at: Date;
  updated_at: Date;
}

export interface PersonEmail {
  id: string;
  person_id: string;
  email_address: string;
  is_primary: boolean;
  created_at: Date;
}

export interface PersonWithDetails extends Person {
  emails: PersonEmail[];
}

export interface CreatePersonParams {
  userId: string;
  name: string;
  emailAddress: string;
  relationshipType?: RelationshipType;
  confidence?: number;
}

export interface ListPeopleParams {
  userId: string;
  limit?: number;
  offset?: number;
}

export interface MergePeopleParams {
  userId: string;
  sourcePersonId: string;
  targetPersonId: string;
}

export class PersonService {
  private pool: Pool;
  private readonly MAX_NAME_LENGTH = 255;
  private readonly MAX_EMAIL_LENGTH = 255;
  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private suppressLogs = false;

  constructor(customPool?: Pool) {
    this.pool = customPool || serverPool;
    // Suppress logs during tests
    if (process.env.NODE_ENV === 'test') {
      this.suppressLogs = true;
    }
  }

  async initialize(): Promise<void> {
    // Test database connection
    try {
      await this.pool.query('SELECT 1');
      if (!this.suppressLogs) {
        console.log('PersonService: Database connection verified');
      }
    } catch (error: unknown) {
      console.error('PersonService: Failed to connect to database', error);
      throw new PersonServiceError('Failed to connect to database', 'DB_CONNECTION_ERROR');
    }
  }

  /**
   * Validate email format
   */
  private _validateEmail(email: string): void {
    // Trust caller - email is typed as string
    const normalizedEmail = this._normalizeEmail(email);
    
    if (normalizedEmail.length > this.MAX_EMAIL_LENGTH) {
      throw new ValidationError(`Email must be ${this.MAX_EMAIL_LENGTH} characters or less`);
    }
    
    if (!this.EMAIL_REGEX.test(normalizedEmail)) {
      throw new ValidationError('Invalid email format');
    }
  }

  /**
   * Validate person name
   */
  private _validateName(name: string): void {
    // Trust caller - name is typed as string
    const trimmedName = name.trim();
    
    if (trimmedName.length === 0) {
      throw new ValidationError('Name cannot be empty');
    }
    
    if (trimmedName.length > this.MAX_NAME_LENGTH) {
      throw new ValidationError(`Name must be ${this.MAX_NAME_LENGTH} characters or less`);
    }
  }

  /**
   * Validate UUID format
   */
  private _validateUUID(id: string, fieldName: string): void {
    // Trust caller - id is typed as string; only validate format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new ValidationError(`Invalid ${fieldName} format`);
    }
  }

  /**
   * Log operation for debugging
   */
  private _logOperation(operation: string, userId: string, details?: any): void {
    if (!this.suppressLogs) {
      console.log(`PersonService.${operation}:`, {
        userId,
        timestamp: new Date().toISOString(),
        ...details
      });
    }
  }

  async createPerson(params: CreatePersonParams): Promise<PersonWithDetails> {
    // Trust caller - params.userId is typed as string
    this._validateName(params.name);
    this._validateEmail(params.emailAddress);

    if (params.confidence !== undefined && (params.confidence < 0 || params.confidence > 1)) {
      throw new ValidationError('Confidence must be between 0 and 1');
    }

    try {
      const personId = await withTransaction(this.pool, async (client) => {
        this._logOperation('createPerson', params.userId, { name: params.name, email: params.emailAddress });

        // Check if email already exists for this user
        const normalizedEmail = this._normalizeEmail(params.emailAddress);
        const emailCheck = await client.query(
          `SELECT p.id, p.name
           FROM people p
           INNER JOIN person_emails pe ON pe.person_id = p.id
           WHERE pe.email_address = $1 AND p.user_id = $2`,
          [normalizedEmail, params.userId]
        );

        if (emailCheck.rows.length > 0) {
          throw new DuplicateEmailError(normalizedEmail);
        }

        // Create the person with relationship directly on the row
        const personResult = await client.query(
          `INSERT INTO people (user_id, name, relationship_type, relationship_user_set, relationship_confidence, created_at, updated_at)
           VALUES ($1, $2, $3, false, $4, NOW(), NOW())
           RETURNING id`,
          [params.userId, params.name.trim(), params.relationshipType || null, params.confidence || 1.0]
        );

        const newPersonId = personResult.rows[0].id;

        // Add the primary email
        await client.query(
          `INSERT INTO person_emails (person_id, email_address, is_primary, created_at)
           VALUES ($1, $2, true, NOW())`,
          [newPersonId, normalizedEmail]
        );

        return newPersonId;
      });

      // Return the complete person object with all details (outside transaction)
      const result = await this.getPersonById(personId, params.userId);
      if (!result) {
        throw new PersonServiceError('Failed to retrieve person after creation');
      }

      return result;
    } catch (error: unknown) {
      // Re-throw our custom errors as-is
      if (error instanceof PersonServiceError) {
        throw error;
      }

      // Wrap database errors
      if (error instanceof Error && 'code' in error) {
        const pgError = error as { code: string };
        if (pgError.code === '23505') { // Unique violation
          throw new DuplicateEmailError(params.emailAddress);
        }
      }

      throw new PersonServiceError(`Failed to create person: ${error instanceof Error ? error.message : 'Unknown error'}`, 'CREATE_FAILED');
    }
  }

  async addEmailToPerson(personId: string, emailAddress: string, userId: string): Promise<PersonWithDetails> {
    // Trust caller - userId is typed as string
    this._validateUUID(personId, 'person ID');
    this._validateEmail(emailAddress);

    try {
      await withTransaction(this.pool, async (client) => {
        this._logOperation('addEmailToPerson', userId, { personId, email: emailAddress });

        // Verify person belongs to user
        const personCheck = await client.query(
          `SELECT id, name FROM people WHERE id = $1 AND user_id = $2`,
          [personId, userId]
        );

        if (personCheck.rows.length === 0) {
          throw new PersonNotFoundError(`Person ${personId} not found or unauthorized`);
        }

        // Check if email already exists for this person
        const normalizedEmail = this._normalizeEmail(emailAddress);
        const emailCheck = await client.query(
          `SELECT id FROM person_emails WHERE person_id = $1 AND email_address = $2`,
          [personId, normalizedEmail]
        );

        if (emailCheck.rows.length > 0) {
          throw new DuplicateEmailError(normalizedEmail);
        }

        // Check if email exists for another person under this user
        const emailExistsCheck = await client.query(
          `SELECT p.id, p.name
           FROM people p
           INNER JOIN person_emails pe ON pe.person_id = p.id
           WHERE pe.email_address = $1 AND p.user_id = $2 AND p.id != $3`,
          [normalizedEmail, userId, personId]
        );

        if (emailExistsCheck.rows.length > 0) {
          const existingPerson = emailExistsCheck.rows[0];
          throw new DuplicateEmailError(
            `${normalizedEmail} (already assigned to ${existingPerson.name})`
          );
        }

        // Add the new email
        await client.query(
          `INSERT INTO person_emails (person_id, email_address, is_primary, created_at)
           VALUES ($1, $2, false, NOW())`,
          [personId, normalizedEmail]
        );
      });

      // Return updated person with all details (outside transaction)
      const result = await this.getPersonById(personId, userId);
      if (!result) {
        throw new PersonNotFoundError(`Failed to retrieve person after adding email`);
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof PersonServiceError) {
        throw error;
      }

      throw new PersonServiceError(`Failed to add email: ${error instanceof Error ? error.message : 'Unknown error'}`, 'ADD_EMAIL_FAILED');
    }
  }

  /**
   * Find or create a person record
   * @param params - Person creation parameters
   * @param client - Optional transaction client. If provided, operation is part of transaction.
   */
  async findOrCreatePerson(params: CreatePersonParams, client?: PoolClient): Promise<PersonWithDetails> {
    // Trust caller - params.userId is typed as string
    this._validateName(params.name);
    this._validateEmail(params.emailAddress);

    const normalizedEmail = this._normalizeEmail(params.emailAddress);

    return await withTransaction(this.pool, async (db) => {
      // First check if person exists with this email
      const existingCheck = await db.query(
        `SELECT p.id FROM people p
         INNER JOIN person_emails pe ON pe.person_id = p.id
         WHERE p.user_id = $1 AND pe.email_address = $2`,
        [params.userId, normalizedEmail]
      );

      let personId: string;
      let emailAlreadyExists = false;

      if (existingCheck.rows.length > 0) {
        // Person already exists with this email
        personId = existingCheck.rows[0].id;
        emailAlreadyExists = true;
      } else {
        // Person doesn't exist with this email, create or find by name
        const personResult = await db.query(
          `INSERT INTO people (user_id, name, relationship_type, relationship_user_set, relationship_confidence, created_at, updated_at)
           VALUES ($1, $2, $3, false, $4, NOW(), NOW())
           ON CONFLICT (user_id, name) DO NOTHING
           RETURNING id`,
          [params.userId, params.name.trim(), params.relationshipType || null, params.confidence || 1.0]
        );

        if (personResult.rows.length > 0) {
          // We created a new person
          personId = personResult.rows[0].id;
        } else {
          // Person with this name already exists, find them
          const existing = await db.query(
            `SELECT id FROM people WHERE user_id = $1 AND name = $2`,
            [params.userId, params.name.trim()]
          );

          if (existing.rows.length === 0) {
            throw new PersonServiceError('Failed to create or find person');
          }

          personId = existing.rows[0].id;
        }
      }

      // Add the email (skip if person was found by this email)
      if (!emailAlreadyExists) {
        await db.query(
          `INSERT INTO person_emails (person_id, email_address, is_primary, created_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (person_id, email_address) DO NOTHING`,
          [personId, normalizedEmail]
        );
      }

      // Update relationship if provided (only if not user_set)
      if (params.relationshipType) {
        await db.query(
          `UPDATE people
           SET relationship_type = $1,
               relationship_confidence = GREATEST(relationship_confidence, $2),
               updated_at = NOW()
           WHERE id = $3 AND relationship_user_set = false`,
          [params.relationshipType, params.confidence || 1.0, personId]
        );
      }

      // Query person details WITHIN the transaction before committing
      const personDetails = await this.getPersonById(personId, params.userId, db);
      if (!personDetails) {
        throw new PersonNotFoundError(`Person ${personId} not found`);
      }
      return personDetails;
    }, client);
  }

async findPersonByEmail(emailAddress: string, userId: string): Promise<PersonWithDetails | null> {
    // Trust caller - userId is typed as string
    this._validateEmail(emailAddress);

    try {
      const normalizedEmail = this._normalizeEmail(emailAddress);

      // Get person with relationship directly from people table
      const personResult = await this.pool.query(
        `SELECT p.*
         FROM people p
         INNER JOIN person_emails pe ON pe.person_id = p.id
         WHERE pe.email_address = $1 AND p.user_id = $2
         LIMIT 1`,
        [normalizedEmail, userId]
      );

      if (personResult.rows.length === 0) {
        return null;
      }

      const person = personResult.rows[0];

      // Get all emails for this person
      const emailsResult = await this.pool.query(
        `SELECT id, person_id, email_address, is_primary, created_at
         FROM person_emails
         WHERE person_id = $1
         ORDER BY is_primary DESC, created_at ASC`,
        [person.id]
      );

      return {
        ...person,
        emails: emailsResult.rows
      };
    } catch (error: unknown) {
      if (error instanceof PersonServiceError) {
        throw error;
      }

      throw new PersonServiceError(`Failed to find person by email: ${error instanceof Error ? error.message : 'Unknown error'}`, 'FIND_FAILED');
    }
  }

  async getPersonById(personId: string, userId: string, client?: PoolClient): Promise<PersonWithDetails | null> {
    // Trust caller - userId is typed as string
    this._validateUUID(personId, 'person ID');

    const db = client || this.pool;

    try {
      // Get person details (relationship is now directly on the person)
      const personResult = await db.query(
        `SELECT *
         FROM people
         WHERE id = $1 AND user_id = $2`,
        [personId, userId]
      );

      if (personResult.rows.length === 0) {
        return null;
      }

      const person = personResult.rows[0];

      // Get all emails for this person
      const emailsResult = await db.query(
        `SELECT id, person_id, email_address, is_primary, created_at
         FROM person_emails
         WHERE person_id = $1
         ORDER BY is_primary DESC, created_at ASC`,
        [personId]
      );

      return {
        ...person,
        emails: emailsResult.rows
      };
    } catch (error: unknown) {
      if (error instanceof PersonServiceError) {
        throw error;
      }

      throw new PersonServiceError(`Failed to get person details: ${error instanceof Error ? error.message : 'Unknown error'}`, 'GET_FAILED');
    }
  }

  async listPeopleForUser(params: ListPeopleParams): Promise<PersonWithDetails[]> {
    // Trust caller - params.userId is typed as string
    const limit = Math.min(Math.max(params.limit || 50, 1), 100); // Between 1 and 100
    const offset = Math.max(params.offset || 0, 0); // Non-negative

    try {
      this._logOperation('listPeopleForUser', params.userId, { limit, offset });

      // Get people with their primary email (relationship is now on people table)
      const result = await this.pool.query(
        `SELECT
          p.*,
          pe.email_address as primary_email,
          COUNT(DISTINCT pe_all.id) as email_count
         FROM people p
         LEFT JOIN person_emails pe ON pe.person_id = p.id AND pe.is_primary = true
         LEFT JOIN person_emails pe_all ON pe_all.person_id = p.id
         WHERE p.user_id = $1
         GROUP BY p.id, pe.email_address
         ORDER BY p.name ASC
         LIMIT $2 OFFSET $3`,
        [params.userId, limit, offset]
      );

      // For each person, get their full details
      const people: PersonWithDetails[] = [];
      for (const row of result.rows) {
        const person = await this.getPersonById(row.id, params.userId);
        if (person) {
          people.push(person);
        }
      }

      return people;
    } catch (error: unknown) {
      if (error instanceof PersonServiceError) {
        throw error;
      }

      throw new PersonServiceError(`Failed to list people: ${error instanceof Error ? error.message : 'Unknown error'}`, 'LIST_FAILED');
    }
  }

  async mergePeople(params: MergePeopleParams): Promise<PersonWithDetails> {
    // Trust caller - params.userId is typed as string
    this._validateUUID(params.sourcePersonId, 'source person ID');
    this._validateUUID(params.targetPersonId, 'target person ID');

    if (params.sourcePersonId === params.targetPersonId) {
      throw new ValidationError('Cannot merge a person with themselves');
    }

    try {
      await withTransaction(this.pool, async (client) => {
        this._logOperation('mergePeople', params.userId, {
          sourcePersonId: params.sourcePersonId,
          targetPersonId: params.targetPersonId
        });

        // Verify both people belong to the user and get their relationship info
        const peopleCheck = await client.query(
          `SELECT id, name, relationship_type, relationship_user_set, relationship_confidence
           FROM people
           WHERE user_id = $1 AND id IN ($2, $3)`,
          [params.userId, params.sourcePersonId, params.targetPersonId]
        );

        if (peopleCheck.rows.length !== 2) {
          throw new PersonNotFoundError('One or both people not found or unauthorized');
        }

        const source = peopleCheck.rows.find(r => r.id === params.sourcePersonId)!;
        const target = peopleCheck.rows.find(r => r.id === params.targetPersonId)!;

        // Move all emails from source to target (skip duplicates)
        await client.query(
          `INSERT INTO person_emails (person_id, email_address, is_primary, created_at)
           SELECT $1, email_address, false, created_at
           FROM person_emails
           WHERE person_id = $2
           AND email_address NOT IN (
             SELECT email_address FROM person_emails WHERE person_id = $1
           )`,
          [params.targetPersonId, params.sourcePersonId]
        );

        // Merge relationship: prefer user_set, then highest confidence
        const sourceIsBetter = (source.relationship_user_set && !target.relationship_user_set) ||
          (source.relationship_user_set === target.relationship_user_set &&
           source.relationship_confidence > target.relationship_confidence);

        if (sourceIsBetter && source.relationship_type) {
          await client.query(
            `UPDATE people
             SET relationship_type = $1,
                 relationship_user_set = $2,
                 relationship_confidence = $3,
                 updated_at = NOW()
             WHERE id = $4`,
            [source.relationship_type, source.relationship_user_set, source.relationship_confidence, params.targetPersonId]
          );
        } else {
          // Just update timestamp
          await client.query(
            `UPDATE people SET updated_at = NOW() WHERE id = $1`,
            [params.targetPersonId]
          );
        }

        // Delete the source person (cascades to emails)
        await client.query(
          `DELETE FROM people WHERE id = $1 AND user_id = $2`,
          [params.sourcePersonId, params.userId]
        );
      });

      // Return the merged person (outside transaction)
      const mergedPerson = await this.getPersonById(params.targetPersonId, params.userId);
      if (!mergedPerson) {
        throw new PersonNotFoundError('Failed to retrieve merged person');
      }

      return mergedPerson;
    } catch (error: unknown) {
      if (error instanceof PersonServiceError) {
        throw error;
      }

      // Handle specific database errors
      if (error instanceof Error && 'code' in error) {
        const pgError = error as { code: string };
        if (pgError.code === '23505') { // Unique violation
          throw new PersonServiceError('Merge conflict: duplicate data detected', 'MERGE_CONFLICT');
        }
      }

      throw new PersonServiceError(`Failed to merge people: ${error instanceof Error ? error.message : 'Unknown error'}`, 'MERGE_FAILED');
    }
  }

  /**
   * Helper method to normalize email addresses
   */
  private _normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  /**
   * Assign a relationship type to a person (user-set)
   */
  async assignRelationshipToPerson(
    personId: string,
    userId: string,
    relationshipType: RelationshipType,
    _isPrimary: boolean, // Ignored - only one relationship per person now
    confidence: number = 1.0
  ): Promise<PersonWithDetails> {
    this._validateUUID(personId, 'person ID');

    return await withTransaction(this.pool, async (client) => {
      // Verify person belongs to user and update relationship
      const result = await client.query(
        `UPDATE people
         SET relationship_type = $1,
             relationship_user_set = true,
             relationship_confidence = $2,
             updated_at = NOW()
         WHERE id = $3 AND user_id = $4
         RETURNING id`,
        [relationshipType, confidence, personId, userId]
      );

      if (result.rows.length === 0) {
        throw new PersonNotFoundError(`Person ${personId} not found or unauthorized`);
      }

      return (await this.getPersonById(personId, userId, client))!;
    });
  }

  /**
   * Set relationship by email address (used by UI dropdown)
   */
  async setRelationshipByEmail(
    emailAddress: string,
    relationshipType: RelationshipType,
    userId: string
  ): Promise<Person> {
    this._validateEmail(emailAddress);
    const normalizedEmail = this._normalizeEmail(emailAddress);

    return await withTransaction(this.pool, async (client) => {
      // Find person by email and update relationship in single query
      const result = await client.query(
        `UPDATE people p
         SET relationship_type = $3,
             relationship_user_set = true,
             relationship_confidence = 1.0,
             updated_at = NOW()
         FROM person_emails pe
         WHERE pe.person_id = p.id
           AND pe.email_address = $1
           AND p.user_id = $2
         RETURNING p.*`,
        [normalizedEmail, userId, relationshipType]
      );

      if (result.rows.length === 0) {
        throw new PersonNotFoundError(`No person found with email ${emailAddress}`);
      }

      return result.rows[0];
    });
  }

  // Public method to get pool for direct queries
  getPool(): Pool {
    return this.pool;
  }
}

// Lazy singleton instance to avoid circular dependency issues
let _personService: PersonService | null = null;

export function getPersonService(): PersonService {
  if (!_personService) {
    _personService = new PersonService();
  }
  return _personService;
}

// Export singleton for backwards compatibility
export const personService = new Proxy({} as PersonService, {
  get(_, prop) {
    return (getPersonService() as any)[prop];
  }
});