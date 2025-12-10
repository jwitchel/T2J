import { TemplateManager } from '../template-manager';
import { SelectedExample } from '../example-selector';
import path from 'path';

describe('TemplateManager', () => {
  let templateManager: TemplateManager;
  
  beforeEach(() => {
    const templateDir = path.join(__dirname, '..', 'templates');
    templateManager = new TemplateManager(templateDir);
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      await expect(templateManager.initialize()).resolves.not.toThrow();
    });
  });

  describe('template loading', () => {
    it('should load prompt templates', async () => {
      await templateManager.initialize();
      const template = await templateManager.loadTemplate('default', 'prompt');
      expect(template).toBeDefined();
      expect(typeof template).toBe('function');
    });

    it('should throw error for non-existent template', async () => {
      await templateManager.initialize();
      await expect(templateManager.loadTemplate('non-existent', 'prompt'))
        .rejects.toThrow('Failed to load template non-existent');
    });
  });

  describe('template rendering', () => {
    const mockData = {
      recipientEmail: 'test@example.com',
      relationship: 'friend',
      incomingEmail: 'How are you doing?',
      directExamples: [
        {
          text: 'Hey! I am doing great, thanks for asking!',
          relationship: 'friend',
          wordCount: 8,
          formalityScore: 0.2
        }
      ],
      meta: {
        exampleCount: 1,
        relationshipMatchCount: 1,
        avgWordCount: 8,
        formalityLevel: 'casual'
      }
    };

    it('should render default prompt template', async () => {
      await templateManager.initialize();
      const result = await templateManager.renderPrompt('default', mockData);
      
      expect(result).toContain('test@example.com');
      expect(result).toContain('friend');
      expect(result).toContain('How are you doing?');
      expect(result).toContain('Hey! I am doing great');
    });

    it('should render verbose prompt template', async () => {
      await templateManager.initialize();
      const result = await templateManager.renderPrompt('verbose', mockData);
      
      expect(result).toContain('Relationship Type: friend');
      expect(result).toContain('Target formality: casual');
    });

  });

  describe('helper functions', () => {
    it('should truncate text correctly', async () => {
      await templateManager.initialize();
      const template = await templateManager.loadTemplate('default', 'prompt');
      
      const longText = 'a'.repeat(1100); // Create text longer than 1000 chars
      const data = {
        ...mockData,
        directExamples: [{
          text: longText,
          relationship: 'friend'
        }]
      };
      
      const result = template(data);
      expect(result).toContain('aaaa'); // Should contain part of the text
      expect(result).toContain('...'); // Should be truncated
    });

    it('should handle missing data gracefully', async () => {
      await templateManager.initialize();
      const template = await templateManager.loadTemplate('default', 'prompt');
      
      const minimalData = {
        recipientEmail: 'test@example.com',
        relationship: 'colleague',
        incomingEmail: 'Meeting tomorrow?',
        meta: {
          exampleCount: 0,
          relationshipMatchCount: 0,
          avgWordCount: 0,
          formalityLevel: 'neutral'
        }
      };
      
      const result = template(minimalData);
      expect(result).toContain('test@example.com');
      expect(result).toContain('Meeting tomorrow?');
      expect(result).not.toContain('Example 1');
    });
  });

  describe('formatExamplesForTemplate', () => {
    it('should format SelectedExample array correctly', () => {
      const examples: SelectedExample[] = [
        {
          id: '1',
          text: 'Hello there!',
          scores: { semantic: 0.9, style: 0, combined: 0.9 },
          metadata: {
            relationship: { type: 'friend', confidence: 0.9, detectionMethod: 'auto' },
            features: {
              stats: { formalityScore: 0.3, wordCount: 2 },
              sentiment: { dominant: 'positive' },
              urgency: { level: 'low' }
            },
            wordCount: 2,
            subject: 'Greeting'
          }
        }
      ];
      
      const formatted = templateManager.formatExamplesForTemplate(examples);
      
      expect(formatted).toHaveLength(1);
      expect(formatted[0]).toEqual({
        text: 'Hello there!',
        relationship: 'friend',
        score: 0.9,
        semanticScore: 0.9,
        styleScore: 0,
        combinedScore: 0.9,
        subject: 'Greeting',
        formalityScore: 0.3,
        sentiment: 'positive',
        wordCount: 2,
        urgency: 'low',
        keyPhrases: []
      });
    });
  });

  describe('prepareTemplateData', () => {
    it('should prepare data with direct and category matches', () => {
      const examples: SelectedExample[] = [
        {
          id: '1',
          text: 'Hey friend!',
          scores: { semantic: 0.95, style: 0, combined: 0.95 },
          metadata: {
            relationship: { type: 'friend', confidence: 0.9, detectionMethod: 'auto' },
            features: {
              stats: { formalityScore: 0.2, wordCount: 2 }
            },
            wordCount: 2,
            isDirectCorrespondence: true
          }
        },
        {
          id: '2',
          text: 'Hello colleague',
          scores: { semantic: 0.8, style: 0, combined: 0.8 },
          metadata: {
            relationship: { type: 'colleague', confidence: 0.85, detectionMethod: 'auto' },
            features: {
              stats: { formalityScore: 0.7, wordCount: 2 }
            },
            wordCount: 2,
            isDirectCorrespondence: false
          }
        }
      ];
      
      const data = templateManager.prepareTemplateData({
        incomingEmail: 'Test email',
        recipientEmail: 'test@example.com',
        relationship: 'friend',
        examples,
        relationshipProfile: {
          typicalFormality: 'casual',
          commonGreetings: ['Hey', 'Hi'],
          commonClosings: ['Cheers', 'Thanks'],
          useEmojis: true,
          useHumor: true
        }
      });
      
      expect(data.directExamples).toHaveLength(1);
      expect(data.categoryExamples).toHaveLength(1);
      expect(data.meta.relationshipMatchCount).toBe(1);
      expect(data.meta.avgWordCount).toBe(2);
      expect(data.profile).toBeDefined();
    });
  });
});

const mockData = {
  recipientEmail: 'test@example.com',
  relationship: 'friend',
  incomingEmail: 'How are you doing?',
  directExamples: [
    {
      text: 'Hey! I am doing great, thanks for asking!',
      relationship: 'friend',
      wordCount: 8,
      formalityScore: 0.2
    }
  ],
  meta: {
    exampleCount: 1,
    relationshipMatchCount: 1,
    avgWordCount: 8,
    formalityLevel: 'casual'
  }
};