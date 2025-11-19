import nlp from 'compromise';
import sentencesPlugin from 'compromise-sentences';
import statsPlugin from 'compromise-stats';
const winkSentiment = require('wink-sentiment');

// Extend compromise with plugins
nlp.plugin(sentencesPlugin);
nlp.plugin(statsPlugin);

// Add custom plugin for email-specific tagging
const emailPlugin = {
  tags: {
    Endearment: {
      isA: 'Noun',
      notA: 'Formal'
    },
    BusinessJargon: {
      isA: 'Noun'
    },
    ProfessionalGreeting: {
      isA: 'Expression'
    },
    CasualGreeting: {
      isA: 'Expression'
    }
  },
  words: {
    // Endearments
    honey: 'Endearment',
    hon: 'Endearment',
    babe: 'Endearment',
    baby: 'Endearment',
    sweetheart: 'Endearment',
    sweetie: 'Endearment',
    darling: 'Endearment',
    love: ['Endearment', 'Verb'],
    dear: ['Endearment', 'Adjective'],
    
    // Business jargon
    synergy: 'BusinessJargon',
    bandwidth: 'BusinessJargon',
    leverage: ['BusinessJargon', 'Verb'],
    stakeholder: 'BusinessJargon',
    deliverable: 'BusinessJargon',
    
    // Professional greetings
    'good morning': 'ProfessionalGreeting',
    'good afternoon': 'ProfessionalGreeting',
    'good evening': 'ProfessionalGreeting',
    
    // Casual greetings
    hey: 'CasualGreeting',
    hi: 'CasualGreeting',
    yo: 'CasualGreeting',
    sup: 'CasualGreeting'
  },
  compute: {
    // Add computed properties for better analysis
    afterComma: {
      matches: '[,] [.]',
      direction: 'forward'
    }
  }
};

nlp.plugin(emailPlugin);

export interface EmailFeatures {
  // Linguistic patterns
  questions: string[];
  
  // Enhanced sentiment analysis
  sentiment: {
    primary: 'enthusiastic' | 'positive' | 'neutral' | 'concerned' | 'frustrated' | 'negative';
    intensity: number; // 0-1
    confidence: number; // 0-1
    emotions: string[]; // ['grateful', 'excited', 'apologetic']
    emojis?: string[]; // captured emojis that indicate tone
    score: number; // -1 to 1 (kept for backwards compatibility)
    magnitude: number; // 0 to 1 (kept for backwards compatibility)
  };
  
  // Tonal qualities
  tonalQualities: {
    warmth: number; // 0-1
    formality: number; // 0-1  
    urgency: number; // 0-1
    directness: number; // 0-1
    enthusiasm: number; // 0-1
    politeness: number; // 0-1
  };
  
  // Linguistic style
  linguisticStyle: {
    vocabularyComplexity: 'simple' | 'moderate' | 'sophisticated';
    sentenceStructure: 'concise' | 'moderate' | 'elaborate';
    conversationalMarkers: string[]; // ["anyway", "by the way", "honestly"]
  };
  
  // Context understanding
  actionItems: Array<{
    text: string;
    type: 'request' | 'commitment' | 'suggestion';
  }>;
  contextType: 'question' | 'answer' | 'update' | 'request' | 'acknowledgment' | 'scheduling' | 'other';
  
  // Relationship hints (refactored to use linguistic patterns)
  relationshipHints: {
    familiarityLevel: 'intimate' | 'very_familiar' | 'familiar' | 'professional' | 'formal';
    linguisticMarkers: {
      endearments: string[];
      professionalPhrases: string[];
      informalLanguage: string[];
      greetingStyle: string;
      closingStyle: string;
    };
    formalityIndicators: {
      hasTitle: boolean;
      hasLastName: boolean;
      hasCompanyReference: boolean;
      sentenceComplexity: number;
      vocabularySophistication: number;
    };
  };
  
  // Metrics for vector metadata
  stats: {
    wordCount: number;
    sentenceCount: number;
    avgWordsPerSentence: number;
    vocabularyComplexity: number;
    formalityScore: number; // 0-1
    contractionDensity: number;
  };
}

export function extractEmailFeatures(emailText: string, recipientInfo?: { email?: string; name?: string }): EmailFeatures {
  // Remove special markers before analysis
  // [Forwarded-content-removed] should not affect linguistic analysis or word counts
  const cleanedText = emailText.replace(/\[Forwarded-content-removed\]/gi, '').trim();

  const doc = nlp(cleanedText);
  const winkResult = cleanedText ? winkSentiment(cleanedText) : {
    score: 0,
    normalizedScore: 0,
    tokenizedPhrase: []
  };
  
  // Extract enhanced sentiment and tonal qualities
  const enhancedSentiment = analyzeEnhancedSentiment(cleanedText, doc, winkResult);
  const tonalQualities = analyzeTonalQualities(cleanedText, doc, winkResult);
  const linguisticStyle = analyzeLinguisticStyle(doc);

  return {
    // Removed linguistic patterns: phrases, contractions, sentenceStarters, closings
    questions: doc.questions().out('array'),
    sentiment: enhancedSentiment,
    tonalQualities: tonalQualities,
    linguisticStyle: linguisticStyle,
    actionItems: extractActionItems(cleanedText),
    contextType: inferContextType(cleanedText),
    relationshipHints: extractRelationshipHints(cleanedText, recipientInfo, doc, tonalQualities),
    stats: calculateStats(doc, cleanedText)
  };
}

