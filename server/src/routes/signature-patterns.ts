import express from 'express';
import { requireAuth } from '../middleware/auth';
import { RegexSignatureDetector } from '../lib/regex-signature-detector';
import { pool } from '../lib/db';

const router = express.Router();
const regexSignatureDetector = new RegexSignatureDetector(pool);

// Get user's signature patterns
router.get('/', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const patterns = await regexSignatureDetector.loadUserPatterns(userId);
    
    res.json({
      patterns
    });
  } catch (error) {
    console.error('Error loading signature patterns:', error);
    res.status(500).json({ 
      error: 'Failed to load signature patterns',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update user's signature patterns
router.put('/', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { patterns } = req.body;
    
    if (!Array.isArray(patterns)) {
      res.status(400).json({ error: 'Patterns must be an array' });
      return;
    }
    
    // Validate each pattern is a valid regex
    const validPatterns: string[] = [];
    const errors: { pattern: string; error: string }[] = [];
    
    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
        validPatterns.push(pattern);
      } catch (e) {
        errors.push({
          pattern,
          error: e instanceof Error ? e.message : 'Invalid regex'
        });
      }
    }
    
    if (errors.length > 0) {
      res.status(400).json({ 
        error: 'Some patterns are invalid',
        details: errors
      });
      return;
    }
    
    await regexSignatureDetector.saveUserPatterns(userId, validPatterns);
    
    res.json({ 
      success: true,
      patterns: validPatterns
    });
  } catch (error) {
    console.error('Error saving signature patterns:', error);
    res.status(500).json({ 
      error: 'Failed to save signature patterns',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test signature patterns against sample text
router.post('/test', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { text, patterns } = req.body;
    
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }
    
    // Use provided patterns or user's saved patterns
    const testPatterns = patterns || await regexSignatureDetector.loadUserPatterns(userId);
    
    // Test each pattern
    const results = [];
    for (const pattern of testPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        const lines = text.split('\n');
        const matches = [];
        
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({
              line: i + 1,
              text: lines[i],
              match: lines[i].match(regex)?.[0]
            });
          }
        }
        
        results.push({
          pattern,
          matches,
          wouldRemoveFrom: matches.length > 0 ? Math.min(...matches.map(m => m.line)) : -1
        });
      } catch (e) {
        results.push({
          pattern,
          error: e instanceof Error ? e.message : 'Invalid regex'
        });
      }
    }
    
    // Also test the full removal
    const tempPatterns = await regexSignatureDetector.loadUserPatterns(userId);
    await regexSignatureDetector.saveUserPatterns(userId, testPatterns);
    
    const removalResult = await regexSignatureDetector.removeSignature(text, userId);
    
    // Restore original patterns
    await regexSignatureDetector.saveUserPatterns(userId, tempPatterns);
    
    res.json({ 
      patterns: results,
      removal: {
        cleanedText: removalResult.cleanedText,
        signature: removalResult.signature,
        matchedPattern: removalResult.matchedPattern
      }
    });
  } catch (error) {
    console.error('Error testing signature patterns:', error);
    res.status(500).json({ 
      error: 'Failed to test signature patterns',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;