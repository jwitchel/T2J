import { SelectedExample } from './example-selector';
import { TemplateManager, EnhancedRelationshipProfile } from './template-manager';
import { WritingPatterns } from './writing-pattern-analyzer';
import { EmailActions } from '../email-actions';

export interface PromptFormatterParams {
  incomingEmail: string;
  recipientEmail: string;
  relationship: string;
  examples: SelectedExample[];
  relationshipProfile?: EnhancedRelationshipProfile | null;
  nlpFeatures?: any; // NLP features from the incoming email
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
    rawMessage: string;  // Complete raw email (headers + body)
  };
}

export interface FormattedPrompt {
  prompt: string;
  metadata: {
    exampleCount: number;
    relationshipExampleCount: number;
    otherRelationshipCount: number;
    hasRelationshipProfile: boolean;
    templateUsed: string;
  };
}

export class PromptFormatterV2 {
  private templateManager: TemplateManager;
  private defaultTemplate: string;
  private initialized = false;

  constructor(options?: {
    templateDir?: string;
    defaultTemplate?: string;
  }) {
    this.templateManager = new TemplateManager(options?.templateDir);
    this.defaultTemplate = options?.defaultTemplate || process.env.PROMPT_TEMPLATE || 'default';
  }

  async initialize() {
    if (!this.initialized) {
      await this.templateManager.initialize();
      this.initialized = true;
    }
  }

  async formatWithExamples(params: PromptFormatterParams): Promise<string> {
    await this.initialize();
    
    const templateData = this.templateManager.prepareTemplateData(params);
    return this.templateManager.renderPrompt(this.defaultTemplate, templateData);
  }

  async formatWithExamplesStructured(
    params: PromptFormatterParams,
    templateName?: string
  ): Promise<FormattedPrompt> {
    await this.initialize();
    
    const template = templateName || this.defaultTemplate;
    const templateData = this.templateManager.prepareTemplateData(params);
    const prompt = await this.templateManager.renderPrompt(template, templateData);
    
    const exactMatches = params.examples.filter(e => 
      e.metadata.relationship?.type === params.relationship
    );
    const otherMatches = params.examples.filter(e => 
      e.metadata.relationship?.type !== params.relationship
    );

    return {
      prompt,
      metadata: {
        exampleCount: params.examples.length,
        relationshipExampleCount: exactMatches.length,
        otherRelationshipCount: otherMatches.length,
        hasRelationshipProfile: !!params.relationshipProfile,
        templateUsed: template
      }
    };
  }

  async formatSystemPrompt(data?: any): Promise<string> {
    await this.initialize();
    return this.templateManager.renderSystemPrompt('default', data);
  }

  // Convenience methods for specific templates
  async formatVerbosePrompt(params: PromptFormatterParams): Promise<string> {
    await this.initialize();
    const templateData = this.templateManager.prepareTemplateData(params);
    return this.templateManager.renderPrompt('verbose', templateData);
  }

  // Format spam check prompt
  async formatSpamCheck(params: {
    rawEmail: string;
    userNames?: {
      name: string;
      nicknames?: string;
    };
  }): Promise<string> {
    await this.initialize();
    // For spam check, we need to bypass prepareTemplateData since it expects different fields
    // We'll directly load and render the template
    const template = await this.templateManager['loadTemplate']('spam-check', 'prompt');
    return template({
      rawEmail: params.rawEmail,
      userNames: params.userNames || { name: 'User' }
    });
  }

  // Format meta-context analysis prompt
  async formatMetaContextAnalysis(params: Partial<PromptFormatterParams>): Promise<string> {
    await this.initialize();
    const templateData = this.templateManager.prepareTemplateData({
      incomingEmail: params.incomingEmail || '',
      recipientEmail: params.recipientEmail || '',
      relationship: 'unknown', // Not needed for meta-context analysis
      examples: [], // No examples needed for meta-context analysis
      userNames: params.userNames,
      incomingEmailMetadata: params.incomingEmailMetadata
    });
    return this.templateManager.renderPrompt('meta-context-analysis', templateData);
  }

  // Format action analysis prompt (no tone/style needed)
  async formatActionAnalysis(params: Partial<PromptFormatterParams>): Promise<string> {
    await this.initialize();

    // Generate available actions list from EmailActions constant
    const availableActions = Object.values(EmailActions).join('|');

    const templateData = this.templateManager.prepareTemplateData({
      incomingEmail: params.incomingEmail || '',
      recipientEmail: params.recipientEmail || '',
      relationship: 'unknown', // Not needed for action analysis
      examples: [], // No examples needed for action analysis
      userNames: params.userNames,
      incomingEmailMetadata: params.incomingEmailMetadata,
      availableActions // Pass to template
    });
    return this.templateManager.renderPrompt('action-analysis', templateData);
  }

  // Format response generation prompt (with tone/style)
  async formatResponseGeneration(params: PromptFormatterParams & { actionMeta: any }): Promise<string> {
    await this.initialize();
    const templateData = {
      ...this.templateManager.prepareTemplateData(params),
      actionMeta: params.actionMeta
    };
    return this.templateManager.renderPrompt('response-generation', templateData);
  }

  // Get available templates
  getAvailableTemplates(): string[] {
    // In a real implementation, this would scan the template directory
    return ['default', 'verbose', 'spam-check', 'meta-context-analysis', 'action-analysis', 'response-generation'];
  }
}