function extractRelationshipHints(text: string, recipientInfo: { email?: string; name?: string } | undefined, doc: any, tonalQualities: EmailFeatures['tonalQualities']): EmailFeatures['relationshipHints'] {
  // Extract linguistic markers using compromise patterns
  const linguisticMarkers = extractLinguisticMarkers(doc);
  
  // Analyze greeting and closing styles
  const greetingStyle = analyzeGreetingStyle(doc);
  const closingStyle = analyzeClosingStyle(doc, text);
  
  // Calculate formality indicators based on linguistic analysis
  const formalityIndicators = calculateFormalityIndicators(doc, recipientInfo, tonalQualities);
  
  // Determine familiarity level based on comprehensive analysis
  const familiarityLevel = determineFamiliarityLevel(
    linguisticMarkers,
    formalityIndicators,
    tonalQualities,
    greetingStyle,
    closingStyle
  );
  
  return {
    familiarityLevel,
    linguisticMarkers: {
      ...linguisticMarkers,
      greetingStyle,
      closingStyle
    },
    formalityIndicators
  };
}

function extractLinguisticMarkers(doc: any): {
  endearments: string[];
  professionalPhrases: string[];
  informalLanguage: string[];
} {
  const endearments: string[] = [];
  const professionalPhrases: string[] = [];
  const informalLanguage: string[] = [];
  
  // Use compromise's tagging and patterns for endearments
  // Look for patterns that indicate intimate relationships
  const termsOfEndearment = doc.match('#Endearment');
  const loveExpressions = doc.match('love #Pronoun');
  
  // Collect endearments
  if (termsOfEndearment.found) {
    termsOfEndearment.forEach((m: any) => {
      const term = m.text().toLowerCase();
      // Filter out formal uses like "Dear Sir"
      if (!m.has('dear #Honorific') && !m.has('dear sir')) {
        endearments.push(term);
      }
    });
  }
  
  if (loveExpressions.found) {
    endearments.push('love');
  }
  
  // Professional language patterns - match longer phrases first
  const businessPhrases = doc.match('(per our discussion|as per our|pursuant to|with regard to|further to|per our)');
  const formalRequests = doc.match('(please find attached|for your review|kindly|at your earliest convenience|for your consideration|please find|for your)');
  const corporateLanguage = doc.match('(stakeholder|deliverable|action item|touch base|circle back|bandwidth)');
  
  [businessPhrases, formalRequests, corporateLanguage].forEach(matches => {
    if (matches.found) {
      matches.forEach((m: any) => {
        const phrase = m.text().toLowerCase();
        // Add full phrase if it's a compound phrase
        professionalPhrases.push(phrase);
      });
    }
  });
  
  // Use compromise's built-in tags for informal language detection
  // First, enhance tagging for common informal expressions
  const informalExpressions = ['lol', 'lmao', 'omg', 'btw', 'fyi', 'haha', 'hehe', 'dude', 'bro', 'gotta', 'gonna', 'wanna'];
  informalExpressions.forEach(expr => {
    doc.match(expr).tag('Informal');
  });
  
  const informalIndicators = {
    informal: doc.match('#Informal'),
    slang: doc.match('#Slang'),
    contractions: (doc as any).contractions(),
    interjections: doc.match('#Interjection'),
    emoticons: doc.match('#Emoticon'),
    expressions: doc.match('#Expression').filter((expr: any) => {
      // Filter for informal expressions
      const text = expr.text().toLowerCase();
      return /^(lol|lmao|haha|hehe|omg|btw|fyi|rofl|smh|tbh|imo|imho)/.test(text);
    })
  };
  
  // Collect informal language markers
  if (informalIndicators.informal.found) {
    informalIndicators.informal.forEach((m: any) => {
      const text = m.text().toLowerCase();
      if (!informalLanguage.includes(text)) {
        informalLanguage.push(text);
      }
    });
  }
  
  if (informalIndicators.slang.found) {
    informalIndicators.slang.forEach((m: any) => {
      const text = m.text().toLowerCase();
      if (!informalLanguage.includes(text)) {
        informalLanguage.push(text);
      }
    });
  }
  
  if (informalIndicators.interjections.found) {
    informalIndicators.interjections.forEach((m: any) => {
      const text = m.text().toLowerCase();
      if (!informalLanguage.includes(text)) {
        informalLanguage.push(text);
      }
    });
  }
  
  if (informalIndicators.emoticons.found) {
    informalIndicators.emoticons.forEach((m: any) => {
      informalLanguage.push(m.text());
    });
  }
  
  if (informalIndicators.expressions.found) {
    informalIndicators.expressions.forEach((m: any) => {
      const text = m.text().toLowerCase().replace(/[.,!?]$/, ''); // Remove trailing punctuation
      if (!informalLanguage.includes(text)) {
        informalLanguage.push(text);
      }
    });
  }
  
  // Add contraction density as an indicator
  const contractionCount = informalIndicators.contractions.length;
  const wordCount = doc.wordCount();
  const contractionDensity = wordCount > 0 ? contractionCount / wordCount : 0;
  
  if (contractionDensity > 0.1) { // More than 10% contractions
    informalLanguage.push(`high_contraction_density`);
  } else if (contractionCount > 2) {
    informalLanguage.push(`${contractionCount}_contractions`);
  }
  
  // Detect sentence fragments (informal writing often has fragments)
  const fragments = doc.sentences().filter((s: any) => 
    s.wordCount() < 3 || !s.has('#Verb')
  );
  if (fragments.length > 0) {
    informalLanguage.push(`${fragments.length}_fragments`);
  }
  
  // Check for repeated punctuation (!!!, ???) - informal indicator
  if (/[!?]{2,}/.test(doc.text())) {
    informalLanguage.push('repeated_punctuation');
  }
  
  // Check for all caps words (excluding short acronyms)
  const allCapsWords = doc.match('#Acronym').filter((m: any) => 
    m.text().length > 3 && /^[A-Z]+$/.test(m.text())
  );
  if (allCapsWords.found) {
    informalLanguage.push('emphasis_caps');
  }
  
  return {
    endearments: [...new Set(endearments)],
    professionalPhrases: [...new Set(professionalPhrases)],
    informalLanguage: [...new Set(informalLanguage)]
  };
}

