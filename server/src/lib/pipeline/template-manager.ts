import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { SelectedExample } from './example-selector';
import { RelationshipProfile } from './types';
import { WritingPatterns } from './writing-pattern-analyzer';

export interface PromptTemplateData {
  // Core data
  recipientEmail: string;
  relationship: string;
  incomingEmail: string;
  
  // User identity
  userNames?: {
    name: string;
    nicknames?: string;
  };
  
  // Incoming email metadata
  incomingEmailMetadata?: {
    from: { address: string; name?: string }[];
    to: { address: string; name?: string }[];
    cc?: { address: string; name?: string }[];
    subject: string;
    date: Date;
  };
  
  // Examples formatted for templates
  exactExamples?: FormattedExample[];
  otherExamples?: FormattedExample[];
  
  // Relationship profile with aggregated style
  profile?: EnhancedRelationshipProfile | null;
  
  // NLP features from incoming email
  nlpFeatures?: any;
  
  // Writing patterns
  patterns?: WritingPatterns;

  // Template-specific data
  availableActions?: string;  // For action-analysis template

  // Metadata
  meta: {
    exampleCount: number;
    relationshipMatchCount: number;
    avgWordCount: number;
    formalityLevel: string;
  };
}

// Enhanced profile that includes aggregated style patterns
export interface EnhancedRelationshipProfile extends RelationshipProfile {
  aggregatedStyle?: {
    greetings: Array<{ text: string; frequency: number; percentage: number }>;
    closings: Array<{ text: string; frequency: number; percentage: number }>;
    emojis: Array<{ emoji: string; frequency: number; contexts: string[] }>;
    sentimentProfile: { 
      primaryTone: string; 
      averageWarmth: number; 
      averageFormality: number; 
    };
    vocabularyProfile: {
      complexityLevel: string;
      technicalTerms: string[];
      commonPhrases: Array<{ phrase: string; frequency: number }>;
    };
    structuralPatterns: {
      averageEmailLength: number;
      averageSentenceLength: number;
      paragraphingStyle: string;
    };
    emailCount: number;
    confidenceScore: number;
    lastUpdated?: string;
  };
  personName?: string;
  relationshipType?: string;
}

export interface FormattedExample {
  text: string;
  relationship: string;
  score?: number;
  subject?: string;
  formalityScore?: number;
  sentiment?: string;
  wordCount?: number;
  urgency?: string;
  keyPhrases?: string[];
}

export class TemplateManager {
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map();
  private partials: Map<string, string> = new Map();
  private templateDir: string;
  private lastModified: Map<string, number> = new Map();

  constructor(templateDir?: string) {
    this.templateDir = templateDir || path.join(__dirname, 'templates');
    this.registerHelpers();
  }

  private registerHelpers() {
    // Increment helper for 1-based indexing
    Handlebars.registerHelper('inc', (value: number) => value + 1);
    
    // Truncate text helper
    Handlebars.registerHelper('truncate', (text: string, length: number) => {
      if (!text) return '';
      return text.length > length ? text.substring(0, length) + '...' : text;
    });
    
    // Join array helper
    Handlebars.registerHelper('join', (array: string[], separator: string) => {
      if (!array) return '';
      return array.join(separator);
    });
    
    // Uppercase helper
    Handlebars.registerHelper('uppercase', (text: string) => {
      return text ? text.toUpperCase() : '';
    });
    
    // Equality helper
    Handlebars.registerHelper('eq', (a: any, b: any) => {
      return a === b;
    });
    
    // Percentage helper
    Handlebars.registerHelper('percent', (value: number) => {
      if (typeof value !== 'number') return '0';
      return Math.round(value * 100);
    });
    
    // Round helper
    Handlebars.registerHelper('round', (value: number, decimals: number = 0) => {
      if (typeof value !== 'number') return '0';
      return value.toFixed(decimals);
    });
    
    // Check if array has items
    Handlebars.registerHelper('hasItems', (array: any[]) => {
      return Array.isArray(array) && array.length > 0;
    });
    
    // Get array length safely
    Handlebars.registerHelper('length', (array: any[]) => {
      return Array.isArray(array) ? array.length : 0;
    });
  }

  async initialize() {
    // Load all partials
    const partialsDir = path.join(this.templateDir, 'partials');
    try {
      const partialFiles = await fs.readdir(partialsDir);
      for (const file of partialFiles) {
        if (file.endsWith('.hbs')) {
          const name = path.basename(file, '.hbs');
          const content = await fs.readFile(path.join(partialsDir, file), 'utf-8');
          this.partials.set(name, content);
          Handlebars.registerPartial(name, content);
        }
      }
    } catch (error) {
      console.warn('No partials directory found, continuing without partials');
    }
  }

  async loadTemplate(name: string, type: 'prompt' | 'system' = 'prompt'): Promise<HandlebarsTemplateDelegate> {
    const cacheKey = `${type}:${name}`;
    const typeDir = type === 'prompt' ? 'prompts' : 'system';
    const templatePath = path.join(this.templateDir, typeDir, `${name}.hbs`);
    
    // Check if we need to reload (hot reload)
    try {
      const stats = await fs.stat(templatePath);
      const mtime = stats.mtimeMs;
      const lastMod = this.lastModified.get(cacheKey);
      
      if (lastMod && mtime <= lastMod && this.templates.has(cacheKey)) {
        return this.templates.get(cacheKey)!;
      }
      
      // Load and compile template
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      const compiled = Handlebars.compile(templateContent);
      
      this.templates.set(cacheKey, compiled);
      this.lastModified.set(cacheKey, mtime);
      
      return compiled;
    } catch (error) {
      throw new Error(`Failed to load template ${name}: ${error}`);
    }
  }

