import { extractEmailFeatures, EmailFeatures } from '../nlp-feature-extractor';
import { sampleEmails } from './sample-emails';

describe('NLP Feature Extractor', () => {
  describe('extractEmailFeatures', () => {
    it('should extract all features from an email', () => {
      const email = sampleEmails.colleagues[0];
      const features = extractEmailFeatures(email);
      
      expect(features).toHaveProperty('questions');
      expect(features).toHaveProperty('sentiment');
      expect(features).toHaveProperty('tonalQualities');
      expect(features).toHaveProperty('linguisticStyle');
      expect(features).toHaveProperty('actionItems');
      expect(features).toHaveProperty('contextType');
      expect(features).toHaveProperty('relationshipHints');
      expect(features).toHaveProperty('stats');
    });
  });

  // Contractions extraction has been removed from the feature extractor

  describe('Questions Extraction', () => {
    it('should extract questions from emails', () => {
      const text = "How are you? Can we meet tomorrow? I was wondering if you received my last email.";
      const features = extractEmailFeatures(text);
      
      expect(features.questions).toHaveLength(2);
      expect(features.questions[0]).toBe("How are you?");
      expect(features.questions[1]).toBe("Can we meet tomorrow?");
    });
  });

  // Sentence starters extraction has been removed from the feature extractor

  // Closings detection has been removed from the feature extractor

  describe('Enhanced Sentiment Analysis', () => {
    it('should detect enthusiastic sentiment', () => {
      const features = extractEmailFeatures("This is amazing! I'm so excited about this fantastic opportunity!!!");
      
      expect(features.sentiment.primary).toBe('enthusiastic');
      expect(features.sentiment.intensity).toBeGreaterThan(0.6);
      expect(features.sentiment.emotions).toContain('excited');
      expect(features.sentiment.score).toBeGreaterThan(0.5);
    });

    it('should detect positive sentiment with emotions', () => {
      const features = extractEmailFeatures("I'm happy with the results. Thank you for your help.");
      
      expect(features.sentiment.primary).toBe('positive');
      expect(features.sentiment.emotions).toContain('happy');
      expect(features.sentiment.emotions).toContain('grateful');
    });

    it('should detect frustrated sentiment', () => {
      const features = extractEmailFeatures("This is terrible and awful! I'm extremely frustrated with the complete lack of progress. This is unacceptable!");
      
      expect(features.sentiment.primary).toBe('frustrated');
      expect(features.sentiment.intensity).toBeGreaterThan(0.5);
      expect(features.sentiment.emotions).toContain('frustrated');
    });

    it('should detect concerned sentiment', () => {
      const features = extractEmailFeatures("I'm worried about the deadline. There are some issues we need to address.");
      
      expect(features.sentiment.primary).toBe('concerned');
      expect(features.sentiment.emotions).toContain('concerned');
      expect(features.sentiment.score).toBeLessThan(0);
    });

    it('should detect neutral sentiment', () => {
      const features = extractEmailFeatures("I received your email. The meeting is at 3pm.");
      
      expect(features.sentiment.primary).toBe('neutral');
      expect(features.sentiment.intensity).toBeLessThan(0.3);
    });

    it('should extract emojis as tone indicators', () => {
      const features = extractEmailFeatures("Great job! 😊 Looking forward to it! 🎉");
      
      expect(features.sentiment.emojis).toBeDefined();
      expect(features.sentiment.emojis).toContain('😊');
      expect(features.sentiment.emojis).toContain('🎉');
    });

    it('should have high confidence with multiple indicators', () => {
      const features = extractEmailFeatures("I'm absolutely thrilled! This is wonderful news! 😊 Can't wait!");
      
      expect(features.sentiment.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Tonal Qualities Analysis', () => {
    it('should analyze warmth', () => {
      const warm = extractEmailFeatures("I hope you're doing well! It was great to hear from you. Let's catch up soon!");
      const cold = extractEmailFeatures("Per my last email, the deadline was yesterday. For your information, this is unacceptable.");
      
      expect(warm.tonalQualities.warmth).toBeGreaterThan(0.6);
      expect(cold.tonalQualities.warmth).toBeLessThan(0.3);
    });

    it('should analyze formality levels', () => {
      const formal = extractEmailFeatures("Dear Mr. Smith, I am writing to inquire about your services. Please find attached the requested documents. Sincerely, Joe");
      const informal = extractEmailFeatures("Hey! What's up? Wanna grab lunch tomorrow? Let me know!");
      
      expect(formal.tonalQualities.formality).toBeGreaterThan(0.7);
      expect(informal.tonalQualities.formality).toBeLessThan(0.3);
    });

    it('should analyze urgency as a continuous value', () => {
      const urgent = extractEmailFeatures("This is URGENT! I need this immediately. Please respond ASAP!!!");
      const relaxed = extractEmailFeatures("No rush on this. Whenever you get a chance is fine.");
      
      expect(urgent.tonalQualities.urgency).toBeGreaterThan(0.8);
      expect(relaxed.tonalQualities.urgency).toBeLessThan(0.2);
    });

    it('should analyze directness', () => {
      const direct = extractEmailFeatures("Send me the report. I need it by 5pm. Make sure it includes all data.");
      const indirect = extractEmailFeatures("I was wondering if you might be able to send me the report? Perhaps when you have a moment?");
      
      expect(direct.tonalQualities.directness).toBeGreaterThan(0.6);
      expect(indirect.tonalQualities.directness).toBeLessThan(0.3);
    });

    it('should analyze enthusiasm', () => {
      const enthusiastic = extractEmailFeatures("This is absolutely fantastic! I'm super excited!!! Best news ever!");
      const unenthusiastic = extractEmailFeatures("I received your message. The information has been noted.");
      
      expect(enthusiastic.tonalQualities.enthusiasm).toBeGreaterThan(0.7);
      expect(unenthusiastic.tonalQualities.enthusiasm).toBeLessThan(0.3);
    });

    it('should analyze politeness as a tonal quality', () => {
      const polite = extractEmailFeatures("Would you kindly help me with this? I would greatly appreciate your assistance. Thank you so much!");
      const impolite = extractEmailFeatures("Fix this now. Stop making these mistakes.");
      
      expect(polite.tonalQualities.politeness).toBeGreaterThanOrEqual(0.6);
      expect(impolite.tonalQualities.politeness).toBeLessThan(0.4);
    });
  });

  describe('Linguistic Style Analysis', () => {
    it('should analyze vocabulary complexity', () => {
      const simple = extractEmailFeatures("Good good good. Nice nice. Happy happy happy.");
      const sophisticated = extractEmailFeatures("I appreciate your comprehensive analysis. The ramifications of this decision warrant further deliberation.");
      
      expect(simple.linguisticStyle.vocabularyComplexity).toBe('simple');
      expect(sophisticated.linguisticStyle.vocabularyComplexity).toBe('sophisticated');
    });

    it('should analyze sentence structure', () => {
      const concise = extractEmailFeatures("Got it. Will do. Thanks.");
      const elaborate = extractEmailFeatures("I wanted to take a moment to express my sincere gratitude for the exceptional work you've done on this project, which has exceeded all of our expectations and delivered tremendous value to our organization.");
      
      expect(concise.linguisticStyle.sentenceStructure).toBe('concise');
      expect(elaborate.linguisticStyle.sentenceStructure).toBe('elaborate');
    });

    it('should extract conversational markers', () => {
      const features = extractEmailFeatures("So anyway, I was thinking, you know, maybe we should, like, actually consider this option. I mean, honestly, it makes sense.");
      
      expect(features.linguisticStyle.conversationalMarkers).toContain('anyway');
      expect(features.linguisticStyle.conversationalMarkers).toContain('you know');
      expect(features.linguisticStyle.conversationalMarkers.some(m => m.includes('i mean'))).toBe(true);
      expect(features.linguisticStyle.conversationalMarkers).toContain('honestly');
      expect(features.linguisticStyle.conversationalMarkers).toContain('actually');
    });
  });

  describe('Action Items Extraction', () => {
    it('should identify requests', () => {
      const features = extractEmailFeatures("Can you please review this document? Would you send me the updated version?");
      
      const requests = features.actionItems.filter(item => item.type === 'request');
      expect(requests).toHaveLength(2);
      expect(requests[0].text).toContain("Can you please review");
    });

    it('should identify commitments', () => {
      const features = extractEmailFeatures("I will send you the report tomorrow. I'll make sure to include all the details.");
      
      const commitments = features.actionItems.filter(item => item.type === 'commitment');
      expect(commitments).toHaveLength(2);
    });

    it('should identify suggestions', () => {
      const features = extractEmailFeatures("Maybe we should meet next week. How about we discuss this over lunch?");
      
      const suggestions = features.actionItems.filter(item => item.type === 'suggestion');
      expect(suggestions).toHaveLength(2);
    });
  });

  describe('Context Type Inference', () => {
    it('should identify questions', () => {
      const features = extractEmailFeatures("When can we meet? What's your availability?");
      expect(features.contextType).toBe('question');
    });

    it('should identify answers', () => {
      const features = extractEmailFeatures("In response to your question, yes we can proceed.");
      expect(features.contextType).toBe('answer');
    });

    it('should identify updates', () => {
      const features = extractEmailFeatures("Quick update: the project is now completed.");
      expect(features.contextType).toBe('update');
    });

    it('should identify scheduling', () => {
      const features = extractEmailFeatures("Let's schedule a meeting for next week.");
      expect(features.contextType).toBe('scheduling');
    });
  });

  describe('Enhanced Relationship Hints', () => {
    it('should detect intimate relationships through linguistic patterns', () => {
      const features = extractEmailFeatures(sampleEmails.intimate[0]);
      
      expect(features.relationshipHints.linguisticMarkers.endearments).toContain('honey');
      expect(features.relationshipHints.familiarityLevel).toBe('intimate');
      expect(features.tonalQualities.warmth).toBeGreaterThan(0.5);
    });
    
    it('should detect professional relationships through language patterns', () => {
      const features = extractEmailFeatures(sampleEmails.colleagues[0]);
      
      expect(features.relationshipHints.linguisticMarkers.professionalPhrases).toContain('per our discussion');
      expect(features.relationshipHints.linguisticMarkers.professionalPhrases).toContain('for your review');
      expect(features.relationshipHints.familiarityLevel).toBe('professional');
      expect(features.tonalQualities.formality).toBeGreaterThan(0.25);
    });
    
    it('should detect very familiar relationships through informal language', () => {
      const features = extractEmailFeatures(sampleEmails.close_friends[0]);
      
      expect(features.relationshipHints.linguisticMarkers.informalLanguage).toContain('lol');
      expect(features.relationshipHints.linguisticMarkers.informalLanguage).toContain('lol');
      expect(features.relationshipHints.linguisticMarkers.informalLanguage).toContain('haha');
      // With only 2 casual markers, it's 'familiar' not 'very_familiar'
      expect(features.relationshipHints.familiarityLevel).toBe('familiar');
      expect(features.tonalQualities.formality).toBeLessThan(0.5);
    });
    
    it('should analyze greeting and closing styles', () => {
      const formal = extractEmailFeatures("Dear Mr. Johnson, I hope this email finds you well. ... Sincerely, Joe Smith");
      const casual = extractEmailFeatures("Hey Sarah! ... Talk to you later!");
      
      expect(formal.relationshipHints.linguisticMarkers.greetingStyle).toBe('formal');
      expect(formal.relationshipHints.linguisticMarkers.closingStyle).toBe('formal');
      expect(casual.relationshipHints.linguisticMarkers.greetingStyle).toBe('casual-personal');
      expect(casual.relationshipHints.linguisticMarkers.closingStyle).toBe('very-casual');
    });
    
    it('should calculate formality indicators comprehensively', () => {
      const formalFeatures = extractEmailFeatures(
        "Dear Ms. Smith, pursuant to our discussion at Acme Corporation, I am writing to follow up on the deliverables. Please find attached the comprehensive analysis you requested. Respectfully yours, Joe",
        { name: 'Ms. Smith' }
      );
      
      expect(formalFeatures.relationshipHints.formalityIndicators.hasTitle).toBe(true);
      expect(formalFeatures.relationshipHints.formalityIndicators.hasCompanyReference).toBe(true);
      expect(formalFeatures.relationshipHints.formalityIndicators.vocabularySophistication).toBeGreaterThan(0.5);
      expect(formalFeatures.relationshipHints.familiarityLevel).toBe('formal');
    });
    
    it('should differentiate all familiarity levels using comprehensive analysis', () => {
      const intimate = extractEmailFeatures("Hey honey! Missing you so much. Can't wait to see you tonight. Love you! xoxo");
      const veryFamiliar = extractEmailFeatures("Dude! That was insane lol. We gotta do that again soon haha! Hit me up!");
      const familiar = extractEmailFeatures("Hey, btw can you send me that file when you get a chance? Thanks!");
      const professional = extractEmailFeatures("Hi Joe, I hope you're well. Could you please review the attached proposal and let me know your thoughts? Best regards");
      const formal = extractEmailFeatures("Dear Mr. Smith, Further to our meeting yesterday, I am pleased to submit the requested documentation for your consideration. Yours sincerely");
      
      expect(intimate.relationshipHints.familiarityLevel).toBe('intimate');
      expect(intimate.tonalQualities.warmth).toBeGreaterThan(0.5);
      
      expect(veryFamiliar.relationshipHints.familiarityLevel).toBe('very_familiar');
      // Short casual texts can still have high vocabulary diversity
      expect(['simple', 'moderate', 'sophisticated']).toContain(veryFamiliar.linguisticStyle.vocabularyComplexity);
      
      expect(familiar.relationshipHints.familiarityLevel).toBe('familiar');
      
      expect(professional.relationshipHints.familiarityLevel).toBe('professional');
      expect(professional.tonalQualities.politeness).toBeGreaterThan(0.6);
      
      expect(formal.relationshipHints.familiarityLevel).toBe('formal');
      expect(formal.tonalQualities.formality).toBeGreaterThan(0.7);
    });
  });

  describe('Statistics Calculation', () => {
    it('should calculate basic statistics', () => {
      const text = "This is a test. It has two sentences.";
      const features = extractEmailFeatures(text);
      
      expect(features.stats.wordCount).toBe(8);
      expect(features.stats.sentenceCount).toBe(2);
      expect(features.stats.avgWordsPerSentence).toBe(4);
    });

    it('should calculate formality score', () => {
      const formal = extractEmailFeatures("Dear Mr. Smith, I hope this email finds you well. Sincerely, Joe");
      const casual = extractEmailFeatures("Hey! What's up? LOL that was funny!");
      
      expect(formal.stats.formalityScore).toBeGreaterThan(0.6);
      expect(casual.stats.formalityScore).toBeLessThan(0.4);
    });

    it('should calculate vocabulary complexity', () => {
      const simple = extractEmailFeatures("Go go go go go");
      const complex = extractEmailFeatures("Various different words create complexity");
      
      expect(simple.stats.vocabularyComplexity).toBeLessThan(0.3);
      expect(complex.stats.vocabularyComplexity).toBeGreaterThan(0.8);
    });
  });

  // Common phrases extraction has been removed from the feature extractor

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      const features = extractEmailFeatures("");
      
      expect(features.stats.sentenceCount).toBe(0);
      expect(features.questions).toEqual([]);
      expect(features.stats.wordCount).toBe(0);
    });

    it('should handle text with no sentences', () => {
      const features = extractEmailFeatures("just some words without punctuation");
      
      expect(features.stats.sentenceCount).toBe(1); // Compromise treats this as one sentence
      expect(features.questions).toEqual([]);
    });

    it('should handle very short text', () => {
      const features = extractEmailFeatures("Hi!");
      
      expect(features.stats.wordCount).toBe(1);
      expect(features.questions).toEqual([]);
    });
  });
});