function analyzeGreetingStyle(doc: any): string {
  const firstSentence = doc.sentences().first();
  if (!firstSentence || firstSentence.length === 0) return 'none';
  
  // Check for formal greetings
  if (firstSentence.match('dear #Person').found || firstSentence.match('dear #Honorific').found) {
    return 'formal';
  }
  
  // Check for professional greetings
  if (firstSentence.match('(good morning|good afternoon|good evening)').found) {
    return 'professional';
  }
  
  // Check for casual greetings
  if (firstSentence.match('(hey|hi|hello)').found) {
    const hasName = firstSentence.has('#Person');
    return hasName ? 'casual-personal' : 'casual';
  }
  
  // No greeting detected
  return 'none';
}

function analyzeClosingStyle(_doc: any, text: string): string {
  // Look at the last 150 characters for closing
  const lastPart = text.slice(-150);
  const lastDoc = nlp(lastPart);
  
  // Formal closings
  if (lastDoc.match('(yours (sincerely|truly|faithfully)|respectfully yours)').found) {
    return 'very-formal';
  }
  
  if (lastDoc.match('(sincerely|respectfully|regards|best regards|kind regards)').found) {
    return 'formal';
  }
  
  // Casual closings
  if (lastDoc.match('(thanks|thank you|cheers|best|take care)').found) {
    return 'casual-friendly';
  }
  
  // Intimate closings
  if (lastDoc.match('(love|xoxo|hugs|kisses)').found) {
    return 'intimate';
  }
  
  // Very casual
  if (lastDoc.match('(later|bye|talk soon|ttyl|hit me up|call me|text me)').found) {
    return 'very-casual';
  }
  
  return 'none';
}

function calculateFormalityIndicators(
  doc: any, 
  recipientInfo: { email?: string; name?: string } | undefined,
  tonalQualities: EmailFeatures['tonalQualities']
): EmailFeatures['relationshipHints']['formalityIndicators'] {
  // Check for titles
  const hasTitle = doc.match('#Honorific').found || doc.match('(Mr|Mrs|Ms|Dr|Prof|Sir|Madam)').found;
  
  // Check for last name usage
  let hasLastName = false;
  if (recipientInfo?.name) {
    const nameParts = recipientInfo.name.split(' ');
    if (nameParts.length > 1) {
      const lastName = nameParts[nameParts.length - 1];
      hasLastName = doc.match(lastName).found;
    }
  }
  
  // Check for company/organization references
  const hasCompanyReference = doc.match('#Organization').found || 
    doc.match('(company|corporation|organization|department|team)').found;
  
  // Calculate sentence complexity
  const sentences = doc.sentences();
  const avgWordsPerSentence = doc.wordCount() / sentences.length;
  const sentenceComplexity = Math.min(avgWordsPerSentence / 30, 1); // Normalize to 0-1
  
  // Vocabulary sophistication based on tonalQualities and linguistic analysis
  const sophisticatedTerms = doc.match('(pursuant|aforementioned|heretofore|whereas|notwithstanding)').length;
  const academicTerms = doc.match('(analyze|synthesize|evaluate|implement|utilize|optimize)').length;
  const vocabularySophistication = Math.min(
    (sophisticatedTerms + academicTerms) / doc.wordCount() * 20 + tonalQualities.formality * 0.5,
    1
  );
  
  return {
    hasTitle,
    hasLastName,
    hasCompanyReference,
    sentenceComplexity,
    vocabularySophistication
  };
}

function determineFamiliarityLevel(
  markers: { endearments: string[]; professionalPhrases: string[]; informalLanguage: string[] },
  formalityIndicators: EmailFeatures['relationshipHints']['formalityIndicators'],
  tonalQualities: EmailFeatures['tonalQualities'],
  greetingStyle: string,
  closingStyle: string
): EmailFeatures['relationshipHints']['familiarityLevel'] {
  // Score different aspects
  let intimacyScore = 0;
  let formalityScore = 0;
  let casualScore = 0;
  
  // Endearments strongly indicate intimacy
  intimacyScore += markers.endearments.length * 0.5;
  if (closingStyle === 'intimate') intimacyScore += 0.3;
  if (tonalQualities.warmth > 0.8) intimacyScore += 0.2;
  
  // Professional language indicates formality
  formalityScore += markers.professionalPhrases.length * 0.2;
  formalityScore += formalityIndicators.hasTitle ? 0.3 : 0;
  formalityScore += formalityIndicators.vocabularySophistication * 0.2;
  formalityScore += tonalQualities.formality * 0.3;
  if (greetingStyle === 'formal') formalityScore += 0.2;
  if (closingStyle === 'formal' || closingStyle === 'very-formal') formalityScore += 0.2;
  
  // Casual language - give different weights to different informal indicators
  let informalWeight = 0;
  markers.informalLanguage.forEach(marker => {
    if (marker.includes('contraction')) {
      informalWeight += 0.05;
    } else if (marker.includes('fragment')) {
      informalWeight += 0.05;
    } else if (marker === 'repeated_punctuation' || marker === 'emphasis_caps') {
      informalWeight += 0.08;
    } else if (marker === 'high_contraction_density') {
      informalWeight += 0.1;
    } else {
      // Actual informal words/expressions like 'lol', 'haha', etc.
      informalWeight += 0.08;
    }
  });
  
  casualScore += Math.min(informalWeight, 0.5); // Cap the contribution
  casualScore += (1 - tonalQualities.formality) * 0.3;
  if (greetingStyle === 'casual' || greetingStyle === 'casual-personal') casualScore += 0.15;
  if (closingStyle === 'casual-friendly') casualScore += 0.1;
  if (closingStyle === 'very-casual') casualScore += 0.2;
  
  // Determine familiarity level based on scores
  if (intimacyScore > 0.5) {
    return 'intimate';
  } else if (casualScore > 0.75 && formalityScore < 0.3) {
    // Need strong casual indicators for very_familiar
    return 'very_familiar';
  } else if (casualScore > 0.4 && formalityScore < 0.5) {
    return 'familiar';
  } else if (formalityScore > 0.6) {
    return 'formal';
  } else {
    return 'professional';
  }
}