  async renderPrompt(templateName: string, data: PromptTemplateData): Promise<string> {
    const template = await this.loadTemplate(templateName, 'prompt');
    return template(data);
  }

  async renderSystemPrompt(templateName: string = 'default', data?: any): Promise<string> {
    const template = await this.loadTemplate(templateName, 'system');
    return template(data || {});
  }

  formatExamplesForTemplate(examples: SelectedExample[]): FormattedExample[] {
    return examples.map(ex => ({
      text: this.transformExampleText(ex.text),
      relationship: ex.metadata.relationship?.type || 'unknown',
      score: ex.score,
      subject: ex.metadata.subject,
      formalityScore: ex.metadata.features?.stats?.formalityScore,
      sentiment: ex.metadata.features?.sentiment?.dominant,
      wordCount: ex.metadata.wordCount || ex.text.split(/\s+/).length,
      urgency: ex.metadata.features?.urgency?.level,
      keyPhrases: this.extractKeyPhrases(ex)
    }));
  }
  
  private transformExampleText(text: string): string {
    // Transform special placeholders in example text
    if (text === '[ForwardedWithoutComment]') {
      return '(This email was forwarded without adding any personal message)';
    }
    return text;
  }

  private extractKeyPhrases(example: SelectedExample): string[] {
    // Extract key phrases from the example
    // This is a simplified version - in production, use NLP features
    const phrases: string[] = [];
    const text = example.text.toLowerCase();
    
    const commonPhrases = [
      'thanks for', 'looking forward', 'please let me know',
      'I appreciate', 'could you', 'would you mind'
    ];
    
    commonPhrases.forEach(phrase => {
      if (text.includes(phrase)) {
        phrases.push(phrase);
      }
    });
    
    return phrases.slice(0, 5);
  }

  prepareTemplateData(
    params: {
      incomingEmail: string;
      recipientEmail: string;
      relationship: string;
      examples: SelectedExample[];
      relationshipProfile?: EnhancedRelationshipProfile | null;
      nlpFeatures?: any;
      writingPatterns?: WritingPatterns | null;
      userNames?: {
        name: string;
        nicknames?: string;
      };
      incomingEmailMetadata?: {
        from: { address: string; name?: string }[];
        to: { address: string; name?: string }[];
        cc?: { address: string; name?: string }[];
        subject: string;
        date: Date;
      };
      availableActions?: string;
    }
  ): PromptTemplateData {
    const exactMatches = params.examples.filter(e => 
      e.metadata.relationship?.type === params.relationship
    );
    const otherMatches = params.examples.filter(e => 
      e.metadata.relationship?.type !== params.relationship
    );
    
    // Debug logging
    if (params.examples.length > 0) {
      console.log(`[TemplateManager] First example relationship:`, params.examples[0].metadata.relationship);
    }
    
    const avgWordCount = params.examples.length > 0
      ? Math.round(params.examples.reduce((sum, ex) => 
          sum + (ex.metadata.wordCount || ex.text.split(/\s+/).length), 0
        ) / params.examples.length)
      : 50;
    
    const avgFormality = params.examples.length > 0
      ? params.examples.reduce((sum, ex) => 
          sum + (ex.metadata.features?.stats?.formalityScore || 0.5), 0
        ) / params.examples.length
      : 0.5;
    
    return {
      recipientEmail: params.recipientEmail,
      relationship: params.relationship,
      incomingEmail: params.incomingEmail,
      userNames: params.userNames,
      incomingEmailMetadata: params.incomingEmailMetadata,
      exactExamples: exactMatches.length > 0
        ? this.formatExamplesForTemplate(exactMatches)
        : undefined,
      otherExamples: otherMatches.length > 0
        ? this.formatExamplesForTemplate(otherMatches)
        : undefined,
      profile: params.relationshipProfile,
      nlpFeatures: params.nlpFeatures,
      patterns: params.writingPatterns ? this.transformPatternsForTemplate(params.writingPatterns) : undefined,
      availableActions: params.availableActions,
      meta: {
        exampleCount: params.examples.length,
        relationshipMatchCount: exactMatches.length,
        avgWordCount,
        formalityLevel: this.describeFormalityLevel(avgFormality)
      }
    };
  }

  private transformPatternsForTemplate(patterns: WritingPatterns): any {
    // Transform special placeholders into clear instructions
    return {
      ...patterns,
      openingPatterns: patterns.openingPatterns.map(pattern => ({
        ...pattern,
        pattern: this.transformPatternText(pattern.pattern),
        isInstruction: this.isInstructionPattern(pattern.pattern)
      })),
      valediction: patterns.valediction.map(pattern => ({
        ...pattern,
        phrase: pattern.phrase === '[None]'
          ? 'skip closing phrase entirely'
          : pattern.phrase,
        isInstruction: pattern.phrase === '[None]'
      })),
    };
  }

  private transformPatternText(pattern: string): string {
    // Transform placeholder patterns into clear instructions
    if (pattern === '[right to the point]') {
      return 'start directly with the main point (no greeting)';
    }
    if (pattern === '[None]') {
      return 'skip opening entirely';
    }
    if (pattern === '[firstname]') {
      return 'sse recipient\'s first name only';
    }
    // For actual greeting patterns, return as-is
    return pattern;
  }

  private isInstructionPattern(pattern: string): boolean {
    // Determine if this is an instruction pattern (not a literal greeting)
    const instructionPatterns = [
      '[right to the point]',
      '[None]',
      '[firstname]'
    ];
    return instructionPatterns.includes(pattern);
  }

  private describeFormalityLevel(score: number): string {
    if (score >= 0.8) return 'very formal';
    if (score >= 0.6) return 'formal';
    if (score >= 0.4) return 'neutral';
    if (score >= 0.2) return 'casual';
    return 'very casual';
  }
}