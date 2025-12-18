import { Router, Request, Response } from 'express';
import { styleAggregationService } from '../lib/style/style-aggregation-service';
import { relationshipService } from '../lib/relationships/relationship-service';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Require authentication for all routes
router.use(requireAuth);

// Get user's aggregated style for a relationship type
router.get('/aggregated/:relationshipType', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { relationshipType } = req.params;
    
    const style = await relationshipService.getAggregatedStyle(userId, relationshipType);
    
    if (style) {
      res.json(style);
    } else {
      res.json({ message: 'No aggregated style yet for this relationship type' });
    }
  } catch (error) {
    console.error('Error fetching aggregated style:', error);
    res.status(500).json({ error: 'Failed to fetch style' });
  }
});

// Get enhanced profile for a recipient
router.get('/profile/:recipientEmail', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { recipientEmail } = req.params;
    
    const profile = await relationshipService.getEnhancedProfile(userId, recipientEmail);
    
    if (profile) {
      res.json(profile);
    } else {
      res.status(404).json({ error: 'Profile not found for recipient' });
    }
  } catch (error) {
    console.error('Error fetching enhanced profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Manually trigger aggregation for user's relationship type
router.post('/aggregate/:relationshipType', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { relationshipType } = req.params;
    
    console.log(`Manual aggregation triggered for user ${userId}, relationship: ${relationshipType}`);
    
    const aggregated = await styleAggregationService
      .aggregateStyleForUser(userId, relationshipType);
    
    await styleAggregationService.updateStylePreferences(
      userId,
      relationshipType,
      aggregated
    );
    
    res.json({
      success: true,
      emailCount: aggregated.emailCount,
      confidenceScore: aggregated.confidenceScore,
      lastUpdated: aggregated.lastUpdated,
      patterns: {
        greetings: aggregated.greetings!.slice(0, 5),
        closings: aggregated.closings!.slice(0, 5),
        emojis: aggregated.emojis!.slice(0, 10),
        sentimentProfile: aggregated.sentimentProfile,
        vocabularyProfile: {
          complexityLevel: aggregated.vocabularyProfile.complexityLevel,
          commonPhrases: aggregated.commonPhrases!.slice(0, 10)
        }
      }
    });
  } catch (error) {
    console.error('Aggregation failed:', error);
    res.status(500).json({ error: 'Aggregation failed' });
  }
});

// Get all relationship types with aggregated styles for the user
router.get('/relationships', async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    
    // Get all active relationships for the user
    const result = await styleAggregationService.getUserRelationshipTypes(userId);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching user relationships:', error);
    res.status(500).json({ error: 'Failed to fetch relationships' });
  }
});

export default router;