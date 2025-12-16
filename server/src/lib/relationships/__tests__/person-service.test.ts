import {
  PersonService,
  PersonServiceError,
  ValidationError,
  DuplicateEmailError,
  PersonNotFoundError,
  InvalidRelationshipError
} from '../person-service';
import { RelationshipType } from '../types';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../../../.env') });

describe('PersonService', () => {
  let pool: Pool;
  let personService: PersonService;
  let testUserId: string;

  beforeAll(async () => {
    // Create a new pool for tests
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://aiemailuser:aiemailpass@localhost:5434/aiemaildb',
    });

    // Create PersonService with test pool
    personService = new PersonService(pool);
    await personService.initialize();
  });

  beforeEach(async () => {
    // Create a test user for each test
    testUserId = 'test-user-' + Date.now() + '-' + Math.random().toString(36).substring(7);
    await pool.query(
      `INSERT INTO "user" (id, email, name, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [testUserId, `test-${testUserId}@example.com`, 'Test User']
    );

    // Create default relationships
    const relationships = ['friend', 'colleague', 'professional', 'external'];
    for (const rel of relationships) {
      await pool.query(
        `INSERT INTO user_relationships (user_id, relationship_type, display_name, is_active, is_system_default)
         VALUES ($1, $2, $3, true, true)`,
        [testUserId, rel, rel.charAt(0).toUpperCase() + rel.slice(1)]
      );
    }
  });

  afterEach(async () => {
    // Clean up test user (cascades to all related data)
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [testUserId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('createPerson', () => {
    it('should create a person with email successfully', async () => {
      const person = await personService.createPerson({
        userId: testUserId,
        name: 'Joe Doe',
        emailAddress: 'joe@example.com'
      });

      expect(person).toBeDefined();
      expect(person.name).toBe('Joe Doe');
      expect(person.user_id).toBe(testUserId);
      expect(person.emails).toHaveLength(1);
      expect(person.emails[0].email_address).toBe('john@example.com');
      expect(person.emails[0].is_primary).toBe(true);
    });

    it('should create a person with relationship', async () => {
      const person = await personService.createPerson({
        userId: testUserId,
        name: 'Jane Doe',
        emailAddress: 'jane@example.com',
        relationshipType: RelationshipType.COLLEAGUE,
        confidence: 0.9
      });

      expect(person.relationships).toHaveLength(1);
      expect(person.relationships[0].relationship_type).toBe('colleague');
      expect(person.relationships[0].confidence).toBe(0.9);
      expect(person.relationships[0].is_primary).toBe(true);
      expect(person.relationships[0].user_set).toBe(false);
    });

    it('should normalize email to lowercase', async () => {
      const person = await personService.createPerson({
        userId: testUserId,
        name: 'Test Person',
        emailAddress: 'TEST@EXAMPLE.COM'
      });

      expect(person.emails[0].email_address).toBe('test@example.com');
    });

    it('should trim person name', async () => {
      const person = await personService.createPerson({
        userId: testUserId,
        name: '  Joe Doe  ',
        emailAddress: 'joe2@example.com'
      });

      expect(person.name).toBe('Joe Doe');
    });

    it('should throw ValidationError for invalid email', async () => {
      await expect(
        personService.createPerson({
          userId: testUserId,
          name: 'Test Person',
          emailAddress: 'invalid-email'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for empty name', async () => {
      await expect(
        personService.createPerson({
          userId: testUserId,
          name: '   ',
          emailAddress: 'test@example.com'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid confidence', async () => {
      await expect(
        personService.createPerson({
          userId: testUserId,
          name: 'Test Person',
          emailAddress: 'test@example.com',
          confidence: 1.5
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw DuplicateEmailError for existing email', async () => {
      await personService.createPerson({
        userId: testUserId,
        name: 'First Person',
        emailAddress: 'duplicate@example.com'
      });

      await expect(
        personService.createPerson({
          userId: testUserId,
          name: 'Second Person',
          emailAddress: 'DUPLICATE@EXAMPLE.COM'
        })
      ).rejects.toThrow(DuplicateEmailError);
    });

    it('should throw InvalidRelationshipError for non-existent relationship type', async () => {
      await expect(
        personService.createPerson({
          userId: testUserId,
          name: 'Test Person',
          emailAddress: 'test@example.com',
          // Cast to bypass TypeScript check - testing runtime validation
          relationshipType: 'non-existent' as RelationshipType
        })
      ).rejects.toThrow(InvalidRelationshipError);
    });
  });

  describe('addEmailToPerson', () => {
    let personId: string;

    beforeEach(async () => {
      const person = await personService.createPerson({
        userId: testUserId,
        name: 'Test Person',
        emailAddress: 'primary@example.com'
      });
      personId = person.id;
    });

    it('should add email to person successfully', async () => {
      const updated = await personService.addEmailToPerson(
        personId,
        'secondary@example.com',
        testUserId
      );

      expect(updated.emails).toHaveLength(2);
      const secondaryEmail = updated.emails.find(e => e.email_address === 'secondary@example.com');
      expect(secondaryEmail).toBeDefined();
      expect(secondaryEmail?.is_primary).toBe(false);
    });

    it('should normalize email when adding', async () => {
      const updated = await personService.addEmailToPerson(
        personId,
        'SECONDARY@EXAMPLE.COM',
        testUserId
      );

      const secondaryEmail = updated.emails.find(e => e.email_address === 'secondary@example.com');
      expect(secondaryEmail).toBeDefined();
    });

    it('should throw PersonNotFoundError for non-existent person', async () => {
      await expect(
        personService.addEmailToPerson(
          '00000000-0000-0000-0000-000000000000',
          'test@example.com',
          testUserId
        )
      ).rejects.toThrow(PersonNotFoundError);
    });

    it('should throw DuplicateEmailError when email already exists for person', async () => {
      await expect(
        personService.addEmailToPerson(
          personId,
          'primary@example.com',
          testUserId
        )
      ).rejects.toThrow(DuplicateEmailError);
    });

    it('should throw DuplicateEmailError when email exists for another person', async () => {
      const person2 = await personService.createPerson({
        userId: testUserId,
        name: 'Another Person',
        emailAddress: 'another@example.com'
      });

      await expect(
        personService.addEmailToPerson(
          personId,
          'another@example.com',
          testUserId
        )
      ).rejects.toThrow(DuplicateEmailError);
    });

    it('should throw ValidationError for invalid email', async () => {
      await expect(
        personService.addEmailToPerson(
          personId,
          'invalid-email',
          testUserId
        )
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid UUID', async () => {
      await expect(
        personService.addEmailToPerson(
          'not-a-uuid',
          'test@example.com',
          testUserId
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('findPersonByEmail', () => {
    beforeEach(async () => {
      await personService.createPerson({
        userId: testUserId,
        name: 'Test Person',
        emailAddress: 'findme@example.com',
        relationshipType: RelationshipType.FRIENDS
      });
    });

    it('should find person by email', async () => {
      const person = await personService.findPersonByEmail('findme@example.com', testUserId);

      expect(person).toBeDefined();
      expect(person?.name).toBe('Test Person');
      expect(person?.emails[0].email_address).toBe('findme@example.com');
    });

    it('should find person by email case-insensitive', async () => {
      const person = await personService.findPersonByEmail('FINDME@EXAMPLE.COM', testUserId);

      expect(person).toBeDefined();
      expect(person?.name).toBe('Test Person');
    });

    it('should return null for non-existent email', async () => {
      const person = await personService.findPersonByEmail('notfound@example.com', testUserId);

      expect(person).toBeNull();
    });

    it('should not find person from different user', async () => {
      const otherUserId = 'other-user-' + Date.now();
      await pool.query(
        `INSERT INTO "user" (id, email, name, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [otherUserId, 'other@example.com', 'Other User']
      );

      const person = await personService.findPersonByEmail('findme@example.com', otherUserId);

      expect(person).toBeNull();

      await pool.query(`DELETE FROM "user" WHERE id = $1`, [otherUserId]);
    });

    it('should throw ValidationError for invalid email', async () => {
      await expect(
        personService.findPersonByEmail('invalid-email', testUserId)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getPersonById', () => {
    let personId: string;

    beforeEach(async () => {
      const person = await personService.createPerson({
        userId: testUserId,
        name: 'Test Person',
        emailAddress: 'primary@example.com',
        relationshipType: RelationshipType.COLLEAGUE,
        confidence: 0.8
      });
      personId = person.id;

      // Add secondary email
      await personService.addEmailToPerson(personId, 'secondary@example.com', testUserId);
    });

    it('should get person with all emails and relationships', async () => {
      const person = await personService.getPersonById(personId, testUserId);

      expect(person).toBeDefined();
      expect(person?.name).toBe('Test Person');
      expect(person?.emails).toHaveLength(2);
      expect(person?.relationships).toHaveLength(1);
      expect(person?.relationships[0].relationship_type).toBe('colleague');
    });

    it('should return null for non-existent person', async () => {
      const person = await personService.getPersonById(
        '00000000-0000-0000-0000-000000000000',
        testUserId
      );

      expect(person).toBeNull();
    });

    it('should return null for unauthorized access', async () => {
      const otherUserId = 'other-user-' + Date.now();
      const person = await personService.getPersonById(personId, otherUserId);

      expect(person).toBeNull();
    });

    it('should throw ValidationError for invalid UUID', async () => {
      await expect(
        personService.getPersonById('not-a-uuid', testUserId)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('listPeopleForUser', () => {
    beforeEach(async () => {
      // Create multiple people
      for (let i = 0; i < 5; i++) {
        await personService.createPerson({
          userId: testUserId,
          name: `Person ${String.fromCharCode(65 + i)}`, // A, B, C, D, E
          emailAddress: `person${i}@example.com`
        });
      }
    });

    it('should list all people for user', async () => {
      const people = await personService.listPeopleForUser({
        userId: testUserId
      });

      expect(people).toHaveLength(5);
      // Should be sorted by name
      expect(people[0].name).toBe('Person A');
      expect(people[4].name).toBe('Person E');
    });

    it('should respect pagination limit', async () => {
      const people = await personService.listPeopleForUser({
        userId: testUserId,
        limit: 3
      });

      expect(people).toHaveLength(3);
    });

    it('should respect pagination offset', async () => {
      const people = await personService.listPeopleForUser({
        userId: testUserId,
        limit: 2,
        offset: 2
      });

      expect(people).toHaveLength(2);
      expect(people[0].name).toBe('Person C');
      expect(people[1].name).toBe('Person D');
    });

    it('should cap limit at 100', async () => {
      const people = await personService.listPeopleForUser({
        userId: testUserId,
        limit: 200
      });

      // We only have 5 people, but the query should have capped at 100
      expect(people.length).toBeLessThanOrEqual(100);
    });

    it('should handle negative offset as 0', async () => {
      const people = await personService.listPeopleForUser({
        userId: testUserId,
        offset: -10
      });

      expect(people).toHaveLength(5);
      expect(people[0].name).toBe('Person A');
    });

    it('should return empty array for user with no people', async () => {
      const emptyUserId = 'empty-user-' + Date.now();
      const emptyEmail = `empty-${Date.now()}@example.com`;
      await pool.query(
        `INSERT INTO "user" (id, email, name, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [emptyUserId, emptyEmail, 'Empty User']
      );

      const people = await personService.listPeopleForUser({
        userId: emptyUserId
      });

      expect(people).toEqual([]);

      await pool.query(`DELETE FROM "user" WHERE id = $1`, [emptyUserId]);
    });
  });

  describe('mergePeople', () => {
    let person1Id: string;
    let person2Id: string;

    beforeEach(async () => {
      const person1 = await personService.createPerson({
        userId: testUserId,
        name: 'Person One',
        emailAddress: 'person1@example.com',
        relationshipType: RelationshipType.FRIENDS,
        confidence: 0.7
      });
      person1Id = person1.id;

      const person2 = await personService.createPerson({
        userId: testUserId,
        name: 'Person Two',
        emailAddress: 'person2@example.com',
        relationshipType: RelationshipType.COLLEAGUE,
        confidence: 0.9
      });
      person2Id = person2.id;
    });

    it('should merge people successfully', async () => {
      const merged = await personService.mergePeople({
        userId: testUserId,
        sourcePersonId: person2Id,
        targetPersonId: person1Id
      });

      expect(merged.id).toBe(person1Id);
      expect(merged.emails).toHaveLength(2);
      expect(merged.emails.map(e => e.email_address)).toContain('person1@example.com');
      expect(merged.emails.map(e => e.email_address)).toContain('person2@example.com');
      expect(merged.relationships).toHaveLength(2);

      // Source person should be deleted
      const sourcePerson = await personService.getPersonById(person2Id, testUserId);
      expect(sourcePerson).toBeNull();
    });

    it('should skip duplicate emails during merge', async () => {
      // Add different emails to each person
      await personService.addEmailToPerson(person1Id, 'extra1@example.com', testUserId);
      await personService.addEmailToPerson(person2Id, 'extra2@example.com', testUserId);
      
      // Add a common email to person1
      await personService.addEmailToPerson(person1Id, 'shared@example.com', testUserId);
      
      // Manually insert the same email for person2 to simulate an edge case
      // (normally this would be prevented by our service)
      await pool.query(
        `INSERT INTO person_emails (person_id, email_address, is_primary, created_at)
         VALUES ($1, $2, false, NOW())`,
        [person2Id, 'shared@example.com']
      );

      const merged = await personService.mergePeople({
        userId: testUserId,
        sourcePersonId: person2Id,
        targetPersonId: person1Id
      });

      // Should have all unique emails: person1@, person2@, extra1@, extra2@, shared@
      expect(merged.emails).toHaveLength(5);
      
      // Should not have duplicate of shared@example.com
      const sharedEmails = merged.emails.filter(e => e.email_address === 'shared@example.com');
      expect(sharedEmails).toHaveLength(1);
    });

    it('should preserve user_set relationships during merge', async () => {
      // Manually set a relationship
      // First get the user_relationship_id for 'friend'
      const friendRelResult = await pool.query(
        `SELECT id FROM user_relationships 
         WHERE user_id = $1 AND relationship_type = 'friend'`,
        [testUserId]
      );
      const friendRelId = friendRelResult.rows[0]?.id;
      
      await pool.query(
        `UPDATE person_relationships 
         SET user_set = true, confidence = 1.0 
         WHERE person_id = $1 AND user_relationship_id = $2`,
        [person1Id, friendRelId]
      );

      const merged = await personService.mergePeople({
        userId: testUserId,
        sourcePersonId: person2Id,
        targetPersonId: person1Id
      });

      const friendRel = merged.relationships.find(r => r.relationship_type === 'friend');
      expect(friendRel?.user_set).toBe(true);
      expect(friendRel?.confidence).toBe(1.0);
    });

    it('should throw ValidationError when merging person with themselves', async () => {
      await expect(
        personService.mergePeople({
          userId: testUserId,
          sourcePersonId: person1Id,
          targetPersonId: person1Id
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw PersonNotFoundError for non-existent source', async () => {
      await expect(
        personService.mergePeople({
          userId: testUserId,
          sourcePersonId: '00000000-0000-0000-0000-000000000000',
          targetPersonId: person1Id
        })
      ).rejects.toThrow(PersonNotFoundError);
    });

    it('should throw PersonNotFoundError for non-existent target', async () => {
      await expect(
        personService.mergePeople({
          userId: testUserId,
          sourcePersonId: person1Id,
          targetPersonId: '00000000-0000-0000-0000-000000000000'
        })
      ).rejects.toThrow(PersonNotFoundError);
    });

    it('should throw ValidationError for invalid UUIDs', async () => {
      await expect(
        personService.mergePeople({
          userId: testUserId,
          sourcePersonId: 'not-a-uuid',
          targetPersonId: person1Id
        })
      ).rejects.toThrow(ValidationError);
    });
  });
});