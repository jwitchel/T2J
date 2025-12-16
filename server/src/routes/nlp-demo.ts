import { Router } from 'express';
import { extractEmailFeatures } from '../lib/nlp-feature-extractor';

const router = Router();

// Demo endpoint for NLP features
router.post('/api/nlp/analyze', (req, res) => {
  try {
    const { text, recipientEmail, recipientName } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    const features = extractEmailFeatures(text, {
      email: recipientEmail || 'recipient@example.com',
      name: recipientName
    });
    
    // Return formatted response
    return res.json({
      success: true,
      analysis: {
        sentiment: {
          primary: features.sentiment.primary,
          score: features.sentiment.score,
          confidence: features.sentiment.confidence,
          emotions: features.sentiment.emotions,
          intensity: features.sentiment.intensity
        },
        relationship: {
          familiarity: features.relationshipHints.familiarityLevel,
          markers: {
            greeting: features.relationshipHints.linguisticMarkers.greetingStyle,
            closing: features.relationshipHints.linguisticMarkers.closingStyle,
            informal: features.relationshipHints.linguisticMarkers.informalLanguage.length,
            professional: features.relationshipHints.linguisticMarkers.professionalPhrases.length,
            endearments: features.relationshipHints.linguisticMarkers.endearments.length
          }
        },
        tone: features.tonalQualities,
        style: features.linguisticStyle,
        context: features.contextType,
        stats: features.stats,
        actionItems: features.actionItems,
        questions: features.questions
      },
      raw: features // Include full features for debugging
    });
  } catch (error) {
    console.error('NLP analysis error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to analyze text',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get sample texts for demo
router.get('/api/nlp/samples', (_req, res) => {
  res.json({
    samples: [
      {
        category: "Intimate/Personal",
        text: "Hey honey! Just wanted to let you know I'll be home late tonight. Love you! 💕",
        expectedFamiliarity: "intimate"
      },
      {
        category: "Very Familiar",
        text: "Dude! That was insane lol. We gotta do that again soon haha! Hit me up!",
        expectedFamiliarity: "very_familiar"
      },
      {
        category: "Familiar",
        text: "Hey, btw can you send me that file when you get a chance? Thanks!",
        expectedFamiliarity: "familiar"
      },
      {
        category: "Professional",
        text: "Hi Joe, I hope you're well. Could you please review the attached proposal and let me know your thoughts? Best regards",
        expectedFamiliarity: "professional"
      },
      {
        category: "Formal",
        text: "Dear Dr. Smith, Further to our meeting yesterday, I am pleased to submit the requested documentation for your consideration. Yours sincerely",
        expectedFamiliarity: "formal"
      }
    ]
  });
});

export default router;