function analyzeEnhancedSentiment(text: string, _doc: any, winkResult: any): EmailFeatures['sentiment'] {
  // Extract emotions from wink-sentiment's word-level analysis
  const emotionData = extractEmotionsFromWink(winkResult, text);
  
  // Extract emojis that indicate tone
  const emojis = extractEmojis(text);
  
  // Use wink's normalized score for sentiment intensity
  const score = winkResult.normalizedScore;
  // Adjust intensity calculation - wink scores can range widely
  // Typical range is -5 to 5, but can go higher
  const intensity = Math.min(Math.abs(score) / 3, 1); // More sensitive scaling
  
  // Determine primary sentiment category based on score and detected emotions
  const primary = determinePrimarySentiment(score, emotionData.emotions, emotionData.dominantEmotion);
  
  // Calculate confidence based on multiple factors
  const confidence = calculateSentimentConfidence(
    winkResult,
    emotionData.emotionWords.length,
    emojis.length,
    emotionData.strongestScore
  );
  
  return {
    primary,
    intensity,
    confidence,
    emotions: emotionData.emotions,
    emojis: emojis.length > 0 ? emojis : undefined,
    score: score / 5, // Normalized to -1 to 1 range for backwards compatibility
    magnitude: intensity // For backwards compatibility
  };
}

interface EmotionData {
  emotions: string[];
  emotionWords: Array<{ word: string; score: number; emotion: string }>;
  dominantEmotion: string | null;
  strongestScore: number;
}

function extractEmotionsFromWink(winkResult: any, text: string): EmotionData {
  const emotionWords: Array<{ word: string; score: number; emotion: string }> = [];
  const emotionSet = new Set<string>();
  let strongestScore = 0;
  
  // Define emotion mappings based on word scores
  const emotionMappings: { [key: string]: { emotion: string; minScore?: number } } = {
    // Joy/Happiness
    happy: { emotion: 'happy' },
    joyful: { emotion: 'happy' },
    delighted: { emotion: 'happy' },
    pleased: { emotion: 'happy' },
    excited: { emotion: 'excited' },
    thrilled: { emotion: 'excited', minScore: 4 },
    ecstatic: { emotion: 'excited', minScore: 4 },
    enthusiastic: { emotion: 'excited' },
    
    // Gratitude
    grateful: { emotion: 'grateful' },
    thankful: { emotion: 'grateful' },
    thank: { emotion: 'grateful' },
    thanks: { emotion: 'grateful' },
    appreciate: { emotion: 'grateful' },
    appreciative: { emotion: 'grateful' },
    
    // Sadness
    sad: { emotion: 'sad' },
    unhappy: { emotion: 'sad' },
    disappointed: { emotion: 'disappointed' },
    depressed: { emotion: 'sad' },
    
    // Anger/Frustration
    angry: { emotion: 'angry' },
    frustrated: { emotion: 'frustrated' },
    irritated: { emotion: 'frustrated' },
    annoyed: { emotion: 'frustrated' },
    mad: { emotion: 'angry' },
    
    // Fear/Concern
    worried: { emotion: 'concerned' },
    anxious: { emotion: 'concerned' },
    concerned: { emotion: 'concerned' },
    nervous: { emotion: 'concerned' },
    afraid: { emotion: 'concerned' },
    
    // Confidence
    confident: { emotion: 'confident' },
    sure: { emotion: 'confident' },
    certain: { emotion: 'confident' },
    positive: { emotion: 'confident' }
  };
  
  // Extract sentiment words from wink's tokenized output
  if (winkResult.tokenizedPhrase && Array.isArray(winkResult.tokenizedPhrase)) {
    winkResult.tokenizedPhrase.forEach((token: any) => {
      if (token.score !== undefined && token.tag === 'word') {
        const word = token.value.toLowerCase();
        const mapping = emotionMappings[word];
        
        if (mapping) {
          // Check if word meets minimum score requirement
          if (!mapping.minScore || Math.abs(token.score) >= mapping.minScore) {
            emotionWords.push({
              word: token.value,
              score: token.score,
              emotion: mapping.emotion
            });
            emotionSet.add(mapping.emotion);
            
            if (Math.abs(token.score) > Math.abs(strongestScore)) {
              strongestScore = token.score;
            }
          }
        }
      }
    });
  }
  
  // Check for specific emotion words that might not have sentiment scores
  if (text.toLowerCase().includes('apologetic') && !emotionSet.has('apologetic')) {
    emotionSet.add('apologetic');
  }
  
  // Determine dominant emotion based on scores
  let dominantEmotion = null;
  if (emotionWords.length > 0) {
    const emotionScores = new Map<string, number>();
    emotionWords.forEach(ew => {
      const current = emotionScores.get(ew.emotion) || 0;
      emotionScores.set(ew.emotion, current + Math.abs(ew.score));
    });
    
    let maxScore = 0;
    emotionScores.forEach((score, emotion) => {
      if (score > maxScore) {
        maxScore = score;
        dominantEmotion = emotion;
      }
    });
  }
  
  return {
    emotions: Array.from(emotionSet),
    emotionWords,
    dominantEmotion,
    strongestScore
  };
}

