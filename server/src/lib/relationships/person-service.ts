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

export interface PersonRelationship {
  id: string;
  user_id: string;
  person_id: string;
  relationship_type: string;
  user_relationship_id: string;
  is_primary: boolean;
  user_set: boolean;
  confidence: number;
  created_at: Date;
  updated_at: Date;
}

export interface PersonWithDetails extends Person {
  emails: PersonEmail[];
  relationships: PersonRelationship[];
}

export interface CreatePersonParams {
  userId: string;
  name: string;
  emailAddress: string;
  relationshipType?: string;
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
  private validateEmail(email: string): void {
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required');
    }
    
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
  private validateName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Name is required');
    }
    
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
  private validateUUID(id: string, fieldName: string): void {
    // Allow standard UUID v4 format or all zeros for testing
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRegex.test(id)) {
      throw new ValidationError(`Invalid ${fieldName} format`);
    }
  }

  /**
   * Log operation for debugging
   */
  private logOperation(operation: string, userId: string, details?: any): void {
    if (!this.suppressLogs) {
      console.log(`PersonService.${operation}:`, {
        userId,
        timestamp: new Date().toISOString(),
        ...details
      });
    }
  }

  async createPerson(params: CreatePersonParams): Promise<PersonWithDetails> {
    // Validate inputs
    if (!params.userId) {
      throw new ValidationError('User ID is required');
    }
    
    this.validateName(params.name);
    this.validateEmail(params.emailAddress);
    
    if (params.confidence !== undefined && (params.confidence < 0 || params.confidence > 1)) {
      throw new ValidationError('Confidence must be between 0 and 1');
    }
    
    const client = await this._beginTransaction();
    
    try {
      this.logOperation('createPerson', params.userId, { name: params.name, email: params.emailAddress });
      
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
      
      // Create the person
      const personResult = await client.query(
        `INSERT INTO people (user_id, name, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id, user_id, name, created_at, updated_at`,
        [params.userId, params.name.trim()]
      );
      
      const person = personResult.rows[0];
      
      // Add the primary email
      await client.query(
        `INSERT INTO person_emails (person_id, email_address, is_primary, created_at)
         VALUES ($1, $2, true, NOW())
         RETURNING id, person_id, email_address, is_primary, created_at`,
        [person.id, normalizedEmail]
      );
      
      // Add relationship if provided
      if (params.relationshipType) {
        // Verify the relationship type exists for this user and get its ID
        const relationshipCheck = await client.query(
          `SELECT id, relationship_type FROM user_relationships 
           WHERE user_id = $1 AND relationship_type = $2 AND is_active = true`,
          [params.userId, params.relationshipType]
        );
        
        if (relationshipCheck.rows.length === 0) {
          throw new InvalidRelationshipError(params.relationshipType);
        }
        
        const userRelationshipId = relationshipCheck.rows[0].id;
        
        await client.query(
          `INSERT INTO person_relationships 
           (user_id, person_id, user_relationship_id, is_primary, user_set, confidence, created_at, updated_at)
           VALUES ($1, $2, $3, true, false, $4, NOW(), NOW())
           RETURNING id, user_id, person_id, user_relationship_id, is_primary, user_set, confidence, created_at, updated_at`,
          [params.userId, person.id, userRelationshipId, params.confidence || 0.5]
        );
      }
      
      await this._commitTransaction(client);
      
      // Return the complete person object with all details
      const result = await this.getPersonById(person.id, params.userId);
      if (!result) {
        throw new PersonServiceError('Failed to retrieve person after creation');
      }
      
      return result;
    } catch (error: unknown) {
      await this._rollbackTransaction(client);
      
      // Re-throw our custom errors as-is
      if (error instanceof PersonServiceError) {
        throw error;
      }
      
      // Wrap database errors
      if (error instanceof Error && 'code' in error) {
        const pgError = error as any;
        if (pgError.code === '23505') { // Unique violation
          throw new DuplicateEmailError(params.emailAddress);
        }
      }
      
      throw new PersonServiceError(`Failed to create person: ${error instanceof Error ? error.message : 'Unknown error'}`, 'CREATE_FAILED');
    }
  }

  async addEmailToPerson(personId: string, emailAddress: string, userId: string): Promise<PersonWithDetails> {
    // Validate inputs
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    this.validateUUID(personId, 'person ID');
    this.validateEmail(emailAddress);
    
    const client = await this._beginTransaction();
    
    try {
      this.logOperation('addEmailToPerson', userId, { personId, email: emailAddress });
      
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
      
      await this._commitTransaction(client);
      
      // Return updated person with all details
      const result = await this.getPersonById(personId, userId);
      if (!result) {
        throw new PersonNotFoundError(`Failed to retrieve person after adding email`);
      }
      
      return result;
    } catch (error: unknown) {
      await this._rollbackTransaction(client);
      
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
    // Validate inputs
    if (!params.userId) {
      throw new ValidationError('User ID is required');
    }

    this.validateName(params.name);
    this.validateEmail(params.emailAddress);

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
          `INSERT INTO people (user_id, name, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (user_id, name) DO NOTHING
           RETURNING id`,
          [params.userId, params.name.trim()]
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

      // Add or update relationship if provided
      if (params.relationshipType) {
        // Check if the relationship type exists for this user and get its ID
        const relCheck = await db.query(
          `SELECT id FROM user_relationships
           WHERE user_id = $1 AND relationship_type = $2 AND is_active = true`,
          [params.userId, params.relationshipType]
        );

        if (relCheck.rows.length > 0) {
          const userRelationshipId = relCheck.rows[0].id;

          // Check existing primary relationship to respect priority
          const existingPrimaryCheck = await db.query(
            `SELECT pr.id, ur.relationship_type, pr.confidence
             FROM person_relationships pr
             INNER JOIN user_relationships ur ON pr.user_relationship_id = ur.id
             WHERE pr.user_id = $1 AND pr.person_id = $2 AND pr.is_primary = true`,
            [params.userId, personId]
          );

          const shouldBecomesPrimary = this._shouldReplacePrimaryRelationship(
            existingPrimaryCheck.rows[0]?.relationship_type,
            params.relationshipType,
            existingPrimaryCheck.rows[0]?.confidence,
            params.confidence || 0.5
          );

          // Only unset existing primary if new relationship should take priority
          if (shouldBecomesPrimary && existingPrimaryCheck.rows.length > 0) {
            await db.query(
              `UPDATE person_relationships
               SET is_primary = false
               WHERE user_id = $1 AND person_id = $2 AND is_primary = true`,
              [params.userId, personId]
            );
          }

          // Insert/update the relationship
          await db.query(
            `INSERT INTO person_relationships
             (user_id, person_id, user_relationship_id, is_primary, user_set, confidence, created_at, updated_at)
             VALUES ($1, $2, $3, $4, false, $5, NOW(), NOW())
             ON CONFLICT (user_id, person_id, user_relationship_id) DO UPDATE
             SET confidence = GREATEST(person_relationships.confidence, $5),
                 is_primary = CASE
                   WHEN $4 = true THEN true
                   ELSE person_relationships.is_primary
                 END,
                 updated_at = NOW()
             WHERE person_relationships.confidence < EXCLUDED.confidence`,
            [params.userId, personId, userRelationshipId, shouldBecomesPrimary, params.confidence || 0.5]
          );
        }
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
    // Validate inputs
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    this.validateEmail(emailAddress);
    
    try {
      // this.logOperation('findPersonByEmail', userId, { email: emailAddress });
      
      const normalizedEmail = this._normalizeEmail(emailAddress);
      
      // Single query to get person with all details
      const result = await this.pool.query(
        `WITH person_data AS (
          SELECT DISTINCT p.id, p.user_id, p.name, p.created_at, p.updated_at
          FROM people p
          INNER JOIN person_emails pe ON pe.person_id = p.id
          WHERE pe.email_address = $1 AND p.user_id = $2
          LIMIT 1
        )
        SELECT 
          pd.id, pd.user_id, pd.name, pd.created_at, pd.updated_at,
          pe.id as email_id, pe.email_address, pe.is_primary as email_is_primary, pe.created_at as email_created_at,
          pr.id as rel_id, pr.user_relationship_id, pr.is_primary as rel_is_primary, 
          pr.user_set, pr.confidence, pr.created_at as rel_created_at, pr.updated_at as rel_updated_at,
          ur.relationship_type
        FROM person_data pd
        LEFT JOIN person_emails pe ON pe.person_id = pd.id
        LEFT JOIN person_relationships pr ON pr.person_id = pd.id AND pr.user_id = pd.user_id
        LEFT JOIN user_relationships ur ON pr.user_relationship_id = ur.id
        ORDER BY pe.is_primary DESC, pe.created_at ASC, pr.is_primary DESC, pr.confidence DESC`,
        [normalizedEmail, userId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // Process results into the expected structure
      const firstRow = result.rows[0];
      const person = {
        id: firstRow.id,
        user_id: firstRow.user_id,
        name: firstRow.name,
        created_at: firstRow.created_at,
        updated_at: firstRow.updated_at
      };
      
      // Collect emails and relationships
      const emailsMap = new Map<string, PersonEmail>();
      const relationshipsMap = new Map<string, PersonRelationship>();
      
      for (const row of result.rows) {
        // Add email if not already added
        if (row.email_id && !emailsMap.has(row.email_id)) {
          emailsMap.set(row.email_id, {
            id: row.email_id,
            person_id: person.id,
            email_address: row.email_address,
            is_primary: row.email_is_primary,
            created_at: row.email_created_at
          });
        }
        
        // Add relationship if not already added
        if (row.rel_id && !relationshipsMap.has(row.rel_id)) {
          relationshipsMap.set(row.rel_id, {
            id: row.rel_id,
            user_id: person.user_id,
            person_id: person.id,
            relationship_type: row.relationship_type,
            user_relationship_id: row.user_relationship_id,
            is_primary: row.rel_is_primary,
            user_set: row.user_set,
            confidence: row.confidence,
            created_at: row.rel_created_at,
            updated_at: row.rel_updated_at
          });
        }
      }
      
      return {
        ...person,
        emails: Array.from(emailsMap.values()),
        relationships: Array.from(relationshipsMap.values())
      };
    } catch (error: unknown) {
      if (error instanceof PersonServiceError) {
        throw error;
      }
      
      throw new PersonServiceError(`Failed to find person by email: ${error instanceof Error ? error.message : 'Unknown error'}`, 'FIND_FAILED');
    }
  }

  async getPersonById(personId: string, userId: string, client?: PoolClient): Promise<PersonWithDetails | null> {
    // Validate inputs
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    this.validateUUID(personId, 'person ID');

    const db = client || this.pool;

    try {
      // Get person details
      const personResult = await db.query(
        `SELECT id, user_id, name, created_at, updated_at
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

      // Get all relationships for this person
      const relationshipsResult = await db.query(
        `SELECT pr.id, pr.user_id, pr.person_id, pr.user_relationship_id,
                pr.is_primary, pr.user_set, pr.confidence, pr.created_at, pr.updated_at,
                ur.relationship_type
         FROM person_relationships pr
         JOIN user_relationships ur ON pr.user_relationship_id = ur.id
         WHERE pr.person_id = $1 AND pr.user_id = $2
         ORDER BY pr.is_primary DESC, pr.confidence DESC`,
        [personId, userId]
      );

      return {
        ...person,
        emails: emailsResult.rows,
        relationships: relationshipsResult.rows
      };
    } catch (error: unknown) {
      if (error instanceof PersonServiceError) {
        throw error;
      }

      throw new PersonServiceError(`Failed to get person details: ${error instanceof Error ? error.message : 'Unknown error'}`, 'GET_FAILED');
    }
  }

  async listPeopleForUser(params: ListPeopleParams): Promise<PersonWithDetails[]> {
    // Validate inputs
    if (!params.userId) {
      throw new ValidationError('User ID is required');
    }
    
    const limit = Math.min(Math.max(params.limit || 50, 1), 100); // Between 1 and 100
    const offset = Math.max(params.offset || 0, 0); // Non-negative
    
    try {
      this.logOperation('listPeopleForUser', params.userId, { limit, offset });
      
      // Get people with their primary email and relationship
      const result = await this.pool.query(
        `SELECT 
          p.id, p.user_id, p.name, p.created_at, p.updated_at,
          pe.email_address as primary_email,
          ur.relationship_type as primary_relationship,
          pr.confidence as relationship_confidence,
          pr.user_set as relationship_user_set,
          COUNT(DISTINCT pe_all.id) as email_count,
          COUNT(DISTINCT pr_all.id) as relationship_count
         FROM people p
         LEFT JOIN person_emails pe ON pe.person_id = p.id AND pe.is_primary = true
         LEFT JOIN person_relationships pr ON pr.person_id = p.id AND pr.is_primary = true AND pr.user_id = p.user_id
         LEFT JOIN user_relationships ur ON pr.user_relationship_id = ur.id
         LEFT JOIN person_emails pe_all ON pe_all.person_id = p.id
         LEFT JOIN person_relationships pr_all ON pr_all.person_id = p.id AND pr_all.user_id = p.user_id
         WHERE p.user_id = $1
         GROUP BY p.id, p.user_id, p.name, p.created_at, p.updated_at, 
                  pe.email_address, ur.relationship_type, pr.confidence, pr.user_set
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
    // Validate inputs
    if (!params.userId) {
      throw new ValidationError('User ID is required');
    }
    
    this.validateUUID(params.sourcePersonId, 'source person ID');
    this.validateUUID(params.targetPersonId, 'target person ID');
    
    if (params.sourcePersonId === params.targetPersonId) {
      throw new ValidationError('Cannot merge a person with themselves');
    }
    
    const client = await this._beginTransaction();
    
    try {
      this.logOperation('mergePeople', params.userId, {
        sourcePersonId: params.sourcePersonId,
        targetPersonId: params.targetPersonId
      });
      
      // Verify both people belong to the user
      const peopleCheck = await client.query(
        `SELECT id, name FROM people 
         WHERE user_id = $1 AND id IN ($2, $3)`,
        [params.userId, params.sourcePersonId, params.targetPersonId]
      );
      
      if (peopleCheck.rows.length !== 2) {
        throw new PersonNotFoundError('One or both people not found or unauthorized');
      }
      
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
      
      // Merge relationships - for each relationship type, keep the one with highest confidence or user_set
      const relationshipsResult = await client.query(
        `SELECT DISTINCT user_relationship_id
         FROM person_relationships
         WHERE person_id IN ($1, $2) AND user_id = $3`,
        [params.sourcePersonId, params.targetPersonId, params.userId]
      );
      
      // First, remove primary flags from target person's relationships to avoid constraint violation
      await client.query(
        `UPDATE person_relationships
         SET is_primary = false
         WHERE person_id = $1 AND user_id = $2`,
        [params.targetPersonId, params.userId]
      );
      
      for (const row of relationshipsResult.rows) {
        const userRelationshipId = row.user_relationship_id;
        
        // Get the best relationship for this type (prefer user_set, then highest confidence)
        const bestRelationship = await client.query(
          `SELECT person_id, is_primary, user_set, confidence
           FROM person_relationships
           WHERE person_id IN ($1, $2) AND user_id = $3 AND user_relationship_id = $4
           ORDER BY user_set DESC, confidence DESC
           LIMIT 1`,
          [params.sourcePersonId, params.targetPersonId, params.userId, userRelationshipId]
        );
        
        if (bestRelationship.rows.length > 0) {
          const best = bestRelationship.rows[0];
          
          // Delete any existing relationship of this type for the target
          await client.query(
            `DELETE FROM person_relationships
             WHERE person_id = $1 AND user_id = $2 AND user_relationship_id = $3`,
            [params.targetPersonId, params.userId, userRelationshipId]
          );
          
          // Insert the best relationship for the target (without is_primary flag initially)
          await client.query(
            `INSERT INTO person_relationships 
             (user_id, person_id, user_relationship_id, is_primary, user_set, confidence, created_at, updated_at)
             VALUES ($1, $2, $3, false, $4, $5, NOW(), NOW())`,
            [params.userId, params.targetPersonId, userRelationshipId, best.user_set, best.confidence]
          );
        }
      }
      
      // Ensure at least one relationship is marked as primary
      await client.query(
        `UPDATE person_relationships
         SET is_primary = true
         WHERE person_id = $1 AND user_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM person_relationships 
           WHERE person_id = $1 AND user_id = $2 AND is_primary = true
         )
         AND id = (
           SELECT id FROM person_relationships
           WHERE person_id = $1 AND user_id = $2
           ORDER BY user_set DESC, confidence DESC
           LIMIT 1
         )`,
        [params.targetPersonId, params.userId]
      );
      
      // Delete the source person (cascades to emails and relationships)
      await client.query(
        `DELETE FROM people WHERE id = $1 AND user_id = $2`,
        [params.sourcePersonId, params.userId]
      );
      
      // Update the target person's updated_at timestamp
      await client.query(
        `UPDATE people SET updated_at = NOW() WHERE id = $1`,
        [params.targetPersonId]
      );
      
      await this._commitTransaction(client);
      
      // Return the merged person
      const mergedPerson = await this.getPersonById(params.targetPersonId, params.userId);
      if (!mergedPerson) {
        throw new PersonNotFoundError('Failed to retrieve merged person');
      }
      
      return mergedPerson;
    } catch (error: unknown) {
      await this._rollbackTransaction(client);
      
      if (error instanceof PersonServiceError) {
        throw error;
      }
      
      // Handle specific database errors
      if (error instanceof Error && 'code' in error) {
        const pgError = error as any;
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
   * Determine if a new relationship should replace the existing primary relationship
   * Based on relationship type priority and confidence
   *
   * Priority order: spouse > family > colleague > friends > external > spam
   *
   * @param existingType - Current primary relationship type (undefined if no primary exists)
   * @param newType - New relationship type being added
   * @param existingConfidence - Confidence of existing primary relationship
   * @param newConfidence - Confidence of new relationship
   * @returns true if new relationship should become primary
   */
  private _shouldReplacePrimaryRelationship(
    existingType: string | undefined,
    newType: string,
    existingConfidence: number = 0,
    newConfidence: number = 0
  ): boolean {
    // If no existing primary, new relationship becomes primary
    if (!existingType) {
      return true;
    }

    const existingPriority = RelationshipType.PRIORITY[existingType] || 999;
    const newPriority = RelationshipType.PRIORITY[newType] || 999;

    // Higher priority relationship (lower number) always wins
    if (newPriority < existingPriority) {
      return true;
    }

    // Lower priority relationship (higher number) never wins
    if (newPriority > existingPriority) {
      return false;
    }

    // Same priority - use confidence as tiebreaker
    // Only replace if new confidence is significantly higher (>= 0.1 difference)
    return newConfidence >= existingConfidence + 0.1;
  }

  /**
   * Helper method to begin a database transaction
   */
  private async _beginTransaction() {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return client;
  }

  /**
   * Helper method to commit a transaction
   */
  private async _commitTransaction(client: any) {
    await client.query('COMMIT');
    client.release();
  }

  /**
   * Helper method to rollback a transaction
   */
  private async _rollbackTransaction(client: any) {
    await client.query('ROLLBACK');
    client.release();
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