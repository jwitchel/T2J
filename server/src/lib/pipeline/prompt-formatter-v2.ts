import { SelectedExample } from './example-selector';
import { TemplateManager, EnhancedRelationshipProfile } from './template-manager';
import { WritingPatterns } from './writing-pattern-analyzer';
import { EmailActionType } from '../../types/email-action-tracking';
import { SpamCheckResult } from './types';
import { SimplifiedEmailMetadata } from './types';

export interface PromptFormatterParams {
  incomingEmail: string;
  recipientEmail: string;
  relationship: string;
  examples: SelectedExample[];
  relationshipProfile?: EnhancedRelationshipProfile | null;
  writingPatterns?: WritingPatterns | null;
  userNames?: {
    name: string;
    nicknames?: string;
  };
  incomingEmailMetadata?: SimplifiedEmailMetadata;
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
    responseHistory?: {
      responseCount: number;
      hasRespondedBefore: boolean;
    };
  }): Promise<string> {
    await this.initialize();
    // For spam check, we need to bypass prepareTemplateData since it expects different fields
    // We'll directly load and render the template
    const template = await this.templateManager['loadTemplate']('spam-check', 'prompt');
    return template({
      rawEmail: params.rawEmail,
      userNames: params.userNames || { name: 'User' },
      responseHistory: params.responseHistory
    });
  }

  // Format action analysis prompt (no tone/style needed)
  async formatActionAnalysis(params: Partial<PromptFormatterParams> & { spamCheckResult: SpamCheckResult }): Promise<string> {
    await this.initialize();

    // Generate dynamic enum values to prevent hardcoded template drift
    // Filter out system-only actions (pending, training, manually_handled)
    const allActions = Object.values(EmailActionType).filter((v): v is EmailActionType => typeof v === 'string');
    const llmActions = allActions.filter(action => !EmailActionType.isSystemOnly(action));
    const availableActions = llmActions.join('|');
    const addressedToOptions = 'you|group|someone-else';
    const urgencyOptions = 'low|medium|high|critical';

    // Build minimal template data for action-analysis (no examples/patterns needed)
    const templateData = {
      incomingEmail: params.incomingEmail!,
      recipientEmail: params.recipientEmail!,
      relationship: 'unknown', // Not used in action-analysis
      userNames: params.userNames,
      incomingEmailMetadata: params.incomingEmailMetadata ? {
        ...params.incomingEmailMetadata,
        spamCheckResult: params.spamCheckResult
      } : undefined,
      availableActions,
      addressedToOptions,
      urgencyOptions,
      meta: {
        exampleCount: 0,
        relationshipMatchCount: 0,
        avgWordCount: 0,
        formalityLevel: 'unknown'
      }
    };
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
    return ['default', 'verbose', 'spam-check', 'action-analysis', 'response-generation'];
  }
}