function determinePrimarySentiment(
  score: number,
  _emotions: string[],
  dominantEmotion: string | null
): EmailFeatures['sentiment']['primary'] {
  // Use dominant emotion to guide classification when available
  if (dominantEmotion) {
    if (['excited', 'thrilled', 'ecstatic'].includes(dominantEmotion) && score > 2.5) {
      return 'enthusiastic';
    }
    if (['frustrated', 'angry', 'irritated'].includes(dominantEmotion) && score < -1.0) {
      return 'frustrated';
    }
    if (['concerned', 'worried', 'anxious'].includes(dominantEmotion) && score < 0) {
      return 'concerned';
    }
  }
  
  // Fall back to score-based classification
  if (score > 3.5) return 'enthusiastic';
  if (score > 0.5) return 'positive';
  if (score < -3.5) return 'frustrated';
  if (score < -0.5) return 'concerned';
  return 'neutral';
}

// Note: extractEmotions is now replaced by extractEmotionsFromWink which uses wink-sentiment's word-level analysis

function extractEmojis(text: string): string[] {
  // Regex for common emojis - using Unicode property escapes where supported
  // This is a simplified version that catches most common emojis
  const emojiRegex = /(?:[\u2700-\u27BF]|(?:\uD83C[\uDF00-\uDFFF])|(?:\uD83D[\uDC00-\uDE4F])|(?:\uD83D[\uDE80-\uDEFF]))/g;
  
  // Common emoticons
  const emoticonPatterns = [
    /:-?\)/g,  // :) or :-)
    /:-?\(/g,  // :( or :-(
    /:-?D/g,    // :D or :-D
    /;-?\)/g,  // ;) or ;-)
    /:-?P/gi,   // :P or :-P
    /:-?\/\//g, // :/ or :-/
    /\^_\^/g,   // ^_^
    />_</g,     // >_<
    /T_T/g,     // T_T
  ];
  
  const emojis = text.match(emojiRegex) || [];
  const emoticons: string[] = [];
  
  emoticonPatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      emoticons.push(...matches);
    }
  });
  
  return [...new Set([...emojis, ...emoticons])];
}

function calculateSentimentConfidence(
  winkResult: any,
  emotionWordCount: number,
  emojiCount: number,
  strongestScore: number
): number {
  // Base confidence on wink's score strength
  const scoreConfidence = Math.min(Math.abs(winkResult.normalizedScore) / 5, 0.5);
  
  // Strong individual word scores increase confidence
  const wordScoreConfidence = Math.min(Math.abs(strongestScore) / 5, 0.3);
  
  // Multiple emotion words increase confidence
  const emotionDensity = emotionWordCount / winkResult.tokenizedPhrase.length;
  const emotionBoost = Math.min(emotionDensity * 2, 0.2);
  
  // Emojis are strong indicators
  const emojiBoost = Math.min(emojiCount * 0.1, 0.2);
  
  return Math.min(scoreConfidence + wordScoreConfidence + emotionBoost + emojiBoost, 1);
}

function analyzeTonalQualities(text: string, doc: any, winkResult: any): EmailFeatures['tonalQualities'] {
  return {
    warmth: analyzeWarmth(text, doc, winkResult),
    formality: analyzeFormalityLevel(text, doc),
    urgency: analyzeUrgencyLevel(text, doc),
    directness: analyzeDirectness(text, doc),
    enthusiasm: analyzeEnthusiasm(winkResult, doc),
    politeness: analyzePolitenessLevel(text, doc, winkResult)
  };
}

function analyzeWarmth(text: string, doc: any, winkResult: any): number {
  let warmthScore = 0.5; // Start neutral
  
  // Analyze warm words using wink-sentiment scores
  const warmWords = new Set(['love', 'care', 'dear', 'sweet', 'kind', 'warm', 'friend', 'hope', 'wish', 'wonderful']);
  const coldWords = new Set(['regret', 'unfortunately', 'formal', 'hereby', 'pursuant']);
  
  let warmWordScore = 0;
  let coldWordScore = 0;
  let emotionalWords = 0;
  
  winkResult.tokenizedPhrase.forEach((token: any) => {
    if (token.tag === 'word' && token.score !== undefined) {
      const word = token.value.toLowerCase();
      
      // Warm words with positive sentiment contribute to warmth
      if (warmWords.has(word) && token.score > 0) {
        warmWordScore += token.score;
      }
      // Cold/formal words reduce warmth
      else if (coldWords.has(word)) {
        coldWordScore += Math.abs(token.score);
      }
      // Any emotional word (positive) adds some warmth
      else if (token.score >= 2) {
        emotionalWords++;
      }
    }
  });
  
  // Apply word-based warmth scores
  warmthScore += (warmWordScore - coldWordScore) / (winkResult.tokenizedPhrase.length * 2);
  warmthScore += Math.min(emotionalWords * 0.05, 0.15);
  
  // Linguistic patterns for warmth (using compromise)
  const personalPronouns = doc.match('(we|us|our)').length;
  const inclusiveLanguage = doc.match('(together|share|join|collaborate)').found;
  const careExpressions = doc.match('(hope you|how are you|take care|best wishes)').found;
  
  if (personalPronouns > 0) warmthScore += Math.min(personalPronouns * 0.05, 0.15);
  if (inclusiveLanguage) warmthScore += 0.1;
  if (careExpressions) warmthScore += 0.15;
  
  // Exclamation marks in positive context
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > 0 && exclamations < 3 && winkResult.normalizedScore > 0) {
    warmthScore += 0.05;
  }
  
  // Cold/distant language patterns
  if (doc.match('(per my last email|as previously stated|for your information)').found) {
    warmthScore -= 0.3;
  }
  
  return Math.max(0, Math.min(1, warmthScore));
}

