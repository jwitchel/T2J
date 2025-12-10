import { Router, Request, Response } from 'express';
import { auth } from '../lib/auth';
import { personService } from '../lib/relationships/person-service';
import { userRelationshipService } from '../lib/relationships/user-relationship-service';
import { RelationshipType } from '../lib/relationships/types';

// Helper to validate relationship type
function isValidRelationshipType(type: string): type is RelationshipType {
  return Object.values(RelationshipType).includes(type as RelationshipType);
}

const router = Router();

// Middleware to ensure user is authenticated
router.use(async (req: Request, res: Response, next) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers as any });
    
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Attach user to request
    req.user = session.user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get all user relationships (returns enum-based relationship types)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const relationships = await userRelationshipService.getAllRelationships(userId);

    return res.json({ relationships });
  } catch (error) {
    console.error('Error fetching relationships:', error);
    return res.status(500).json({ error: 'Failed to fetch relationships' });
  }
});

// Get all people
router.get('/people', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit as string);
    const offset = parseInt(req.query.offset as string);
    
    const people = await personService.listPeopleForUser({
      userId,
      limit,
      offset
    });
    
    return res.json({ people });
  } catch (error) {
    console.error('Error fetching people:', error);
    return res.status(500).json({ error: 'Failed to fetch people' });
  }
});

// Get a specific person
router.get('/people/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    const person = await personService.getPersonById(id, userId);
    
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }
    
    return res.json({ person });
  } catch (error: any) {
    console.error('Error fetching person:', error);
    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: error.message });
    } else {
      return res.status(500).json({ error: 'Failed to fetch person' });
    }
  }
});

// Create a new person
router.post('/people', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { name, emailAddress, relationshipType, confidence } = req.body;
    
    if (!name || !emailAddress) {
      return res.status(400).json({ error: 'Name and email address are required' });
    }
    
    const person = await personService.createPerson({
      userId,
      name,
      emailAddress,
      relationshipType,
      confidence
    });
    
    return res.status(201).json({ person });
  } catch (error: any) {
    console.error('Error creating person:', error);
    if (error.code === 'DUPLICATE_EMAIL') {
      return res.status(409).json({ error: error.message });
    } else if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: error.message });
    } else {
      return res.status(500).json({ error: 'Failed to create person' });
    }
  }
});

// Add email to person
router.post('/people/:id/emails', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { emailAddress } = req.body;
    
    if (!emailAddress) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    
    const person = await personService.addEmailToPerson(id, emailAddress, userId);
    
    return res.json({ person });
  } catch (error: any) {
    console.error('Error adding email:', error);
    if (error.code === 'PERSON_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    } else if (error.code === 'DUPLICATE_EMAIL') {
      return res.status(409).json({ error: error.message });
    } else if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: error.message });
    } else {
      return res.status(500).json({ error: 'Failed to add email' });
    }
  }
});

// Assign relationship to person by person ID
router.post('/people/:id/relationships', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { relationshipType, isPrimary, confidence } = req.body;

    if (!relationshipType) {
      return res.status(400).json({ error: 'Relationship type is required' });
    }

    if (!isValidRelationshipType(relationshipType)) {
      return res.status(400).json({ error: `Invalid relationship type: ${relationshipType}` });
    }

    const person = await personService.assignRelationshipToPerson(
      id,
      userId,
      relationshipType,
      isPrimary ?? false,
      confidence ?? 1.0
    );

    return res.json({ person });
  } catch (error: any) {
    console.error('Error assigning relationship:', error);
    if (error.code === 'PERSON_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    } else if (error.code === 'INVALID_RELATIONSHIP') {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to assign relationship' });
  }
});

// Set relationship by email address (used by UI dropdown)
router.post('/by-email', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { emailAddress, relationshipType } = req.body;

    if (!emailAddress) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    if (!relationshipType) {
      return res.status(400).json({ error: 'Relationship type is required' });
    }

    if (!isValidRelationshipType(relationshipType)) {
      return res.status(400).json({ error: `Invalid relationship type: ${relationshipType}` });
    }

    const person = await personService.setRelationshipByEmail(
      emailAddress,
      relationshipType,
      userId
    );

    return res.json({ success: true, person });
  } catch (error: any) {
    console.error('Error setting relationship by email:', error);
    if (error.code === 'PERSON_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    } else if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to set relationship' });
  }
});

// Merge two people
router.post('/people/merge', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { sourcePersonId, targetPersonId } = req.body;
    
    if (!sourcePersonId || !targetPersonId) {
      return res.status(400).json({ error: 'Source and target person IDs are required' });
    }
    
    const mergedPerson = await personService.mergePeople({
      userId,
      sourcePersonId,
      targetPersonId
    });
    
    return res.json({ person: mergedPerson });
  } catch (error: any) {
    console.error('Error merging people:', error);
    if (error.code === 'PERSON_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    } else if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: error.message });
    } else {
      return res.status(500).json({ error: 'Failed to merge people' });
    }
  }
});

// Get relationship suggestions for an email
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const { email } = req.query;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email parameter is required' });
    }
    
    const suggestions = await userRelationshipService.getRelationshipSuggestions();
    
    return res.json({ suggestions });
  } catch (error) {
    console.error('Error getting suggestions:', error);
    return res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

export default router;