function analyzeFormalityLevel(_text: string, doc: any): number {
  let formalityScore = 0.5; // Start neutral
  
  // Use compromise's formality detection
  const formalGreetings = doc.match('(dear|to whom it may concern|greetings)').found;
  const formalClosings = doc.match('(sincerely|respectfully|regards|cordially)').found;
  const titles = doc.match('#Honorific').found;
  const formalVocabulary = doc.match('(pursuant|aforementioned|regarding|concerning|furthermore|moreover)').found;
  
  if (formalGreetings) formalityScore += 0.2;
  if (formalClosings) formalityScore += 0.2;
  if (titles) formalityScore += 0.15;
  if (formalVocabulary) formalityScore += 0.15;
  
  // Informal indicators using compromise tags and informality score
  const informalityScore = calculateInformalityScore(doc);
  const informalGreetings = doc.match('(hey|hi) #Person?').found || 
                           doc.sentences().first().match('#Informal').found;
  
  // Reduce formality based on informality indicators
  formalityScore -= informalityScore * 0.5;
  if (informalGreetings) formalityScore -= 0.1;
  
  // Sentence complexity (using compromise)
  const avgSentenceLength = doc.wordCount() / doc.sentences().length;
  if (avgSentenceLength > 20) formalityScore += 0.1;
  if (avgSentenceLength < 10) formalityScore -= 0.1;
  
  return Math.max(0, Math.min(1, formalityScore));
}

function analyzeUrgencyLevel(textInput: string, doc: any): number {
  const text = textInput;
  let urgencyScore = 0.3; // Start low
  
  // Time-related expressions
  const immediateTerms = doc.match('(immediately|urgent|asap|right away|now|today)').found;
  const soonTerms = doc.match('(soon|tomorrow|this week|by #Date)').found;
  const flexibleTerms = doc.match('(whenever|no rush|at your convenience|when you can)').found;
  
  if (immediateTerms) urgencyScore = 0.9;
  else if (soonTerms) urgencyScore = 0.6;
  else if (flexibleTerms) urgencyScore = 0.1;
  
  // Imperative sentences increase urgency
  const imperatives = doc.sentences().filter((s: any) => s.has('#Imperative')).length;
  urgencyScore += imperatives * 0.1;
  
  // Multiple exclamation marks
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > 2) urgencyScore += 0.2;
  
  // All caps words (excluding common acronyms)
  const allCapsWords = text.match(/\b[A-Z]{2,}\b/g) || [];
  const nonAcronyms = allCapsWords.filter(word => word.length > 3 && !['HTTP', 'HTTPS', 'HTML', 'JSON', 'API'].includes(word));
  if (nonAcronyms.length > 0) urgencyScore += 0.1;
  
  return Math.max(0, Math.min(1, urgencyScore));
}

function analyzeDirectness(_text: string, doc: any): number {
  let directnessScore = 0.5; // Start neutral
  
  // Direct language patterns
  const imperatives = doc.sentences().filter((s: any) => s.has('#Imperative')).length;
  const directStatements = doc.match('(need|must|require|have to|should)').length;
  
  directnessScore += (imperatives / doc.sentences().length) * 0.3;
  directnessScore += (directStatements / doc.sentences().length) * 0.2;
  
  // Indirect language patterns
  const hedging = doc.match('(maybe|perhaps|possibly|might|could|seem|appear)').length;
  const conditionals = doc.match('(if|would|could you|would you mind)').length;
  const questions = doc.questions().length;
  
  directnessScore -= (hedging / doc.wordCount()) * 5;
  directnessScore -= (conditionals / doc.sentences().length) * 0.2;
  directnessScore -= (questions / doc.sentences().length) * 0.15;
  
  // Softening phrases
  if (doc.match('(just wanted to|I was wondering|I thought)').found) directnessScore -= 0.2;
  
  return Math.max(0, Math.min(1, directnessScore));
}

function analyzeEnthusiasm(winkResult: any, doc: any): number {
  const text = doc.text();
  // Start with sentiment score as base
  let enthusiasmScore = Math.max(0, winkResult.normalizedScore);
  
  // Boost for enthusiastic expressions
  const enthusiasticWords = doc.match('(excited|thrilled|amazing|fantastic|awesome|wonderful|great)').length;
  const exclamations = doc.match('#Exclamation').length;
  
  enthusiasmScore += (enthusiasticWords / doc.wordCount()) * 5;
  enthusiasmScore += (exclamations / doc.sentences().length) * 0.2;
  
  // Superlatives indicate enthusiasm
  const superlatives = doc.match('#Superlative').length;
  enthusiasmScore += (superlatives / doc.wordCount()) * 3;
  
  // Multiple punctuation (!!!, ???) indicates strong emotion
  const multiPunctuation = text.match(/[!?]{2,}/g) || [];
  if (multiPunctuation.length > 0) enthusiasmScore += 0.1;
  
  return Math.max(0, Math.min(1, enthusiasmScore));
}

function analyzePolitenessLevel(_text: string, doc: any, winkResult: any): number {
  let politenessScore = 0.5; // Start neutral
  
  // Extract polite words from wink-sentiment analysis
  const politeWords = new Set(['please', 'thank', 'thanks', 'appreciate', 'grateful', 'kindly']);
  const impoliteWords = new Set(['demand', 'must', 'stupid', 'idiot', 'hell', 'damn']);
  
  let politeWordScore = 0;
  let impoliteWordScore = 0;
  
  winkResult.tokenizedPhrase.forEach((token: any) => {
    if (token.tag === 'word') {
      const word = token.value.toLowerCase();
      if (politeWords.has(word) && token.score !== undefined) {
        // Positive scores for polite words increase politeness
        politeWordScore += Math.max(0, token.score);
      } else if (impoliteWords.has(word) && token.score !== undefined) {
        // Negative scores for harsh words decrease politeness
        impoliteWordScore += Math.abs(Math.min(0, token.score));
      }
    }
  });
  
  // Normalize word-based scores
  const wordScore = (politeWordScore - impoliteWordScore) / winkResult.tokenizedPhrase.length;
  politenessScore += wordScore * 2; // Scale impact
  
  // Grammatical politeness patterns using compromise
  const politeRequests = doc.match('(could|would|may|might) #Pronoun #Adverb? #Verb').length;
  const questions = doc.questions().length;
  const conditionals = doc.match('if #Pronoun (could|would)').length;
  
  politenessScore += (politeRequests / doc.sentences().length) * 0.2;
  politenessScore += (questions / doc.sentences().length) * 0.1;
  politenessScore += (conditionals / doc.sentences().length) * 0.1;
  
  // Respectful address
  if (doc.match('#Honorific').found) politenessScore += 0.1;
  
  // Impolite patterns
  const imperatives = doc.sentences().filter((s: any) => s.has('#Imperative')).length;
  const negativeCommands = doc.match("(don't|stop|quit) #Verb").length;
  
  politenessScore -= (imperatives / doc.sentences().length) * 0.15;
  politenessScore -= (negativeCommands / doc.sentences().length) * 0.1;
  
  return Math.max(0, Math.min(1, politenessScore));
}

function calculateInformalityScore(doc: any): number {
  // Calculate informality based on multiple linguistic factors
  const indicators = {
    contractionDensity: (doc as any).contractions().length / Math.max(doc.wordCount(), 1),
    informalWords: doc.match('#Informal').length / Math.max(doc.wordCount(), 1),
    slangUsage: doc.match('#Slang').length / Math.max(doc.wordCount(), 1),
    interjections: doc.match('#Interjection').length / Math.max(doc.sentences().length, 1),
    fragments: doc.sentences().filter((s: any) => s.wordCount() < 3 || !s.has('#Verb')).length / Math.max(doc.sentences().length, 1),
    shortSentences: doc.sentences().filter((s: any) => s.wordCount() < 7).length / Math.max(doc.sentences().length, 1),
    exclamations: doc.match('#Exclamation').length / Math.max(doc.sentences().length, 1),
    firstPerson: doc.match('#FirstPerson').length / Math.max(doc.wordCount(), 1)
  };
  
  // Weight different indicators
  const weights = {
    contractionDensity: 2.0,
    informalWords: 2.5,
    slangUsage: 3.0,
    interjections: 1.5,
    fragments: 1.8,
    shortSentences: 0.8,
    exclamations: 1.2,
    firstPerson: 0.5
  };
  
  let totalScore = 0;
  let totalWeight = 0;
  
  Object.entries(indicators).forEach(([key, value]) => {
    const weight = weights[key as keyof typeof weights];
    totalScore += value * weight;
    totalWeight += weight;
  });
  
  return Math.min(totalScore / totalWeight * 2, 1); // Scale to 0-1
}

function analyzeLinguisticStyle(doc: any): EmailFeatures['linguisticStyle'] {
  // Analyze vocabulary complexity
  const uniqueWords = new Set();
  const totalWords = doc.wordCount();
  doc.terms().forEach((term: any) => uniqueWords.add(term.text().toLowerCase()));
  const lexicalDiversity = uniqueWords.size / totalWords;
  
  let vocabularyComplexity: 'simple' | 'moderate' | 'sophisticated';
  
  // For very short texts (< 20 words), use different thresholds
  if (totalWords < 20) {
    if (lexicalDiversity < 0.6) vocabularyComplexity = 'simple';
    else if (lexicalDiversity < 0.85) vocabularyComplexity = 'moderate';
    else vocabularyComplexity = 'sophisticated';
  } else {
    if (lexicalDiversity < 0.4) vocabularyComplexity = 'simple';
    else if (lexicalDiversity < 0.7) vocabularyComplexity = 'moderate';
    else vocabularyComplexity = 'sophisticated';
  }
  
  // Check for sophisticated vocabulary markers
  const sophisticatedWords = doc.match('(pursuant|aforementioned|nevertheless|furthermore|consequently|subsequently|comprehensive|ramifications|deliberation)').length;
  const academicWords = doc.match('(analyze|synthesize|evaluate|implement|utilize|optimize)').length;
  
  // Override if we find sophisticated vocabulary
  if (sophisticatedWords + academicWords > 2) {
    vocabularyComplexity = 'sophisticated';
  }
  
  // Check for very simple vocabulary
  const simpleWords = doc.match('(good|bad|nice|big|small|happy|sad|like|want|get|go|do|make)').length;
  if (simpleWords > totalWords * 0.3 && sophisticatedWords === 0) {
    vocabularyComplexity = 'simple';
  }
  
  // Analyze sentence structure
  const sentences = doc.sentences();
  const avgWordsPerSentence = totalWords / sentences.length;
  let sentenceStructure: 'concise' | 'moderate' | 'elaborate';
  
  if (avgWordsPerSentence < 10) sentenceStructure = 'concise';
  else if (avgWordsPerSentence < 20) sentenceStructure = 'moderate';
  else sentenceStructure = 'elaborate';
  
  // Extract conversational markers
  const conversationalMarkers: string[] = [];
  
  // Discourse markers
  const discourseMarkers = doc.match('(anyway|by the way|honestly|actually|basically|obviously|clearly|frankly|seriously)');
  if (discourseMarkers.found) {
    discourseMarkers.forEach((m: any) => conversationalMarkers.push(m.text().toLowerCase()));
  }
  
  // Fillers and hedges
  const fillers = doc.match('(you know|I mean|like|kind of|sort of|pretty much)');
  if (fillers.found) {
    fillers.forEach((m: any) => conversationalMarkers.push(m.text().toLowerCase()));
  }
  
  // Personal expressions
  const personalExpressions = doc.match('(I think|I feel|I believe|in my opinion|personally)');
  if (personalExpressions.found) {
    personalExpressions.forEach((m: any) => conversationalMarkers.push(m.text().toLowerCase()));
  }
  
  return {
    vocabularyComplexity,
    sentenceStructure,
    conversationalMarkers: [...new Set(conversationalMarkers)] // Remove duplicates
  };
}

// Note: analyzeUrgency functionality is now integrated into analyzeUrgencyLevel in tonalQualities

function extractActionItems(text: string): Array<{ text: string; type: 'request' | 'commitment' | 'suggestion' }> {
  const doc = nlp(text);
  const actionItems: Array<{ text: string; type: 'request' | 'commitment' | 'suggestion' }> = [];
  
  // Use compromise's sentence detection
  const sentences = doc.sentences();
  
  sentences.forEach((sentence: any) => {
    const sentText = sentence.text();
    
    // Requests - use compromise patterns
    const hasRequest = sentence.match('(can|could|would|will) #Pronoun').found ||
                      sentence.match('please').found ||
                      sentence.has('#QuestionMark');
    
    // Commitments - first person future or modal verbs
    const hasCommitment = sentence.match('(i|we) (will|can|could|shall)').found ||
                         sentence.match("(i'll|we'll|i'm going to|we're going to)").found;
    
    // Suggestions - collaborative language
    const hasSuggestion = sentence.match('(we|let\'s) (should|could|might)').found ||
                         sentence.match('(how about|what if|maybe|perhaps)').found;
    
    if (hasRequest) {
      actionItems.push({ text: sentText, type: 'request' });
    } else if (hasCommitment) {
      actionItems.push({ text: sentText, type: 'commitment' });
    } else if (hasSuggestion) {
      actionItems.push({ text: sentText, type: 'suggestion' });
    }
  });
  
  return actionItems.slice(0, 10); // Limit to 10 items
}

function inferContextType(text: string): EmailFeatures['contextType'] {
  const doc = nlp(text);
  
  // Question - use compromise's question detection
  if (doc.questions().found || doc.match('#QuestionWord').found) {
    return 'question';
  }
  
  // Answer (references previous discussion)
  if (doc.match('(in response|regarding your|to answer|here\'s the|as requested)').found) {
    return 'answer';
  }
  
  // Update (status or progress)
  if (doc.match('(update|progress|status|completed|finished|done)').found) {
    return 'update';
  }
  
  // Request (asking for something)
  if (doc.match('(please|request|need|require|would like)').found) {
    return 'request';
  }
  
  // Scheduling - look for time/date references
  if (doc.match('(meeting|appointment|calendar|schedule|available)').found || doc.match('#Date').found) {
    return 'scheduling';
  }
  
  // Acknowledgment
  if (doc.match('(received|got it|thanks|thank you|acknowledged|noted)').found) {
    return 'acknowledgment';
  }
  
  return 'other';
}

function calculateStats(doc: any, text: string): EmailFeatures['stats'] {
  // Use compromise for accurate counts
  const sentences = doc.sentences();
  const sentenceCount = sentences.length;

  // For word count, use simple split for test consistency
  // Note: text is already cleaned at the top level (markers removed)
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  
  // Calculate vocabulary complexity using compromise
  const terms = doc.terms();
  const uniqueTerms = new Set();
  terms.forEach((term: any) => uniqueTerms.add(term.text().toLowerCase()));
  const vocabularyComplexity = wordCount > 0 ? uniqueTerms.size / wordCount : 0;
  
  // Count contractions using compromise
  const contractions = (doc as any).contractions();
  const contractionCount = contractions.length;
  
  // Calculate formality score using compromise patterns
  let formalityScore = 0.5; // Start neutral
  
  // Formal indicators
  if (doc.match('(Dear|Sincerely|Regards|Respectfully)').found) formalityScore += 0.2;
  if (doc.match('(Mr|Mrs|Ms|Dr|Prof)').found) formalityScore += 0.1;
  if (doc.match('(pursuant|therefore|furthermore|moreover)').found) formalityScore += 0.1;
  
  // Informal indicators
  if (doc.match('(hey|hi|lol|haha|btw)').found) formalityScore -= 0.2;
  const exclamationCount = doc.match('#Exclamation').length;
  if (exclamationCount > 1) formalityScore -= 0.1;
  if (contractionCount > wordCount * 0.05) formalityScore -= 0.1;
  
  formalityScore = Math.max(0, Math.min(1, formalityScore));
  
  return {
    wordCount: wordCount,
    sentenceCount: sentenceCount,
    avgWordsPerSentence: sentenceCount > 0 ? wordCount / sentenceCount : 0,
    vocabularyComplexity,
    formalityScore,
    contractionDensity: wordCount > 0 ? (contractionCount / wordCount) * 100 : 0
  };
}